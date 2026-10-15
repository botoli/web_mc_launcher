const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { createPlayerServices } = require('../apps/api/src/players/services');
const { createTestDatabase } = require('./test-database');
const { copyApiFixture } = require('./copy-api-fixture');

test('historical request, click and client telemetry stays hidden without deleting the stored journal', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-journal-filter-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'player-events.jsonl');
    const base = { login: 'player', nickname: 'Player', at: Date.now(), source: 'website' };
    const original = [
        { ...base, id: 'auth', category: 'auth', action: 'login' },
        { ...base, id: 'read', category: 'activity', action: 'http_request' },
        { ...base, id: 'click', category: 'activity', action: 'bot_click' },
        { ...base, id: 'client', category: 'activity', action: 'game_started' },
    ].map(e => JSON.stringify(e)).join('\n') + '\n';
    await fs.writeFile(file, original);
    const services = createPlayerServices({ users: { player: { nickname: 'Player' } }, saveUsers() {}, dataDir: dir });
    assert.deepEqual(services.recent('player').map(e => e.id), ['auth']);
    assert.equal(services.audit(null, 'player', 'activity', 'http_request'), undefined);
    assert.equal(await fs.readFile(file, 'utf8'), original);
    services.audit(null, 'player', 'administration', 'mod_added', { target: 'test.jar' });
    assert.equal(services.recent('player')[0].action, 'mod_added');
});

async function fixture(t) {
    const db = await createTestDatabase();
    const root = path.resolve(__dirname, '..');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-player-services-'));
    await copyApiFixture(root, dir);
    const probe = net.createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    let child, output = '';
    async function start() {
        child = spawn(process.execPath, [path.join(dir, 'server.js')], { env: {
            ...db.env, NODE_PATH: path.join(root, 'node_modules'), PORT: String(port),
            USE_HTTPS: 'false', JWT_SECRET: 'test-jwt-secret', TELEGRAM_BOT_SECRET: 'telegram-test-secret-at-least-32-chars',
            PLAYER_EVENTS_SECRET: 'events-test-secret-at-least-32-chars', TRUST_PROXY: '',
        }, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            if (child.exitCode !== null) throw new Error(output);
            try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) return; } catch {}
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        throw new Error('Backend did not start: ' + output);
    }
    async function stop() { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } }
    t.after(async () => { await stop(); await db.close(); await fs.rm(dir, { recursive: true, force: true }); });
    await start();
    async function api(route, body, token, method = body === undefined ? 'GET' : 'POST', extra = {}) {
        const multipart = body instanceof FormData;
        const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { ...(!multipart ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() };
    }
    return { api, dir, journal: async () => JSON.stringify((await db.snapshot()).events), restart: async () => { await stop(); await start(); } };
}

