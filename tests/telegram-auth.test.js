const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installTelegramAuth } = require('../apps/api/src/telegram/auth');
const { hashPassword, verifyPassword } = require('../apps/api/src/auth/passwords');
const { spawnSync } = require('node:child_process');

test('shared password hashing preserves legacy SHA256, PBKDF2 and bcrypt credentials', () => {
    const crypto = require('node:crypto');
    const password = 'legacy-password';
    const salt = 'legacy-test-salt';
    const stored = [
        crypto.createHash('sha256').update(password + 'mc_salt_2026').digest('hex'),
        `pbkdf2:${salt}:${crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')}`,
        require('bcrypt').hashSync(password, 4),
        hashPassword(password),
    ];
    for (const hash of stored) {
        assert.ok(verifyPassword(password, hash));
        assert.equal(verifyPassword('wrong-password', hash), false);
    }
    assert.equal(verifyPassword(password, 'scrypt:broken:invalid'), false);
});

test('standalone worker connects, forwards updates, delivers replies and stops on polling conflict', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-worker-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const preload = path.join(dir, 'mock.cjs');
    fs.writeFileSync(preload, `
        const assert = require('node:assert/strict');
        let polls = 0, forwarded = false, delivered = false, deleted = false, acknowledged = false, sentReceipt = false, lateDeleted = false, lateAcknowledged = false, receiptAttempts = 0;
        global.fetch = async (url, options) => {
            const target = String(url), body = JSON.parse(options.body);
            if (process.env.TEST_FAILURE === 'network') throw new TypeError('fetch failed: ' + process.env.telegrambotapi);
            if (target.endsWith('/getMe') && process.env.TEST_FAILURE === 'token') return new Response(JSON.stringify({ ok: false, description: process.env.telegrambotapi }), { status: 401 });
            if (target.endsWith('/connect') && process.env.TEST_FAILURE === 'secret') return new Response(JSON.stringify({ error: process.env.TELEGRAM_BOT_SECRET }), { status: 401 });
            if (target.endsWith('/connect') && process.env.TEST_FAILURE === 'route') return new Response('<html>Not found</html>', { status: 404 });
            if (target.endsWith('/getWebhookInfo') && process.env.TEST_FAILURE === 'webhook') return new Response(JSON.stringify({ ok: true, result: { url: 'https://example.test/private-hook' } }), { status: 200 });
            let result;
            if (target.endsWith('/getMe')) result = { ok: true, result: { username: 'TestWorkerBot' } };
            else if (target.endsWith('/getWebhookInfo')) result = { ok: true, result: { url: '' } };
            else if (target.endsWith('/setMyCommands')) {
                assert.ok(body.commands.some(c => c.command === 'unlink'));
                assert.ok(!body.commands.some(c => c.command === 'history'));
                assert.ok(!body.commands.some(c => ['register', 'link'].includes(c.command)));
                result = { ok: true, result: true };
            } else if (target.endsWith('/connect')) {
                assert.equal(body.username, 'TestWorkerBot');
                assert.equal(options.headers['X-Bot-Secret'], process.env.TELEGRAM_BOT_SECRET);
                result = { offset: 4 };
            } else if (target.endsWith('/pending-actions')) { result = { actions: [] };
            } else if (target.endsWith('/getUpdates')) {
                if (process.env.TEST_CONFLICT) return new Response(JSON.stringify({ ok: false }), { status: 409 });
                if (++polls === 1) { assert.equal(body.offset, 4); result = { ok: true, result: [{ update_id: 4, message: { text: '/start' } }] }; }
                else {
                    assert.equal(body.offset, 5); assert.ok(forwarded); assert.ok(delivered); assert.ok(deleted); assert.ok(acknowledged); assert.ok(sentReceipt); assert.ok(lateDeleted); assert.ok(lateAcknowledged);
                    console.log('worker-lifecycle-verified'); process.emit('SIGTERM');
                    result = { ok: true, result: [] };
                }
            } else if (target.endsWith('/update')) {
                assert.equal(body.update_id, 4); forwarded = true;
                result = { actions: [{ id: 'cleanup-test', method: 'deleteMessages', body: { chat_id: 123, message_ids: [21, 22] } }, { method: process.env.TEST_EDIT ? 'editMessageText' : 'sendMessage', body: { chat_id: 123, text: 'fixture reply', ...(process.env.TEST_EDIT ? { message_id: 30 } : {}) } }] };
            } else if (target.endsWith('/editMessageText')) {
                assert.equal(body.message_id, 30);
                if (process.env.TEST_EDIT === 'missing') return new Response(JSON.stringify({ ok: false, description: 'message to edit not found' }), { status: 400 });
                delivered = true;
                if (process.env.TEST_EDIT === 'unchanged') return new Response(JSON.stringify({ ok: false, description: 'Bad Request: message is not modified' }), { status: 400 });
                result = { ok: true, result: { message_id: 30 } };
            } else if (target.endsWith('/sendMessage')) {
                assert.equal(body.chat_id, 123); assert.equal(body.text, 'fixture reply'); delivered = true;
                result = { ok: true, result: { message_id: 31 } };
            } else if (target.endsWith('/deleteMessages')) {
                if (body.message_ids[0] === 21) { assert.deepEqual(body.message_ids, [21, 22]); deleted = true; }
                else { assert.deepEqual(body.message_ids, [29]); lateDeleted = true; }
                if (process.env.TEST_DELETE_FAIL) return new Response(JSON.stringify({ ok: false }), { status: 403 });
                result = { ok: true, result: true };
            } else if (target.endsWith('/delivery')) {
                assert.equal(body.chat_id, 123);
                if (['sent', 'edited'].includes(body.kind)) {
                    if (process.env.TEST_RECEIPT_RETRY && receiptAttempts++ === 0) return new Response(JSON.stringify({ parameters: { retry_after: 1 } }), { status: 503 });
                    const edited = ['ok', 'unchanged'].includes(process.env.TEST_EDIT);
                    assert.equal(body.kind, edited ? 'edited' : 'sent');
                    assert.equal(body.message_id, edited ? 30 : 31); sentReceipt = true;
                    result = { success: true, actions: [{ id: 'cleanup-after-screen', method: 'deleteMessages', body: { chat_id: 123, message_ids: [29] } }] };
                } else {
                    assert.equal(body.kind, process.env.TEST_DELETE_FAIL ? 'delete_failed' : 'deleted');
                    if (body.operation_id === 'cleanup-test') acknowledged = true;
                    else { assert.equal(body.operation_id, 'cleanup-after-screen'); lateAcknowledged = true; }
                    result = { success: true };
                }
            } else throw new Error('Unexpected method');
            return new Response(JSON.stringify(result), { status: 200 });
        };
    `);
    const env = { ...process.env, telegrambotapi: 'test-token-must-stay-secret', AUTH_API_URL: 'http://127.0.0.1:1', TELEGRAM_BOT_SECRET: 'test-only-shared-secret-32-characters', TELEGRAM_DELIVERY_STATE_FILE: path.join(dir, 'delivery-receipts.json') };
    const args = ['--require', preload, path.join(__dirname, '../apps/bot/bot.js')];
    const normal = spawnSync(process.execPath, args, { env: { ...env, TEST_CONFLICT: '' }, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(normal.status, 0, normal.stderr);
    assert.ok(normal.stdout.includes('worker-lifecycle-verified'));
    const standalone = path.join(dir, 'standalone');
    fs.mkdirSync(standalone);
    fs.copyFileSync(path.join(__dirname, '../apps/bot/bot.js'), path.join(standalone, 'bot.js'));
    fs.writeFileSync(path.join(standalone, '.env'), 'telegrambotapi=test-standalone-token\nAUTH_API_URL=http://127.0.0.1:1\nTELEGRAM_BOT_SECRET=test-only-shared-secret-32-characters\n');
    const standaloneEnv = { ...env, TEST_CONFLICT: '' };
    for (const key of ['telegrambotapi', 'AUTH_API_URL', 'TELEGRAM_BOT_SECRET', 'TELEGRAM_DELIVERY_STATE_FILE']) delete standaloneEnv[key];
    for (const [entry, workerEnv] of [
        [path.join(__dirname, '../bot/bot.js'), { ...env, TEST_CONFLICT: '' }],
        [path.join(standalone, 'bot.js'), standaloneEnv],
    ]) {
        const worker = spawnSync(process.execPath, ['--require', preload, entry], { cwd: dir, env: workerEnv, encoding: 'utf8', timeout: 5000 });
        assert.equal(worker.status, 0, worker.stderr);
        assert.ok(worker.stdout.includes('worker-lifecycle-verified'));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(standalone, '.delivery-receipts.json'), 'utf8')), []);
    for (const mode of ['ok', 'missing', 'unchanged']) {
        const edited = spawnSync(process.execPath, args, { env: { ...env, TEST_EDIT: mode, TEST_CONFLICT: '' }, encoding: 'utf8', timeout: 5000 });
        assert.equal(edited.status, 0, edited.stderr);
        assert.ok(edited.stdout.includes('worker-lifecycle-verified'), mode + edited.stderr);
    }
    const receiptRetry = spawnSync(process.execPath, args, { env: { ...env, TEST_RECEIPT_RETRY: '1', TEST_CONFLICT: '' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(receiptRetry.status, 0, receiptRetry.stderr);
    assert.ok(receiptRetry.stdout.includes('worker-lifecycle-verified'));
    assert.deepEqual(JSON.parse(fs.readFileSync(env.TELEGRAM_DELIVERY_STATE_FILE, 'utf8')), []);
    const cleanupFailure = spawnSync(process.execPath, args, { env: { ...env, TEST_DELETE_FAIL: '1', TEST_CONFLICT: '' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(cleanupFailure.status, 0, cleanupFailure.stderr);
    assert.ok(cleanupFailure.stdout.includes('worker-lifecycle-verified'));
    assert.ok(cleanupFailure.stderr.includes('retry is scheduled'));
    const conflict = spawnSync(process.execPath, args, { env: { ...env, TEST_CONFLICT: '1' }, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(conflict.status, 1);
    assert.ok(conflict.stderr.includes('Bot stopped'));
    assert.ok(conflict.stderr.includes('Telegram getUpdates: HTTP 409'), conflict.stderr);
    assert.ok(!(normal.stdout + normal.stderr + conflict.stdout + conflict.stderr).includes(env.telegrambotapi));
    for (const [failure, expected] of [
        ['network', 'Telegram getMe: connection failed or timed out'],
        ['token', 'Telegram getMe: HTTP 401'],
        ['secret', 'Backend connect: HTTP 401'],
        ['route', 'Backend connect: HTTP 404'],
        ['webhook', 'active webhook'],
    ]) {
        const result = spawnSync(process.execPath, args, { env: { ...env, TEST_CONFLICT: '', TEST_FAILURE: failure }, encoding: 'utf8', windowsHide: true, timeout: 5000 });
        assert.equal(result.status, 1);
        assert.ok(result.stderr.includes(expected), result.stderr);
        assert.ok(!(result.stdout + result.stderr).includes(env.telegrambotapi));
        assert.ok(!(result.stdout + result.stderr).includes(env.TELEGRAM_BOT_SECRET));
    }
});

async function fixture(t, initialUsers = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-auth-test-'));
    const users = structuredClone(initialUsers);
    const secret = 'test-only-shared-secret-32-characters';
    let time = Date.now(), server, base, updateId = 1, messageId = 1, saves = 0;
    const events = [];
    const startServer = async () => {
        const app = express(); app.use(express.json());
        installTelegramAuth(app, { users, dataDir: dir, secret, launcherDownloadURL: 'https://launcher.example', now: () => time, audit: (req, login, category, action, details) => events.push({ login, category, action, ...details }), saveUsers: () => {
            saves++; fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(users));
        } });
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    };
    await startServer();
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const api = async (route, body, headers = {}, method = 'POST') => {
        const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: r.status, body: await r.json() };
    };
    const worker = (route, body) => api('/api/internal/telegram/' + route, body, { 'X-Bot-Secret': secret });
    const message = (id, text, username = '') => worker('update', { update_id: updateId++, message: { message_id: messageId++, date: Math.floor(time / 1000), chat: { id, type: 'private' }, from: { id, ...(username ? { username } : {}) }, text } });
    const callback = (id, data, username = '') => worker('update', { update_id: updateId++, callback_query: { id: 'callback', data, from: { id, ...(username ? { username } : {}) }, message: { message_id: messageId++, date: Math.floor(time / 1000), chat: { id, type: 'private' } } } });
    const begin = async () => {
        const r = await api('/api/auth/telegram/challenges', {});
        assert.equal(r.status, 200);
        return { ...r.body, headers: { 'X-Poll-Secret': r.body.poll_secret }, route: `/api/auth/telegram/challenges/${r.body.id}` };
    };
    return { users, dir, events, api, worker, message, callback, begin,
        advance: ms => { time += ms; }, saves: () => saves,
        restart: async () => { await new Promise(resolve => server.close(resolve)); await startServer(); },
        connect: () => worker('connect', { username: 'TestAuthBot' }),
        poll: c => api(c.route, undefined, c.headers, 'GET'),
        exchange: c => api(c.route + '/exchange', {}, c.headers),
        me: token => api('/api/auth/me', undefined, { Authorization: `Bearer ${token}` }, 'GET'),
        start: (id, c) => message(id, '/start ' + new URL(c.url).searchParams.get('start')),
    };
}
const buttons = reply => reply.body.actions.flatMap(a => a.body.reply_markup?.inline_keyboard?.flat() || []);
const buttonData = (reply, prefix) => buttons(reply).find(b => b.callback_data?.startsWith(prefix))?.callback_data;
const replyText = reply => reply.body.actions.map(a => a.body.text || '').join('\n');
async function newPassword(f, id, password = 'secure-password-123') { await f.message(id, password); return f.message(id, password); }
const savedState = f => JSON.parse(fs.readFileSync(path.join(f.dir, 'telegram-auth-state.json'), 'utf8'));

test('unlinked users only get the download and code flow; old commands and buttons cannot register or link', async t => {
    const f = await fixture(t, { existing: { nickname: 'Existing', password: hashPassword('existing-password') } });
    await f.connect();
    for (const action of ['/start', '/register', '/link', '/account', '/password', 'menu:register', 'menu:link', 'bind:old-nonce']) {
        const result = action.startsWith('/') ? await f.message(100, action) : await f.callback(100, action);
        assert.ok(buttons(result).some(b => b.url === 'https://launcher.example/'));
        assert.equal(buttonData(result, 'menu:register'), undefined);
        assert.equal(buttonData(result, 'menu:link'), undefined);
        assert.ok(buttonData(result, 'menu:login'));
        assert.match(replyText(result), /начните с лаунчера/);
        await f.message(100, 'Existing'); await newPassword(f, 100, 'existing-password');
        assert.equal(f.users.existing.telegramId, undefined);
        assert.equal(f.saves(), 0);
        assert.equal(savedState(f).conversations['100'], undefined);
    }
    await f.callback(100, 'menu:login');
    assert.match(replyText(await f.message(100, 'Existing')), /Код неверный/);
    const c = await f.begin(); await f.start(100, c);
    await f.callback(100, `yes:${c.code}`); await f.message(100, 'Existing');
    assert.equal((await f.poll(c)).body.step, 'awaiting_code');
    assert.equal(f.saves(), 0);
});

test('linked accounts cannot reopen login by command or old button, and blocked login preserves pending actions', async t => {
    const f = await fixture(t, { account: { nickname: 'Player', password: hashPassword('existing-password'), telegramId: '100' } });
    await f.connect();
    assert.equal(buttonData(await f.message(100, '/account'), 'menu:login'), undefined);
    for (const action of ['/login', '/login@TestAuthBot', 'menu:login']) {
        const result = action.startsWith('/') ? await f.message(100, action) : await f.callback(100, action);
        assert.match(replyText(result), /команда \/login недоступна/);
        assert.equal(buttonData(result, 'menu:login'), undefined);
        assert.equal(savedState(f).conversations['100'], undefined);
    }
    await f.message(100, '/password');
    const passwordContext = savedState(f).conversations['100'];
    await f.message(100, '/login');
    assert.deepEqual(savedState(f).conversations['100'], passwordContext);
    await f.message(100, '/cancel');
    await f.restart();
    assert.match(replyText(await f.message(100, '/login')), /команда \/login недоступна/);
    const c = await f.begin();
    await f.start(100, c);
    assert.match(replyText(await f.message(100, c.code)), /Подтвердите вход/);
    const before = savedState(f);
    await f.callback(100, 'menu:login');
    const after = savedState(f);
    assert.deepEqual(after.conversations['100'], before.conversations['100']);
    assert.deepEqual(after.challenges[c.id], before.challenges[c.id]);
    await f.callback(100, `yes:${c.code}`);
    assert.equal((await f.poll(c)).body.status, 'confirmed');
    assert.equal((await f.exchange(c)).status, 200);
});

test('pre-upgrade standalone conversations and unverified challenge stages cannot complete onboarding after restart', async t => {
    const f = await fixture(t); await f.connect();
    const c = await f.begin();
    const state = savedState(f), passwordHash = hashPassword('legacy-password');
    const stages = ['nickname', 'link_password', 'register_password', 'register_password_confirm', 'confirm'];
    for (const [i, stage] of stages.entries()) state.conversations[100 + i] = {
        stage, nickname: 'LegacyPlayer', passwordHash, nonce: 'legacy-nonce', expires_at: Date.now() + 600000,
    };
    state.conversations['200'] = { stage: 'nickname', challengeId: c.id, expires_at: Date.now() + 600000 };
    fs.writeFileSync(path.join(f.dir, 'telegram-auth-state.json'), JSON.stringify(state));
    await f.restart();
    for (const id of [100, 101, 102, 103, 104, 200]) {
        const result = id === 104 ? await f.callback(id, 'bind:legacy-nonce') : await f.message(id, 'legacy-password');
        assert.match(replyText(result), /начните с лаунчера/);
        assert.equal(savedState(f).conversations[id], undefined);
    }
    assert.equal(f.saves(), 0);
    assert.deepEqual(f.users, {});
});

test('nickname correction clears password data at every registration step and keeps the original code expiry', async t => {
    for (const stage of ['register_password', 'register_password_confirm', 'confirm']) await t.test(stage, async t => {
        const original = { nickname: 'Existing', password: hashPassword('existing-password'), email: 'keep@example.test' };
        const f = await fixture(t, { existing: original }); await f.connect();
        const c = await f.begin(); await f.message(100, c.code);
        const prompt = await f.message(100, 'Exsting');
        assert.match(replyText(prompt), /не найден/); assert.match(replyText(prompt), /опечатка/);
        assert.ok(buttonData(prompt, 'nick:')); assert.ok(buttonData(prompt, 'menu:cancel'));
        const invalid = await f.message(100, 'short');
        assert.match(replyText(invalid), /опечатка/); assert.ok(buttonData(invalid, 'nick:'));
        let screen = prompt;
        if (stage !== 'register_password') screen = await f.message(100, 'discarded-password');
        if (stage === 'confirm') screen = await f.message(100, 'discarded-password');
        assert.match(replyText(screen), /опечатка/);
        assert.ok(buttonData(screen, 'menu:cancel'));
        await f.restart(); f.advance(10000);
        const beforeCorrection = savedState(f).challenges[c.id];
        const choice = await f.callback(100, buttonData(screen, 'nick:'));
        assert.match(replyText(choice), /Пароль потребуется ввести заново/);
        assert.deepEqual(savedState(f).challenges[c.id], beforeCorrection, 'opening correction must preserve entered credentials');
        await f.callback(100, `yes:${c.code}`);
        assert.equal(f.saves(), 0, 'confirmation must wait for leaving the correction dialog');
        const resumed = await f.callback(100, buttonData(choice, 'nick_keep:'));
        assert.equal(savedState(f).conversations['100'].stage, stage);
        assert.deepEqual(savedState(f).challenges[c.id], beforeCorrection);
        assert.ok(buttonData(resumed, 'nick:'));
        const secondChoice = await f.callback(100, buttonData(resumed, 'nick:'));
        await f.restart();
        const reset = await f.callback(100, buttonData(secondChoice, 'nick_reset:'));
        assert.match(replyText(reset), /Введите игровой ник/);
        assert.equal(buttonData(reset, 'nick:'), undefined, 'nickname entry itself must not offer nickname correction');
        const pending = savedState(f).challenges[c.id];
        assert.equal(pending.step, 'awaiting_nickname'); assert.equal(pending.expires_at, c.expires_at);
        for (const field of ['nickname', 'login', 'passwordHash', 'verifiedPasswordHash']) assert.equal(pending[field], undefined);
        await f.callback(100, `yes:${c.code}`);
        assert.equal(f.saves(), 0, 'an earlier confirmation cannot bypass re-entering the nickname and password');
        await f.message(100, 'existing');
        const wrongPassword = await f.message(100, 'discarded-password');
        assert.match(replyText(wrongPassword), /Неверный пароль/);
        assert.ok(buttonData(wrongPassword, 'nick:'));
        const confirmation = await f.message(100, 'existing-password');
        assert.ok(buttons(confirmation).some(b => b.text === '✅ Привязать и войти'));
        const existingChoice = await f.callback(100, buttonData(confirmation, 'nick:'));
        const existingResumed = await f.callback(100, buttonData(existingChoice, 'nick_keep:'));
        await f.callback(100, buttonData(existingResumed, 'yes:'));
        assert.equal((await f.exchange(c)).body.user.login, 'existing');
        const { lastLogin, ...bound } = f.users.existing;
        assert.deepEqual(bound, { ...original, telegramId: '100', telegramUsername: '' });
        assert.ok(lastLogin);
        assert.equal(Object.keys(f.users).length, 1);
    });
});

test('registration password mismatch retains the nickname warning and correction controls', async t => {
    const f = await fixture(t); await f.connect(); const c = await f.begin();
    await f.message(100, c.code); await f.message(100, 'NewPlayer');
    await f.message(100, 'first-password');
    const mismatch = await f.message(100, 'other-password');
    assert.match(replyText(mismatch), /Пароли не совпадают/);
    assert.match(replyText(mismatch), /опечатка/);
    assert.ok(buttonData(mismatch, 'nick:')); assert.ok(buttonData(mismatch, 'menu:cancel'));
    const choice = await f.callback(100, buttonData(mismatch, 'nick:'));
    await f.callback(100, buttonData(choice, 'nick_reset:')); await f.message(100, 'Corrected');
    const confirmation = await newPassword(f, 100, 'replacement-password');
    assert.ok(buttons(confirmation).some(b => b.text === '✅ Зарегистрироваться и привязать'));
    await f.callback(100, buttonData(confirmation, 'yes:'));
    assert.equal(f.users.tg_100.nickname, 'Corrected');
    assert.ok(verifyPassword('replacement-password', f.users.tg_100.password));
    assert.equal(verifyPassword('first-password', f.users.tg_100.password), false);
});

test('cancelling at every onboarding step creates no account and closes the launcher request', async t => {
    for (const stage of ['nickname', 'register_password', 'register_password_confirm', 'confirm', 'nickname_correction']) await t.test(stage, async t => {
        const f = await fixture(t); await f.connect(); const c = await f.begin();
        let screen = await f.message(100, c.code);
        if (stage !== 'nickname') screen = await f.message(100, 'NewPlayer');
        if (['register_password_confirm', 'confirm'].includes(stage)) screen = await f.message(100, 'cancelled-password');
        if (stage === 'confirm') screen = await f.message(100, 'cancelled-password');
        if (stage === 'nickname_correction') screen = await f.callback(100, buttonData(screen, 'nick:'));
        const cancelled = await f.callback(100, buttonData(screen, 'menu:cancel'));
        assert.match(replyText(cancelled), /отменено/);
        assert.ok(buttons(cancelled).some(b => b.url));
        assert.equal((await f.poll(c)).body.status, 'cancelled');
        assert.equal(savedState(f).challenges[c.id].passwordHash, undefined);
        await f.callback(100, `yes:${c.code}`); await f.callback(100, `nick:${c.code}`);
        assert.equal((await f.exchange(c)).status, 409);
        assert.equal(f.saves(), 0); assert.deepEqual(f.users, {});
    });
});

test('expired codes cannot register via text, nickname correction or confirmation buttons', async t => {
    for (const action of ['password', 'nick', 'yes', 'nick_reset', 'nick_keep']) await t.test(action, async t => {
        const f = await fixture(t); await f.connect(); const c = await f.begin();
        await f.message(100, c.code); await f.message(100, 'ExpiredPlayer');
        if (action !== 'password') await newPassword(f, 100);
        if (action.startsWith('nick_')) await f.callback(100, `nick:${c.code}`);
        f.advance(300001);
        const result = action === 'password' ? await f.message(100, 'expired-password') : await f.callback(100, `${action}:${c.code}`);
        assert.match(replyText(result), /истёк/);
        assert.equal((await f.poll(c)).body.status, 'expired');
        assert.equal((await f.exchange(c)).status, 409);
        assert.equal(savedState(f).challenges[c.id].passwordHash, undefined);
        assert.equal(f.saves(), 0); assert.deepEqual(f.users, {});
    });
});

test('manual code is required before nickname, explicit confirmation and persistent sessions', async t => {
    const f = await fixture(t);
    assert.equal((await f.api('/api/auth/telegram/challenges', {})).status, 503);
    assert.equal((await f.api('/api/internal/telegram/connect', { username: 'TestAuthBot' })).status, 401);
    await f.connect();
    const c = await f.begin();
    assert.match(c.code, /^[A-F0-9]{8}$/);
    assert.equal(new URL(c.url).searchParams.get('start').length, 43);
    assert.equal((await f.api(c.route, undefined, {}, 'GET')).status, 404);
    await f.start(100, c);
    assert.equal((await f.poll(c)).body.step, 'awaiting_code');
    await f.message(100, 'NewPlayer');
    await f.callback(100, `yes:${c.code}`);
    assert.equal(f.saves(), 0);
    assert.equal((await f.exchange(c)).status, 409);
    await f.message(100, c.code.toLowerCase().slice(0, 4) + '-' + c.code.slice(4));
    assert.equal((await f.poll(c)).body.step, 'awaiting_nickname');
    await f.restart(); // unfinished conversations survive backend restarts
    await f.message(100, 'NewPlayer');
    assert.equal((await f.poll(c)).body.step, 'awaiting_password');
    await newPassword(f, 100);
    assert.equal((await f.poll(c)).body.step, 'awaiting_confirmation');
    assert.equal(f.saves(), 0);
    await f.callback(101, `yes:${c.code}`);
    assert.equal((await f.exchange(c)).status, 409);
    await f.callback(100, `yes:${c.code}`);
    assert.equal(f.users.tg_100.registrationStatus, 'pending');
    const exchange = await f.exchange(c);
    assert.equal(exchange.status, 200);
    assert.equal(exchange.body.user.nickname, 'NewPlayer');
    assert.equal((await f.exchange(c)).status, 409);
    const token = exchange.body.token;
    assert.equal((await f.me(token)).status, 200);
    const persisted = fs.readFileSync(path.join(f.dir, 'telegram-auth-state.json'), 'utf8');
    assert.ok(!persisted.includes(token));
    assert.ok(!persisted.includes(c.poll_secret));
    await f.restart();
    assert.equal((await f.me(token)).status, 200);
    f.users.tg_100.registrationStatus = 'banned';
    assert.equal((await f.me(token)).status, 401);
    f.users.tg_100.registrationStatus = 'confirmed';
    assert.equal((await f.api('/api/auth/logout', {}, { Authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await f.me(token)).status, 401);
});

test('existing unlinked nickname attaches case-insensitively without replacing account data', async t => {
    const original = { nickname: 'Reserved', password: hashPassword('account-password'), email: 'player@example.test', registrationStatus: 'confirmed', registeredAt: 42 };
    const f = await fixture(t, { existing: original }); await f.connect();
    const c = await f.begin();
    await f.message(100, c.code); // opening a deep link is optional
    await f.message(100, 'rEsErVeD');
    await f.message(100, 'account-password');
    assert.equal(f.saves(), 0);
    await f.callback(100, `yes:${c.code}`);
    assert.deepEqual(f.users.existing, { ...original, telegramId: '100', telegramUsername: '' });
    assert.equal(Object.keys(f.users).length, 1);
    assert.equal((await f.exchange(c)).body.user.login, 'existing');
    const next = await f.begin();
    await f.start(100, next);
    await f.start(100, next); // reopening the link must not cancel the request
    await f.message(100, next.code);
    assert.equal((await f.poll(next)).body.step, 'awaiting_confirmation');
    await f.callback(100, `yes:${next.code}`);
    assert.equal((await f.exchange(next)).status, 200);
});

test('nickname conflicts, bans, duplicates and concurrent claims are rechecked at confirmation', async t => {
    const f = await fixture(t, {
        linked: { nickname: 'Taken', telegramId: '999', registrationStatus: 'confirmed' },
        banned: { nickname: 'Banned', registrationStatus: 'banned' },
        one: { nickname: 'Duplicate' }, two: { nickname: 'duplicate' },
    }); await f.connect();
    const a = await f.begin(), b = await f.begin();
    await f.message(100, a.code); await f.message(101, b.code);
    for (const nick of ['Taken', 'Banned', 'Duplicate', '<b>bad</b>']) {
        await f.message(100, nick);
        assert.equal((await f.poll(a)).body.step, 'awaiting_nickname');
    }
    await f.message(100, 'NewPlayer'); await f.message(101, 'newplayer');
    await newPassword(f, 100); await newPassword(f, 101);
    await f.callback(100, `yes:${a.code}`); await f.callback(101, `yes:${b.code}`);
    assert.equal((await f.exchange(a)).status, 200);
    assert.equal((await f.exchange(b)).status, 409);
    assert.equal(f.users.tg_101, undefined);
    assert.equal(f.users.linked.telegramId, '999');
    assert.equal(f.users.banned.telegramId, undefined);
});

test('menu, code-based linking and confirmed unlink revoke sessions and pending exchanges permanently', async t => {
    const f = await fixture(t); await f.connect();
    const welcome = await f.message(100, '/start');
    assert.ok(buttonData(welcome, 'menu:login'));
    assert.equal(welcome.body.actions[0].body.parse_mode, 'HTML');
    await f.callback(100, 'menu:login');
    const initial = await f.begin(); await f.message(100, initial.code);
    await f.message(100, 'NewPlayer');
    const preview = await newPassword(f, 100);
    const bind = buttonData(preview, 'yes:');
    await f.callback(101, bind); assert.equal(f.saves(), 0);
    await f.callback(100, bind); assert.equal(f.users.tg_100.telegramId, '100');
    await f.callback(100, bind); assert.equal(f.saves(), 1);
    assert.match(replyText(await f.message(100, '/account')), /NewPlayer/);
    const a = await f.begin(); await f.message(100, a.code); await f.callback(100, `yes:${a.code}`);
    const first = await f.exchange(a);
    const b = await f.begin(); await f.message(100, b.code); await f.callback(100, `yes:${b.code}`);
    const second = await f.exchange(b);
    const c = await f.begin(); await f.message(100, c.code); await f.callback(100, `yes:${c.code}`);
    // A second pending registration must not survive detaching the current account.
    const d = await f.begin(); await f.message(100, d.code);
    const unlink = buttonData(await f.callback(100, 'menu:unlink'), 'unlink:');
    assert.equal((await f.me(first.body.token)).status, 200, 'unlink requires confirmation');
    await f.callback(101, unlink); assert.equal(f.users.tg_100.telegramId, '100');
    await f.callback(100, unlink);
    assert.equal(f.users.tg_100.telegramId, undefined);
    assert.equal(f.users.tg_100.nickname, 'NewPlayer');
    assert.equal((await f.me(first.body.token)).status, 401);
    assert.equal((await f.me(second.body.token)).status, 401);
    assert.equal((await f.poll(c)).body.status, 'cancelled');
    assert.equal((await f.poll(d)).body.status, 'cancelled');
    assert.equal((await f.exchange(c)).status, 409);
    f.advance(60001); // The initial binding and four login codes used this minute's allowance.
    await f.message(100, '/link');
    const relink = await f.begin(); await f.message(100, relink.code);
    await f.message(100, 'NewPlayer');
    const rebind = buttonData(await f.message(100, 'secure-password-123'), 'yes:');
    await f.callback(100, rebind);
    assert.equal(f.users.tg_100.telegramId, '100');
    await f.callback(100, unlink); // stale unlink button cannot detach the new binding
    assert.equal(f.users.tg_100.telegramId, '100');
    assert.equal((await f.me(first.body.token)).status, 401);
    await f.restart(); assert.equal((await f.me(first.body.token)).status, 401);
    assert.equal(Object.keys(f.users).length, 1);
});

test('cancellation, rejection, expiration, bans and replay cannot exchange a request', async t => {
    const f = await fixture(t, { player: { nickname: 'Player', telegramId: '100', registrationStatus: 'confirmed' } });
    await f.connect();
    for (const mode of ['rejected', 'cancelled', 'expired', 'banned']) {
        f.advance(61000);
        const c = await f.begin(); await f.start(100, c); await f.message(100, c.code);
        if (mode === 'rejected') await f.callback(100, `no:${c.code}`);
        if (mode === 'cancelled') await f.api(c.route, undefined, c.headers, 'DELETE');
        if (mode === 'expired') f.advance(300001);
        if (mode === 'banned') {
            await f.callback(100, `yes:${c.code}`);
            f.users.player.registrationStatus = 'banned';
        } else await f.callback(100, `yes:${c.code}`);
        assert.equal((await f.exchange(c)).status, mode === 'banned' ? 403 : 409);
        if (mode !== 'banned') assert.equal((await f.poll(c)).body.status, mode);
    }
    assert.equal(buttonData(await f.message(100, '/unlink'), 'unlink:'), undefined);
    assert.ok((await f.worker('update', { update_id: 0 })).body.actions.every(action => action.method === 'deleteMessages'), 'duplicate updates may only retry cleanup');
});

test('wrong code attempts are limited, including after backend restart', async t => {
    const f = await fixture(t); await f.connect(); const c = await f.begin();
    await f.start(100, c);
    for (let i = 0; i < 5; i++) await f.message(100, 'wrong-code');
    await f.restart();
    assert.match(replyText(await f.message(100, c.code)), /Слишком много попыток/);
    assert.equal((await f.poll(c)).body.step, 'awaiting_code');
    f.advance(60001);
    await f.message(100, c.code);
    assert.equal((await f.poll(c)).body.step, 'awaiting_nickname');
    await f.message(100, '/cancel');
    assert.equal((await f.poll(c)).body.status, 'cancelled');
});

test('unlink between confirmation and exchange prevents granting a session to a different owner', async t => {
    const f = await fixture(t, { player: { nickname: 'Player', telegramId: '100' } });
    await f.connect(); const c = await f.begin();
    await f.message(100, c.code); await f.callback(100, `yes:${c.code}`);
    f.users.player.telegramId = '200';
    assert.equal((await f.exchange(c)).status, 403);
});

test('switching nick after unlink preserves the previous account and never overwrites its login', async t => {
    const f = await fixture(t, { tg_100: { nickname: 'Previous', password: null, registrationStatus: 'pending' } });
    await f.connect();
    await f.message(100, '/link');
    const c = await f.begin(); await f.message(100, c.code);
    await f.message(100, 'Another');
    const bind = buttonData(await newPassword(f, 100), 'yes:');
    await f.callback(100, bind);
    assert.deepEqual(f.users.tg_100, { nickname: 'Previous', password: null, registrationStatus: 'pending' });
    const linked = Object.entries(f.users).find(([, user]) => user.telegramId === '100');
    assert.match(linked[0], /^tg_100_[a-f0-9]{8}$/);
    assert.equal(linked[1].nickname, 'Another');
    assert.match(replyText(await f.message(100, '/link')), /уже привязан/);
    assert.equal(Object.keys(f.users).length, 2);
});

test('group messages and mismatched private identities cannot bind or claim a code', async t => {
    const f = await fixture(t); await f.connect(); const c = await f.begin();
    const ignored = await f.worker('update', { update_id: 100, message: {
        from: { id: 100 }, chat: { id: -100, type: 'group' }, text: c.code,
    } });
    assert.deepEqual(ignored.body.actions, []);
    const mismatch = await f.worker('update', { update_id: 101, message: {
        from: { id: 100 }, chat: { id: 101, type: 'private' }, text: c.code,
    } });
    assert.deepEqual(mismatch.body.actions, []);
    assert.equal((await f.poll(c)).body.step, 'awaiting_code');
    assert.equal(f.saves(), 0);
});

test('established binding identifies a returning player despite legacy duplicate nicknames', async t => {
    const f = await fixture(t, {
        linked: { nickname: 'Player', telegramId: '100' },
        duplicate: { nickname: 'PLAYER' },
    }); await f.connect();
    const c = await f.begin();
    await f.message(100, c.code); await f.callback(100, `yes:${c.code}`);
    assert.equal((await f.exchange(c)).body.user.login, 'linked');
    const next = await f.begin(); await f.message(100, next.code);
    f.users.linked.registrationStatus = 'banned';
    await f.callback(100, `yes:${next.code}`);
    assert.equal((await f.poll(next)).body.status, 'rejected');
    assert.equal((await f.exchange(next)).status, 409);
});

test('password registration tracks usernames, removes the whole known dialogue and retries cleanup after restart', async t => {
    const f = await fixture(t); await f.connect();
    await f.message(100, '/register', 'FirstName');
    const c = await f.begin(); await f.message(100, c.code, 'FirstName');
    await f.worker('delivery', { kind: 'sent', chat_id: 100, message_id: 500 });
    await f.worker('delivery', { kind: 'sent', chat_id: 100, message_id: 501 });
    await f.message(100, 'Registered', 'FirstName');
    await f.message(100, 'short', 'FirstName');
    assert.equal(f.users.tg_100, undefined);
    const password = 'private-registration-password';
    const first = await f.message(100, password, 'FirstName');
    assert.equal(first.body.actions.filter(a => ['sendMessage', 'editMessageText'].includes(a.method)).length, 1);
    assert.ok((await f.worker('pending-actions', {})).body.actions.length > 0);
    await f.message(100, 'does-not-match', 'FirstName');
    const confirmation = await f.message(100, password, 'FirstName');
    assert.equal(f.users.tg_100, undefined, 'registration still requires explicit confirmation');
    const result = await f.callback(100, buttonData(confirmation, 'yes:'), 'FirstName');
    assert.ok(verifyPassword(password, f.users.tg_100.password));
    assert.ok(!replyText(result).includes(password));
    const tasks = (await f.worker('pending-actions', {})).body.actions;
    assert.ok(tasks.some(a => a.body.message_ids.includes(500)), 'outdated bot replies are included');
    assert.ok(!tasks.some(a => a.body.message_ids.includes(501)), 'the active bot screen is preserved');
    assert.ok(tasks.flatMap(a => a.body.message_ids).includes(1), 'the first registration message is included');
    const task = tasks[0];
    await f.worker('delivery', { kind: 'delete_failed', chat_id: 100, operation_id: task.id, code: 403 });
    await f.restart(); f.advance(30001);
    assert.ok((await f.worker('pending-actions', {})).body.actions.some(a => a.id === task.id));
    await f.worker('delivery', { kind: 'deleted', chat_id: 100, operation_id: task.id });
    assert.ok(!(await f.worker('pending-actions', {})).body.actions.some(a => a.id === task.id));
    await f.message(100, '/account', 'UpdatedName');
    assert.equal(f.users.tg_100.telegramUsername, 'UpdatedName');
    assert.ok(f.events.some(e => e.telegramUsername === 'FirstName'));
    assert.ok(f.events.some(e => e.action === 'telegram_username_changed' && e.telegramUsername === 'UpdatedName'));
    const persisted = fs.readFileSync(path.join(f.dir, 'telegram-auth-state.json'), 'utf8');
    assert.ok(!persisted.includes(password) && !persisted.includes('does-not-match'));
    assert.ok(!JSON.stringify(f.events).includes(password));
});

test('cabinet edits profile, changes password and revokes all launcher sessions without exposing secrets', async t => {
    const f = await fixture(t, { account: { nickname: 'Player', password: hashPassword('old-password-123'), telegramId: '100', registrationStatus: 'confirmed', registeredAt: 42 } });
    await f.connect();
    const c = await f.begin(); await f.message(100, c.code); await f.callback(100, `yes:${c.code}`);
    const token = (await f.exchange(c)).body.token;
    assert.match(replyText(await f.message(100, '/account')), /Личный кабинет/);
    await f.callback(100, 'menu:nickname'); await f.message(100, 'RenamedPlayer');
    assert.equal(f.users.account.nickname, 'RenamedPlayer');
    await f.callback(100, 'menu:email'); await f.message(100, 'player@example.test');
    assert.equal(f.users.account.email, 'player@example.test');
    assert.match(replyText(await f.callback(100, 'menu:sessions')), /Telegram-сессий: 1/);
    const confirm = buttonData(await f.callback(100, 'menu:revoke'), 'revoke:');
    await f.callback(100, confirm); assert.equal((await f.me(token)).status, 401);
    await f.message(100, '/password');
    assert.match(replyText(await f.message(100, 'wrong-password')), /Неверный пароль/);
    await f.message(100, 'old-password-123');
    await newPassword(f, 100, 'new-private-password');
    assert.ok(verifyPassword('new-private-password', f.users.account.password));
    assert.ok(!verifyPassword('old-password-123', f.users.account.password));
    assert.equal(f.users.account.sessionVersion, 1);
    assert.ok(f.events.some(e => e.action === 'password_changed'));
    assert.ok(!f.events.some(e => ['bot_command', 'bot_message', 'bot_click', 'messages_deleted', 'message_cleanup_failed'].includes(e.action)));
    const removedHistory = await f.message(100, '/history');
    assert.doesNotMatch(replyText(removedHistory), /Последние действия/);
    assert.equal(buttonData(await f.message(100, '/account'), 'menu:history'), undefined);
    assert.ok(!JSON.stringify(f.events).includes('new-private-password'));
});

test('existing account binding requires the password, rate-limits guesses and rechecks concurrent password changes', async t => {
    const f = await fixture(t, { protected: { nickname: 'Protected', password: hashPassword('correct-password'), registrationStatus: 'confirmed' } }); await f.connect();
    await f.message(100, '/link'); const c = await f.begin(); await f.message(100, c.code); await f.message(100, 'Protected');
    assert.equal(buttonData(await f.message(100, 'wrong'), 'yes:'), undefined);
    for (let i = 0; i < 4; i++) await f.message(100, 'wrong');
    await f.restart();
    assert.match(replyText(await f.message(100, 'correct-password')), /Слишком много попыток/);
    assert.equal(f.users.protected.telegramId, undefined);
    f.advance(60001);
    const confirmation = await f.message(100, 'correct-password');
    f.users.protected.password = hashPassword('different-password');
    await f.callback(100, buttonData(confirmation, 'yes:'));
    assert.equal(f.users.protected.telegramId, undefined);
});

test('one bot screen survives navigation, text input and restarts; old user and bot messages are removed', async t => {
    const f = await fixture(t, { account: { nickname: 'Player', telegramId: '100', registrationStatus: 'confirmed' } });
    await f.connect();
    const visible = new Map();
    let updateId = 1000, inputId = 10, botId = 500;
    const chat = { id: 100, type: 'private' }, from = { id: 100 };
    async function deliver(actions) {
        for (const action of actions) {
            if (action.method === 'sendMessage' || action.method === 'editMessageText') {
                const id = action.method === 'sendMessage' ? botId++ : action.body.message_id;
                visible.set(id, action.body.text);
                const receipt = await f.worker('delivery', { kind: action.method === 'sendMessage' ? 'sent' : 'edited', chat_id: 100, message_id: id });
                await deliver(receipt.body.actions || []);
            } else if (action.method === 'deleteMessages') {
                for (const id of action.body.message_ids) visible.delete(id);
                assert.equal((await f.worker('delivery', { kind: 'deleted', chat_id: 100, operation_id: action.id })).status, 200);
            }
        }
    }
    async function message(text) {
        const id = inputId++; visible.set(id, text);
        const result = await f.worker('update', { update_id: updateId++, message: { message_id: id, chat, from, text } });
        assert.equal(result.body.actions.filter(a => ['sendMessage', 'editMessageText'].includes(a.method)).length, 1);
        await deliver(result.body.actions);
        assert.equal(visible.size, 1);
        return result;
    }
    await message('/start');
    assert.ok(visible.has(500));
    const account = await message('/account');
    assert.equal(account.body.actions.find(a => a.method === 'editMessageText').body.message_id, 500);
    assert.equal(buttonData(account, 'menu:history'), undefined);
    const edit = await f.worker('update', { update_id: updateId++, callback_query: { id: 'nickname-button', from, message: { message_id: 500, chat }, data: 'menu:nickname' } });
    await deliver(edit.body.actions);
    const renamed = await message('RenamedPlayer');
    assert.match(replyText(renamed), /Данные сохранены/);
    assert.match(visible.get(500), /Личный кабинет/);
    assert.match(visible.get(500), /RenamedPlayer/);
    await f.restart();
    await message('/account');
    assert.equal(botId, 501, 'navigation uses the original message instead of sending more messages');
    await message('/history');
    assert.doesNotMatch(visible.get(500), /Последние действия/);
    assert.ok(!(await f.worker('pending-actions', {})).body.actions.some(a => a.body.message_ids.includes(500)));
});

test('late cleanup cannot delete the active screen; replacing a missing screen schedules only the old message', async t => {
    const f = await fixture(t); await f.connect();
    await f.message(100, '/start');
    await f.worker('delivery', { kind: 'sent', chat_id: 100, message_id: 500 });
    const screen = await f.message(100, '/menu');
    assert.equal(screen.body.actions.find(a => a.method === 'editMessageText').body.message_id, 500);
    const replacement = await f.worker('delivery', { kind: 'sent', chat_id: 100, message_id: 501 });
    assert.ok(replacement.body.actions.some(a => a.body.message_ids.includes(500)));
    assert.ok(!replacement.body.actions.some(a => a.body.message_ids.includes(501)));
    await f.restart();
    const next = await f.message(100, '/menu');
    assert.equal(next.body.actions.find(a => a.method === 'editMessageText').body.message_id, 501);
    assert.ok(!(await f.worker('pending-actions', {})).body.actions.some(a => a.body.message_ids.includes(501)));
});
