const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createDatabase, defaults } = require('../../apps/api/src/database');

const files = ['users.json', 'build-config.json', 'client-version.json', 'server-config.json', 'telegram-auth-state.json', 'player-events.jsonl'];
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function readLegacy(dataDir) {
    const raw = {};
    for (const file of files) if (fs.existsSync(path.join(dataDir, file))) raw[file] = fs.readFileSync(path.join(dataDir, file));
    if (!raw['users.json']) throw new Error('users.json отсутствует: проверьте путь к исходным данным');
    const state = defaults();
    state.users = JSON.parse(raw['users.json']);
    for (const [key, file] of [['build', 'build-config.json'], ['client', 'client-version.json'], ['server', 'server-config.json']])
        if (raw[file]) state.settings[key] = JSON.parse(raw[file]);
    if (raw['telegram-auth-state.json']) Object.assign(state.telegram, JSON.parse(raw['telegram-auth-state.json']));
    if (raw['player-events.jsonl']) state.events = raw['player-events.jsonl'].toString('utf8').split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
        try { return JSON.parse(line); } catch { throw new Error(`Некорректный JSON в строке ${index + 1} player-events.jsonl`); }
    });
    return { raw, state, hashes: Object.fromEntries(Object.entries(raw).map(([file, data]) => [file, digest(data)])) };
}
function verify(expected, actual) {
    // Normalize prototypes only; keep all original field types, values and event order.
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected))))
        throw new Error('PostgreSQL отличается от исходных файлов. Подробности скрыты, чтобы не раскрыть пароли и токены.');
}
async function migrate(database, dataDir, { refreshBeforeCutover = false } = {}) {
    const source = readLegacy(dataDir);
    return database.transaction(async (state, client) => {
        const previous = await client.query("SELECT details FROM schema_migrations WHERE version='002_legacy_import'");
        if (previous.rowCount && !refreshBeforeCutover) return { alreadyImported: true, ...previous.rows[0].details };
        if (previous.rowCount) {
            // Refresh is safe only before the application starts using PostgreSQL:
            // every current record must still equal the previous import's backup.
            verify(readLegacy(previous.rows[0].details.backupDir).state, state);
        } else if (Object.keys(state.users).length || state.events.length || Object.keys(state.settings).length ||
            Object.values(state.telegram).some(value => value && typeof value === 'object' && Object.keys(value).length) || state.telegram.bot || state.telegram.offset)
            throw new Error('База уже содержит данные. Импорт в непустую базу отменён без изменений.');
        const backupDir = path.join(dataDir, 'backups', `pre-postgres-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        for (const [file, data] of Object.entries(source.raw)) fs.writeFileSync(path.join(backupDir, file), data, { mode: 0o600, flag: 'wx' });
        fs.writeFileSync(path.join(backupDir, 'sha256.json'), JSON.stringify(source.hashes, null, 2), { mode: 0o600 });
        Object.assign(state, source.state);
        for (const [file, hash] of Object.entries(source.hashes))
            if (digest(fs.readFileSync(path.join(dataDir, file))) !== hash) throw new Error('Исходные файлы изменились во время импорта. Остановите старый backend и повторите.');
        const details = { backupDir, hashes: source.hashes, users: Object.keys(source.state.users).length, events: source.state.events.length,
            challenges: Object.keys(source.state.telegram.challenges).length, sessions: Object.keys(source.state.telegram.sessions).length,
            ...(previous.rowCount ? { previousBackupDir: previous.rows[0].details.backupDir } : {}) };
        await client.query("INSERT INTO schema_migrations(version,details) VALUES('002_legacy_import',$1) ON CONFLICT(version) DO UPDATE SET details=excluded.details, applied_at=now()", [JSON.stringify(details)]);
        return details;
    }, async (state, client, result) => {
        if (!result.alreadyImported) verify(source.state, await database.load(client));
    });
}
async function main() {
    require('@next/env').loadEnvConfig(path.resolve(__dirname, '../..'));
    const database = createDatabase();
    try {
        await database.initialize();
        const dataDir = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '../../data'));
        if (process.argv.includes('--verify')) {
            await database.transaction(state => verify(readLegacy(dataDir).state, state));
            console.log('Проверено: все записи, поля и типы совпадают с исходными файлами.');
        } else console.log(JSON.stringify(await migrate(database, dataDir, { refreshBeforeCutover: process.argv.includes('--refresh-before-cutover') }), null, 2));
    } finally { await database.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate, readLegacy, verify };