test('player audit, two-role authorization and launcher moderation end to end', { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const tokens = {};
    for (const login of ['botoli1', 'admin', 'helper', 'player', 'other']) {
        assert.equal((await f.api('/api/register', { login, nickname: login, password: 'private-test-password', email: `${login}@example.test`, role: 'admin' })).body.success, true);
        tokens[login] = (await f.api('/api/auth', { login, password: 'private-test-password' })).body.token;
        assert.equal((await f.api('/api/profile', undefined, tokens[login])).body.role, login === 'botoli1' ? 'admin' : 'player');
    }
    for (const login of ['admin', 'helper']) assert.equal((await f.api(`/api/admin/players/${login}/role`, { role: 'admin' }, tokens.botoli1, 'PUT')).status, 200);
    const moderation = (action, extra = {}) => f.api('/api/admin/players/player/moderation', { action, ...extra }, tokens.helper);
    const logs = query => f.api('/api/admin/logs?' + query, undefined, tokens.helper);
    let oldLauncherToken;
    await t.test('roles protect IP logs and moderation; registration cannot assign a role', async () => {
        assert.equal((await f.api('/api/admin/logs')).status, 401);
        for (const route of ['/api/admin/logs', '/api/admin/players', '/api/admin/players/player', '/api/admin/players/player/actions']) assert.equal((await f.api(route, undefined, tokens.player)).status, 403);
        assert.equal((await f.api('/api/admin/players/player/moderation', { action: 'ban', reason: 'forged' }, tokens.player)).status, 403);
        assert.equal((await f.api('/api/build-config', {}, tokens.player)).status, 403);
        assert.equal((await f.api('/api/profile', undefined, tokens.player)).body.role, 'player');
        assert.equal((await f.api('/api/profile', undefined, tokens.admin)).body.role, 'admin');
        assert.equal((await f.api('/api/admin/players/__proto__', undefined, tokens.admin)).status, 404);
    });
    await t.test('journal records successful and failed logins, old/new nicknames, trusted IPs and pagination', async () => {
        await f.api('/api/auth', { login: 'player', password: 'bad-private-password' }, undefined, 'POST', { 'X-Forwarded-For': '203.0.113.99' });
        await f.api('/api/profile', { nickname: 'NewNickname' }, tokens.player, 'PUT');
        const launcher = await f.api('/api/launcher-auth', { login: 'player', password: 'private-test-password' });
        oldLauncherToken = launcher.body.token;
        const failed = await logs('login=player&category=auth&outcome=failed');
        assert.equal(failed.body.total, 1);
        assert.match(failed.body.items[0].ip, /127\.0\.0\.1$/);
        assert.equal(failed.body.items[0].source, 'website');
        assert.equal(failed.body.items[0].target, 'website');
        assert.equal((await logs('login=player&category=auth&source=launcher')).body.items[0].target, 'launcher');
        const byOldNick = await logs('q=player&category=account');
        assert.ok(byOldNick.body.items.some(e => e.action === 'nickname_changed'));
        assert.equal((await logs('login=player&limit=1&page=2')).body.items.length, 1);
        assert.equal((await logs('from=invalid')).status, 400);
        const raw = await f.journal();
        assert.ok(!raw.includes('private-test-password') && !raw.includes('bad-private-password') && !raw.includes(oldLauncherToken));
    });
    await t.test('server and Discord events require a service secret and keep identity information', async () => {
        const event = { nickname: 'newnickname', action: 'connect', ip: '203.0.113.10', server: 'play.example.test:25565' };
        assert.equal((await f.api('/api/internal/server-events', event, tokens.admin)).status, 401);
        const headers = { 'X-Events-Secret': 'events-test-secret-at-least-32-chars' };
        assert.equal((await f.api('/api/internal/server-events', { ...event, ip: 'invalid' }, undefined, 'POST', headers)).status, 400);
        assert.equal((await f.api('/api/internal/server-events', event, undefined, 'POST', headers)).status, 201);
        const entries = (await logs('login=player&category=connections')).body.items;
        assert.equal(entries[0].ip, event.ip); assert.equal(entries[0].target, event.server);
        const discord = { login: 'player', discordId: '123456789012345678', username: 'player.discord', bot: 'TestDiscordBot', ip: '' };
        for (const action of ['discord_linked', 'login']) assert.equal((await f.api('/api/internal/discord-events', { ...discord, action }, undefined, 'POST', headers)).status, 201);
        assert.equal((await f.api('/api/admin/players/player', undefined, tokens.helper)).body.discordId, discord.discordId);
        assert.equal((await logs('login=player&source=discord&category=auth')).body.items[0].bot, discord.bot);
        assert.equal((await logs('q=player.discord&source=discord')).body.items[0].discordUsername, 'player.discord');
        assert.equal((await f.api('/api/internal/discord-events', { ...discord, action: 'command', target: 'account' }, undefined, 'POST', headers)).status, 400);
        assert.equal((await logs('login=player&source=discord&category=auth')).body.items[0].target, 'discord');
    });
    await t.test('reads and launcher telemetry are not journaled; successful admin mutations have explicit events', async () => {
        const before = await f.journal();
        for (const route of ['/api/profile', '/api/dashboard', '/api/admin/players', '/api/admin/logs', '/api/client-config', '/api/mods-list'])
            assert.equal((await f.api(route, undefined, tokens.admin)).status, 200);
        assert.equal((await f.api('/api/launcher/events', { action: 'game_started' }, tokens.player)).status, 404);
        assert.equal(await f.journal(), before);
        assert.equal((await f.api('/api/build-config', { maxMemory: 6144 }, tokens.admin)).body.success, true);
        const configEvents = (await logs('category=administration')).body.items;
        assert.equal(configEvents.length, 1);
        assert.equal(configEvents[0].action, 'build_config_changed');
        assert.equal(configEvents[0].actor, 'admin');
        assert.equal(configEvents[0].target, 'server_build');
        await f.api('/api/build-config', { maxMemory: 6144 }, tokens.admin);
        assert.equal((await logs('category=administration')).body.total, 1, 'saving unchanged configuration is not an extra manipulation');
        for (const content of ['first version', 'replacement']) {
            const upload = new FormData(); upload.append('mod', new Blob([content]), 'audit-mod.jar');
            assert.equal((await f.api('/api/upload-mod', upload, tokens.admin)).body.success, true);
        }
        assert.equal((await f.api('/api/delete-mod', { name: 'audit-mod.jar' }, tokens.admin)).body.success, true);
        const mutations = (await logs('category=administration')).body.items;
        assert.deepEqual(mutations.map(e => e.action), ['mod_deleted', 'mod_replaced', 'mod_added', 'build_config_changed']);
        assert.ok(mutations.slice(0, 3).every(e => e.actor === 'admin' && e.target === 'audit-mod.jar'));
        await f.api('/api/delete-mod', { name: 'missing.jar' }, tokens.admin);
        assert.equal((await logs('category=administration')).body.total, 4);
    });
    await t.test('freeze expires automatically, revokes previous launcher tokens and preserves website profile access', async () => {
        for (const hours of [0, -1, '24', 8761, null]) assert.equal((await moderation('freeze', { hours, reason: 'test' })).status, 400);
        assert.equal((await moderation('freeze', { hours: 24 })).status, 400);
        assert.equal((await moderation('freeze', { hours: 0.0002, reason: 'Temporary test freeze' })).status, 200);
        assert.equal((await f.api('/api/launcher-auth', { token: oldLauncherToken })).status, 403);
        assert.equal((await f.api('/api/launcher-auth', { login: 'player', password: 'private-test-password' })).status, 403);
        assert.equal((await f.api('/api/profile', undefined, tokens.player)).status, 200);
        assert.equal((await f.api('/api/auth', { login: 'player', password: 'private-test-password' })).body.success, true);
        await new Promise(resolve => setTimeout(resolve, 800));
        assert.equal((await f.api('/api/admin/players/player', undefined, tokens.helper)).body.frozenUntil, null);
        assert.equal((await f.api('/api/launcher-auth', { login: 'player', password: 'private-test-password' })).body.success, true);
        assert.equal((await f.api('/api/launcher-auth', { token: oldLauncherToken })).status, 403);
        assert.equal((await f.api('/api/verify', { token: oldLauncherToken })).body.valid, false);
    });
    await t.test('ban, unban and manual unfreeze apply only to launcher access and are audited', async () => {
        assert.equal((await moderation('ban', { reason: 'Test ban' })).body.player.registrationStatus, 'banned');
        assert.equal((await moderation('freeze', { hours: 1, reason: 'test' })).status, 409);
        assert.equal((await f.api('/api/launcher-auth', { login: 'player', password: 'private-test-password' })).status, 403);
        assert.equal((await f.api('/api/profile', undefined, tokens.player)).status, 200);
        assert.equal((await moderation('unban')).body.player.registrationStatus, 'confirmed');
        await moderation('freeze', { hours: 24, reason: 'Test manual unfreeze' });
        assert.equal((await moderation('unfreeze')).body.player.frozenUntil, null);
        const events = (await logs('login=player&category=moderation')).body.items;
        for (const action of ['ban', 'unban', 'freeze', 'unfreeze']) assert.ok(events.some(e => e.action === action && e.actor === 'helper'));
    });
    await t.test('Telegram audit includes bot and launcher IP; freeze revokes Telegram sessions permanently', async () => {
        const worker = (route, body) => f.api('/api/internal/telegram/' + route, body, undefined, 'POST', { 'X-Bot-Secret': 'telegram-test-secret-at-least-32-chars' });
        await worker('connect', { username: 'AuditTestBot' });
        const challenge = (await f.api('/api/auth/telegram/challenges', {})).body;
        let updateId = 1;
        const message = text => worker('update', { update_id: updateId++, message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, text } });
        await message(challenge.code); await message('NewNickname'); await message('private-test-password');
        await worker('update', { update_id: updateId++, callback_query: { id: 'test-callback', from: { id: 123 }, message: { chat: { id: 123, type: 'private' } }, data: `yes:${challenge.code}` } });
        const result = await f.api(`/api/auth/telegram/challenges/${challenge.id}/exchange`, {}, undefined, 'POST', { 'X-Poll-Secret': challenge.poll_secret });
        assert.equal(result.status, 200);
        const token = result.body.token;
        assert.equal((await f.api('/api/auth/me', undefined, token)).status, 200);
        const event = (await logs('login=player&category=auth&source=telegram')).body.items[0];
        assert.equal(event.bot, 'AuditTestBot'); assert.equal(event.telegramId, '123'); assert.match(event.ip, /127\.0\.0\.1$/);
        assert.equal(event.target, 'launcher');
        await moderation('freeze', { hours: 24, reason: 'Telegram session revocation test' });
        assert.equal((await f.api('/api/auth/me', undefined, token)).status, 401);
        await moderation('unfreeze');
        assert.equal((await f.api('/api/auth/me', undefined, token)).status, 401);
    });
    await t.test('only botoli1 assigns roles; grants and revocations apply immediately and survive restart', async () => {
        const setRole = (login, role, token) => f.api(`/api/admin/players/${login}/role`, { role }, token, 'PUT');
        assert.equal((await setRole('other', 'admin')).status, 401);
        for (const login of ['admin', 'helper', 'player', 'other']) assert.equal((await setRole('other', 'admin', tokens[login])).status, 403);
        assert.equal((await setRole('other', 'support', tokens.botoli1)).status, 400);
        assert.equal((await setRole('missing', 'admin', tokens.botoli1)).status, 404);
        assert.equal((await setRole('botoli1', 'player', tokens.botoli1)).status, 409);
        const before = (await f.api('/api/profile', undefined, tokens.other)).body;
        assert.equal((await setRole('other', 'admin', tokens.botoli1)).body.player.role, 'admin');
        assert.equal((await f.api('/api/admin/logs', undefined, tokens.other)).status, 200);
        assert.equal((await setRole('player', 'admin', tokens.other)).status, 403);
        assert.equal((await setRole('other', 'player', tokens.botoli1)).body.player.role, 'player');
        assert.equal((await f.api('/api/admin/logs', undefined, tokens.other)).status, 403);
        const after = (await f.api('/api/profile', undefined, tokens.other)).body;
        for (const field of ['login', 'nickname', 'email', 'registeredAt']) assert.equal(before[field], after[field]);
        const changes = (await logs('login=other&category=moderation')).body.items;
        assert.deepEqual(changes.map(e => [e.action, e.actor, e.target]), [['role_changed', 'botoli1', 'player'], ['role_changed', 'botoli1', 'admin']]);
        await setRole('other', 'admin', tokens.botoli1);
        const total = (await logs('login=player&category=moderation')).body.total;
        await f.restart();
        assert.equal((await logs('login=player&category=moderation')).body.total, total);
        assert.equal((await f.api('/api/profile', undefined, tokens.other)).body.role, 'admin');
        assert.equal((await f.api('/api/profile', undefined, tokens.other)).body.registeredAt, before.registeredAt);
        assert.equal((await f.api('/api/profile', undefined, tokens.other)).body.canManageRoles, false);
        assert.equal((await f.api('/api/profile', undefined, tokens.botoli1)).body.canManageRoles, true);
        assert.equal((await f.api('/api/support/tickets', undefined, tokens.admin)).status, 404);
    });
    await t.test('Telegram registration password works on the website and password changes revoke existing website sessions', async () => {
        const worker = (route, body) => f.api('/api/internal/telegram/' + route, body, undefined, 'POST', { 'X-Bot-Secret': 'telegram-test-secret-at-least-32-chars' });
        let updateId = 1000, messageId = 500;
        const from = { id: 456, username: 'RegisteredTelegram' }, chat = { id: 456, type: 'private' };
        const message = text => worker('update', { update_id: updateId++, message: { message_id: messageId++, from, chat, text } });
        await message('/register'); await message('TelegramPlayer');
        await message('registration-password');
        const confirmation = await message('registration-password');
        const data = confirmation.body.actions.flatMap(a => a.body.reply_markup?.inline_keyboard?.flat() || []).find(b => b.callback_data.startsWith('bind:')).callback_data;
        await worker('update', { update_id: updateId++, callback_query: { id: 'register-callback', from, message: { chat, message_id: messageId++ }, data } });
        const login = (await f.api('/api/auth', { login: 'tg_456', password: 'registration-password' })).body;
        assert.equal(login.success, true);
        assert.equal((await f.api('/api/profile', undefined, login.token)).body.telegramUsername, 'RegisteredTelegram');
        await message('/password'); await message('registration-password');
        await message('changed-password-123'); await message('changed-password-123');
        assert.equal((await f.api('/api/profile', undefined, login.token)).status, 401);
        assert.equal((await f.api('/api/auth', { login: 'tg_456', password: 'changed-password-123' })).body.success, true);
        assert.ok(!(await f.journal()).includes('registration-password'));
    });
});
