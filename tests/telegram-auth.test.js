const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installTelegramAuth } = require('../telegram-auth');
const { spawnSync } = require('node:child_process');

test('separate bot, users.json registration, confirmation and persistent sessions', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-auth-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const users = { existing: { nickname: 'Reserved', password: 'unchanged', registrationStatus: 'confirmed' } };
    let time = Date.now();
    const secret = 'test-only-shared-secret-32-characters';
    let saves = 0;
    const createApp = () => {
        const app = express(); app.use(express.json());
        installTelegramAuth(app, { users, dataDir: dir, secret, now: () => time, saveUsers: () => {
            saves++; fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(users));
        } });
        return app;
    };
    let server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    let base = `http://127.0.0.1:${server.address().port}`;
    const api = async (route, body, headers = {}, method = 'POST') => {
        const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: r.status, body: await r.json() };
    };
    const worker = (route, body) => api('/api/internal/telegram/' + route, body, { 'X-Bot-Secret': secret });
    let updateId = 1;
    const message = (id, text) => worker('update', { update_id: updateId++, message: { chat: { id, type: 'private' }, from: { id }, text } });
    const callback = (id, data) => worker('update', { update_id: updateId++, callback_query: { id: 'callback', data, from: { id }, message: { chat: { id, type: 'private' } } } });
    const begin = async () => {
        time += 61000; // separate rate windows and expire requests during lifecycle tests
        const r = await api('/api/auth/telegram/challenges', {});
        assert.equal(r.status, 200);
        return { c: r.body, headers: { 'X-Poll-Secret': r.body.poll_secret }, route: `/api/auth/telegram/challenges/${r.body.id}` };
    };
    assert.equal((await api('/api/auth/telegram/challenges', {})).status, 503);
    assert.equal((await api('/api/internal/telegram/connect', { username: 'TestAuthBot' })).status, 401);
    assert.equal((await worker('connect', { username: 'TestAuthBot' })).status, 200);
    const a = await begin();
    assert.equal(new URL(a.c.url).searchParams.get('start').length, 43);
    assert.equal((await api(a.route, undefined, {}, 'GET')).status, 404);
    const start = '/start ' + new URL(a.c.url).searchParams.get('start');
    await message(100, start);
    await message(100, 'Reserved');
    assert.equal(saves, 0);
    await message(100, 'NewPlayer');
    assert.equal(saves, 0, 'registration requires explicit confirmation');
    await callback(101, `yes:${a.c.code}`);
    assert.equal((await api(a.route + '/exchange', {}, a.headers)).status, 409);
    await callback(100, `yes:${a.c.code}`);
    assert.equal(users.tg_100.registrationStatus, 'pending');
    assert.equal(users.tg_100.telegramId, '100');
    assert.equal(users.existing.password, 'unchanged');
    const exchange = await api(a.route + '/exchange', {}, a.headers);
    assert.equal(exchange.status, 200);
    assert.equal(exchange.body.user.nickname, 'NewPlayer');
    assert.equal((await api(a.route + '/exchange', {}, a.headers)).status, 409);
    const auth = { Authorization: 'Bearer ' + exchange.body.token };
    assert.equal((await api('/api/auth/me', undefined, auth, 'GET')).status, 200);
    const persisted = fs.readFileSync(path.join(dir, 'telegram-auth-state.json'), 'utf8');
    assert.ok(!persisted.includes(exchange.body.token));
    assert.ok(!persisted.includes(a.c.poll_secret));
    await new Promise(resolve => server.close(resolve));
    server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await api('/api/auth/me', undefined, auth, 'GET')).status, 200);
    users.tg_100.registrationStatus = 'banned';
    assert.equal((await api('/api/auth/me', undefined, auth, 'GET')).status, 401);
    users.tg_100.registrationStatus = 'confirmed';
    assert.equal((await api('/api/auth/logout', {}, auth)).status, 200);
    assert.equal((await api('/api/auth/me', undefined, auth, 'GET')).status, 401);

    const b = await begin();
    await message(100, '/start ' + new URL(b.c.url).searchParams.get('start'));
    await callback(100, `no:${b.c.code}`);
    assert.equal((await api(b.route, undefined, b.headers, 'GET')).body.status, 'rejected');
    const c = await begin();
    await api(c.route, undefined, c.headers, 'DELETE');
    await message(100, '/start ' + new URL(c.c.url).searchParams.get('start'));
    await callback(100, `yes:${c.c.code}`);
    assert.equal((await api(c.route + '/exchange', {}, c.headers)).status, 409);
    const d = await begin();
    time += 300001;
    assert.equal((await api(d.route, undefined, d.headers, 'GET')).body.status, 'expired');
    assert.equal((await api(d.route + '/exchange', {}, d.headers)).status, 409);
    const e = await begin();
    await message(100, '/start ' + new URL(e.c.url).searchParams.get('start'));
    await callback(100, `yes:${e.c.code}`);
    users.tg_100.registrationStatus = 'banned';
    assert.equal((await api(e.route + '/exchange', {}, e.headers)).status, 403);
    users.tg_100.registrationStatus = 'pending';
    const replay = await worker('update', { update_id: 0 });
    assert.deepEqual(replay.body.actions, []);
    assert.equal(Object.keys(users).length, 2);
});

