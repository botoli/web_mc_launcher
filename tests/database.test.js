const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createDatabase } = require('../apps/api/src/database');
const { migrate, readLegacy, verify } = require('../scripts/db/migrate-postgres');
const { createTestDatabase } = require('./test-database');
const { installTelegramAuth } = require('../apps/api/src/telegram/auth');
const { createPlayerServices } = require('../apps/api/src/players/services');

test('PostgreSQL migration, atomic responses and parallel workers', async t => {
    const fixture = await createTestDatabase();
    const db = fixture.database;
    t.after(() => fixture.close());
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-pg-migration-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const legacy = {
        'users.json': {
            player: { password: { salt: 'legacy-salt', hash: 'legacy-hash' }, nickname: 'Player', email: '', telegramId: '123', telegramUsername: 'PlayerTG', frozenUntil: null, registrationStatus: 'confirmed', launcherVersion: 0, sessionVersion: 3, unknown: { retained: true } },
            other: { nickname: 'Other', password: null, registeredAt: 123456789, telegramId: 456, moderationReason: '', role: 'admin' },
        },
        'build-config.json': { version: '1.21.1', jvmArgs: ['-Xmx4G'], servers: [{ name: 'Game', address: 'localhost:25565' }], custom: null },
        'client-version.json': { version: '2', file: 'launcher.exe' },
        'server-config.json': { domain: 'example.test', useHTTPS: false },
        'telegram-auth-state.json': { bot: 'TestAuthBot', offset: 0, challenges: { expired: { status: 'expired', expires_at: 1, custom: 'keep' } }, sessions: { stale: { login: 'deleted-user', expires_at: 1 } }, conversations: {}, codeAttempts: {}, passwordAttempts: {}, telegramProfiles: { 123: { username: 'PlayerTG', at: 1 } }, messages: { 123: [{ id: 1, at: 1 }] }, deletions: {}, custom: ['keep'] },
    };
    const events = [{ id: 'same', at: 1, login: 'deleted-user', action: 'http_request', category: 'activity' }, { id: 'same', at: 1, login: 'player', action: 'login', category: 'auth' }];
    for (const [name, value] of Object.entries(legacy)) await fs.writeFile(path.join(dir, name), JSON.stringify(value));
    await fs.writeFile(path.join(dir, 'player-events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');

    await t.test('lossless import keeps all types, unknown fields, expired records and obsolete history', async () => {
        const report = await migrate(db, dir);
        assert.equal(report.users, 2); assert.equal(report.events, 2);
        verify(readLegacy(dir).state, await fixture.snapshot());
        for (const name of [...Object.keys(legacy), 'player-events.jsonl'])
            assert.deepEqual(await fs.readFile(path.join(report.backupDir, name)), await fs.readFile(path.join(dir, name)));
        assert.equal((await fs.stat(report.backupDir)).mode & 0o777, 0o700);
        assert.equal((await migrate(db, dir)).alreadyImported, true);
        assert.equal((await fixture.snapshot()).events.length, 2);
    });
    await t.test('pre-cutover refresh accepts new source data before PostgreSQL is used', async () => {
        legacy['build-config.json'].custom = 'latest-before-cutover';
        await fs.writeFile(path.join(dir, 'build-config.json'), JSON.stringify(legacy['build-config.json']));
        const refreshed = await migrate(db, dir, { refreshBeforeCutover: true });
        assert.ok(refreshed.previousBackupDir);
        verify(readLegacy(dir).state, await fixture.snapshot());
    });
    await t.test('constraint failure rolls back account, identity and event together', async () => {
        const before = await fixture.snapshot();
        await assert.rejects(db.transaction(state => {
            state.users.other.telegramId = '123';
            state.users.other.nickname = 'ShouldRollback';
            state.events.push({ id: 'failed', at: 2 });
        }), { code: '23505' });
        verify(before, await fixture.snapshot());
    });
    const second = createDatabase({ schema: fixture.env.PGSCHEMA, connectionString: fixture.env.DATABASE_URL });
    await second.initialize();
    t.after(() => second.close());
    await t.test('concurrent workers preserve every update', async () => {
        await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? db : second).transaction(async state => {
            const previous = state.users.player.counter || 0;
            await new Promise(resolve => setTimeout(resolve, 2));
            state.users.player.counter = previous + 1;
        })));
        assert.equal((await fixture.snapshot()).users.player.counter, 20);
        await assert.rejects(migrate(db, dir, { refreshBeforeCutover: true }), /отличается/);
        assert.equal((await fixture.snapshot()).users.player.counter, 20);
    });
    const secret = 'database-test-bot-secret-32-characters';
    const servers = [];
    t.after(async () => { for (const server of servers) await new Promise(resolve => server.close(resolve)); });
    async function start(database) {
        const app = express(); app.use(express.json()); app.use(database.middleware);
        const services = createPlayerServices({ users: database.users, saveUsers() {}, dataDir: dir, storage: database });
        installTelegramAuth(app, { users: database.users, saveUsers() {}, dataDir: dir, secret, storage: database, audit: services.audit });
        app.post('/api/fail', (req, res) => {
            database.users.other.telegramId = '123';
            database.events().push({ id: 'not-committed', at: 3 });
            res.cookie('session', 'must-not-be-sent'); res.json({ success: true });
        });
        const server = app.listen(0, '127.0.0.1'); servers.push(server);
        await new Promise(resolve => server.once('listening', resolve));
        return async (route, body, headers = {}, method = body === undefined ? 'GET' : 'POST') => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json(), headers: response.headers };
        };
    }
    const api = await start(db), otherApi = await start(second);
    await t.test('failed commit returns an error without success cookies or partial writes', async () => {
        const before = await fixture.snapshot();
        const response = await api('/api/fail', {});
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.equal(response.body.success, undefined);
        verify(before, await fixture.snapshot());
    });
    await t.test('Telegram exchange is single use across workers and the session survives a new connection', async () => {
        const challenge = (await api('/api/auth/telegram/challenges', {})).body;
        assert.ok(challenge.id);
        const workerHeaders = { 'X-Bot-Secret': secret };
        await otherApi('/api/internal/telegram/update', { update_id: 1, message: { message_id: 10, from: { id: 123 }, chat: { id: 123, type: 'private' }, text: challenge.code } }, workerHeaders);
        await api('/api/internal/telegram/update', { update_id: 2, callback_query: { id: 'confirm', from: { id: 123 }, message: { message_id: 11, chat: { id: 123, type: 'private' } }, data: `yes:${challenge.code}` } }, workerHeaders);
        const headers = { 'X-Poll-Secret': challenge.poll_secret };
        const route = `/api/auth/telegram/challenges/${challenge.id}/exchange`;
        const responses = await Promise.all([api(route, {}, headers), otherApi(route, {}, headers)]);
        assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
        const token = responses.find(r => r.status === 200).body.token;
        const restarted = createDatabase({ schema: fixture.env.PGSCHEMA, connectionString: fixture.env.DATABASE_URL });
        await restarted.initialize(); t.after(() => restarted.close());
        const restartedApi = await start(restarted);
        assert.equal((await restartedApi('/api/auth/me', undefined, { Authorization: `Bearer ${token}` })).status, 200);
        const state = JSON.stringify((await fixture.snapshot()).telegram);
        assert.ok(!state.includes(token) && !state.includes(challenge.poll_secret));
        assert.deepEqual(await fs.readFile(path.join(dir, 'users.json'), 'utf8'), JSON.stringify(legacy['users.json']));
        await assert.rejects(fs.access(path.join(dir, 'users.json.tmp')));
    });
});
