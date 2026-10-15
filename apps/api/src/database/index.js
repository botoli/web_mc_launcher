const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { isDeepStrictEqual } = require('node:util');
const { Pool } = require('pg');

const buckets = {
    challenges: 'telegram_challenges', sessions: 'telegram_sessions',
    conversations: 'telegram_conversations', codeAttempts: 'telegram_code_attempts',
    passwordAttempts: 'telegram_password_attempts', telegramProfiles: 'telegram_profiles',
    messages: 'telegram_messages', deletions: 'telegram_deletions', activeMessages: 'telegram_active_messages',
};
const identityKeys = ['telegramId', 'telegramUsername', 'discordId', 'discordUsername'];
const moderationKeys = ['frozenUntil', 'moderationReason', 'statusBeforeBan'];
const clone = value => structuredClone(value);
const defaults = () => ({ users: Object.create(null), events: [], settings: {}, telegram: {
    challenges: {}, sessions: {}, conversations: {}, codeAttempts: {}, passwordAttempts: {},
    telegramProfiles: {}, messages: {}, deletions: {}, activeMessages: {}, offset: 0, bot: null,
} });

function createDatabase(options = {}) {
    const schema = options.schema || process.env.PGSCHEMA || 'public';
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid PGSCHEMA');
    if (!options.connectionString && !process.env.DATABASE_URL && !process.env.PGDATABASE)
        throw new Error('Настройте DATABASE_URL или PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD');
    const pool = new Pool({
        connectionString: options.connectionString || process.env.DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 10, connectionTimeoutMillis: 10000, ...options.pool,
    });
    pool.on('error', error => console.error('[DB] Idle connection failed:', error.code || 'connection error'));
    const scope = new AsyncLocalStorage();
    let initial = defaults();
    const current = () => scope.getStore()?.state || initial;
    function proxy(section) {
        return new Proxy({}, {
            get: (_, key) => current()[section][key],
            set: (_, key, value) => { current()[section][key] = value; return true; },
            deleteProperty: (_, key) => delete current()[section][key],
            ownKeys: () => Reflect.ownKeys(current()[section]),
            getOwnPropertyDescriptor: (_, key) => Object.hasOwn(current()[section], key) ? { enumerable: true, configurable: true, value: current()[section][key], writable: true } : undefined,
        });
    }
    async function lock(client) {
        await client.query('SET LOCAL lock_timeout = \'15s\'');
        // The same lock is used by import and requests, including other workers.
        await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), 1296256076)');
    }
    async function load(client) {
        const state = defaults();
        const users = await client.query(`SELECT u.login, u.data || coalesce(i.data, '{}') || coalesce(m.data, '{}') AS data
            FROM users u LEFT JOIN user_identities i USING(login) LEFT JOIN user_moderation m USING(login)`);
        for (const row of users.rows) state.users[row.login] = row.data;
        state.events = (await client.query('SELECT data FROM player_events ORDER BY sequence')).rows.map(row => row.data);
        for (const row of (await client.query('SELECT key, value FROM application_settings')).rows) {
            if (row.key === 'telegram') Object.assign(state.telegram, row.value);
            else state.settings[row.key] = row.value;
        }
        for (const [name, table] of Object.entries(buckets)) {
            state.telegram[name] = Object.fromEntries((await client.query(`SELECT key, data FROM ${table}`)).rows.map(row => [row.key, row.data]));
        }
        return state;
    }
    async function syncMap(client, table, before, after) {
        for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) await client.query(`DELETE FROM ${table} WHERE key=$1`, [key]);
        for (const [key, data] of Object.entries(after)) if (!isDeepStrictEqual(data, before[key]))
            await client.query(`INSERT INTO ${table}(key,data) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET data=excluded.data`, [key, JSON.stringify(data)]);
    }
    async function persist(client, before, state) {
        for (const login of Object.keys(before.users)) if (!Object.hasOwn(state.users, login)) await client.query('DELETE FROM users WHERE login=$1', [login]);
        for (const [login, user] of Object.entries(state.users)) {
            if (isDeepStrictEqual(user, before.users[login])) continue;
            const account = { ...user }, identity = {}, moderation = {};
            for (const key of identityKeys) if (Object.hasOwn(account, key)) { identity[key] = account[key]; delete account[key]; }
            for (const key of moderationKeys) if (Object.hasOwn(account, key)) { moderation[key] = account[key]; delete account[key]; }
            await client.query('INSERT INTO users(login,data) VALUES($1,$2) ON CONFLICT(login) DO UPDATE SET data=excluded.data', [login, JSON.stringify(account)]);
            for (const [table, data] of [['user_identities', identity], ['user_moderation', moderation]])
                await client.query(`INSERT INTO ${table}(login,data) VALUES($1,$2) ON CONFLICT(login) DO UPDATE SET data=excluded.data`, [login, JSON.stringify(data)]);
        }
        const meta = Object.fromEntries(Object.entries(state.telegram).filter(([key]) => !Object.hasOwn(buckets, key)));
        const oldMeta = Object.fromEntries(Object.entries(before.telegram).filter(([key]) => !Object.hasOwn(buckets, key)));
        const oldSettings = { ...before.settings, telegram: oldMeta }, settings = { ...state.settings, telegram: meta };
        for (const [key, value] of Object.entries(settings)) if (!isDeepStrictEqual(value, oldSettings[key]))
            await client.query('INSERT INTO application_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(value)]);
        for (const [key, table] of Object.entries(buckets)) await syncMap(client, table, before.telegram[key] || {}, state.telegram[key] || {});
        if (state.events.length < before.events.length || !isDeepStrictEqual(state.events.slice(0, before.events.length), before.events))
            throw new Error('Audit history is append-only');
        for (const event of state.events.slice(before.events.length)) await client.query('INSERT INTO player_events(data) VALUES($1)', [JSON.stringify(event)]);
    }
    async function transaction(action, validate) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN'); await lock(client);
            const state = await load(client), before = clone(state);
            const result = await scope.run({ state }, () => action(state, client));
            await persist(client, before, state);
            if (validate) await validate(state, client, result);
            await client.query('COMMIT');
            return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }
    async function initialize() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
            await lock(client);
            await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
            await client.query("INSERT INTO schema_migrations(version) VALUES('001_postgresql') ON CONFLICT DO NOTHING");
            await client.query('COMMIT');
            initial = await load(client);
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }
    // Existing synchronous domain logic works on a request-local unit of work.
    // No successful API response is sent before its transaction commits.
    async function middleware(req, res, next) {
        const api = req.path.startsWith('/api/') && req.path !== '/api/download-mods';
        if (!api) {
            try {
                const state = await transaction(state => clone(state));
                scope.run({ state }, next);
            } catch (error) { next(error); }
            return;
        }
        const originalEnd = res.end;
        let ended = false, endArgs;
        let finish, fail;
        const completed = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
        // A client may disconnect while this request is waiting for a DB connection.
        completed.catch(() => {});
        const closed = () => { if (!ended) fail(new Error('Request aborted')); };
        res.once('close', closed);
        res.end = function (...args) {
            if (ended) return res;
            ended = true; endArgs = args;
            if (res.statusCode >= 500) fail(new Error('Request failed')); else finish();
            return res;
        };
        try {
            await transaction(async () => { next(); await completed; });
            res.end = originalEnd;
            if (!res.destroyed) originalEnd.apply(res, endArgs);
        } catch (error) {
            res.end = originalEnd;
            console.error('[DB] Request rolled back:', error.code || error.message);
            if (!res.destroyed && !res.headersSent) {
                res.removeHeader('Content-Length'); res.removeHeader('ETag'); res.removeHeader('Set-Cookie');
                res.status(503).json({ error: 'Не удалось сохранить данные. Повторите запрос.' });
            } else if (!res.destroyed) res.destroy();
        } finally { res.removeListener('close', closed); }
    }
    return { pool, initialize, transaction, load, persist, middleware, users: proxy('users'), telegram: proxy('telegram'),
        events: () => current().events, settings: () => current().settings, close: () => pool.end() };
}
module.exports = { createDatabase, defaults, buckets };