test('standalone worker connects, forwards updates, delivers replies and stops on polling conflict', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-worker-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const preload = path.join(dir, 'mock.cjs');
    fs.writeFileSync(preload, `
        const assert = require('node:assert/strict');
        let polls = 0, forwarded = false, delivered = false;
        global.fetch = async (url, options) => {
            const target = String(url), body = JSON.parse(options.body);
            let result;
            if (target.endsWith('/getMe')) result = { ok: true, result: { username: 'TestWorkerBot' } };
            else if (target.endsWith('/getWebhookInfo')) result = { ok: true, result: { url: '' } };
            else if (target.endsWith('/connect')) {
                assert.equal(body.username, 'TestWorkerBot');
                assert.equal(options.headers['X-Bot-Secret'], process.env.TELEGRAM_BOT_SECRET);
                result = { offset: 4 };
            } else if (target.endsWith('/getUpdates')) {
                if (process.env.TEST_CONFLICT) return new Response(JSON.stringify({ ok: false }), { status: 409 });
                if (++polls === 1) { assert.equal(body.offset, 4); result = { ok: true, result: [{ update_id: 4, message: { text: '/start' } }] }; }
                else {
                    assert.equal(body.offset, 5); assert.ok(forwarded); assert.ok(delivered);
                    console.log('worker-lifecycle-verified'); process.emit('SIGTERM');
                    result = { ok: true, result: [] };
                }
            } else if (target.endsWith('/update')) {
                assert.equal(body.update_id, 4); forwarded = true;
                result = { actions: [{ method: 'sendMessage', body: { chat_id: 123, text: 'fixture reply' } }] };
            } else if (target.endsWith('/sendMessage')) {
                assert.equal(body.chat_id, 123); assert.equal(body.text, 'fixture reply'); delivered = true;
                result = { ok: true, result: {} };
            } else throw new Error('Unexpected method');
            return new Response(JSON.stringify(result), { status: 200 });
        };
    `);
    const env = { ...process.env, telegrambotapi: 'test-token-must-stay-secret', AUTH_API_URL: 'http://127.0.0.1:1', TELEGRAM_BOT_SECRET: 'test-only-shared-secret-32-characters' };
    const args = ['--require', preload, path.join(__dirname, '../bot/bot.js')];
    const normal = spawnSync(process.execPath, args, { env: { ...env, TEST_CONFLICT: '' }, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(normal.status, 0, normal.stderr);
    assert.ok(normal.stdout.includes('worker-lifecycle-verified'));
    const conflict = spawnSync(process.execPath, args, { env: { ...env, TEST_CONFLICT: '1' }, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(conflict.status, 1);
    assert.ok(conflict.stderr.includes('Bot stopped'));
    assert.ok(!(normal.stdout + normal.stderr + conflict.stdout + conflict.stderr).includes(env.telegrambotapi));
});
