// One-time bridge from the existing systemd installation to the Docker bundle.
// Run with Node.js 24 from the current installation, after stopping its writers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');
const { Client } = require('pg');
const { networkConfig } = require('../../apps/api/src/config/network');
const root = path.resolve(__dirname, '../..');
require('@next/env').loadEnvConfig(root);
const quote = value => `'${String(value).replace(/'/g, "\\'")}'`;
function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
    if (result.error || result.status !== 0) throw new Error(`${command} failed; экспорт остановлен.`);
}
function main() {
    const output = path.resolve(process.argv[2] || path.join(root, `data/backups/transfer-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`));
    if (fs.existsSync(output)) throw new Error('Файл назначения уже существует.');
    for (const service of ['mc-launcher-server.service', 'mc-launcher-bot.service']) {
        if (spawnSync('systemctl', ['is-active', '--quiet', service], { stdio: 'ignore' }).status === 0)
            throw new Error('Для согласованного переноса сначала остановите mc-launcher-bot и mc-launcher-server.');
    }
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-docker-export-'));
    try {
        fs.chmodSync(stage, 0o700);
        fs.mkdirSync(path.join(stage, 'transfer/data'), { recursive: true });
        fs.mkdirSync(path.join(stage, 'transfer/bot'), { recursive: true });
        for (const directory of ['mods', 'clients', 'configs']) {
            const source = path.join(root, 'data', directory);
            if (fs.existsSync(source)) fs.cpSync(source, path.join(stage, 'transfer/data', directory), { recursive: true });
        }
        const botEnvPath = fs.existsSync(path.join(root, 'bot/.env')) ? path.join(root, 'bot/.env') : path.join(root, 'apps/bot/.env');
        const bot = fs.existsSync(botEnvPath) ? parseEnv(fs.readFileSync(botEnvPath, 'utf8')) : {};
        const receipts = [process.env.TELEGRAM_DELIVERY_STATE_FILE, '/var/lib/mc-launcher-bot/delivery-receipts.json', path.join(path.dirname(botEnvPath), '.delivery-receipts.json')].filter(Boolean).find(file => fs.existsSync(file));
        if (receipts) fs.copyFileSync(receipts, path.join(stage, 'transfer/bot/delivery-receipts.json'));
        const random = () => crypto.randomBytes(32).toString('hex');
        const url = process.argv[3] || networkConfig().publicURL;
        run(path.join(root, 'scripts/docker/init.sh'), [url], { env: { ...process.env, MC_DOCKER_ENV: path.join(stage, 'config.env') } });
        const config = parseEnv(fs.readFileSync(path.join(stage, 'config.env'), 'utf8'));
        for (const key of ['JWT_SECRET', 'PLAYER_EVENTS_SECRET']) config[key] = process.env[key] || random();
        config.TELEGRAM_BOT_SECRET = process.env.TELEGRAM_BOT_SECRET || bot.TELEGRAM_BOT_SECRET || random();
        config.TELEGRAM_BOT_TOKEN = bot.telegrambotapi || '';
        // No source database credentials enter the image or transfer config.
        fs.writeFileSync(path.join(stage, 'config.env'), Object.entries(config).map(([key, value]) => `${key}=${quote(value)}`).join('\n') + '\n', { mode: 0o600 });
        const params = new Client({ connectionString: process.env.DATABASE_URL }).connectionParameters;
        const fd = fs.openSync(path.join(stage, 'database.dump'), 'wx', 0o600);
        try {
            run('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
                stdio: ['ignore', fd, 'inherit'], env: { ...process.env,
                    PGHOST: params.host, PGPORT: String(params.port), PGDATABASE: params.database, PGUSER: params.user, PGPASSWORD: params.password || '',
                    ...(params.ssl ? { PGSSLMODE: process.env.PGSSLMODE || 'require' } : {}),
                },
            });
        } finally { fs.closeSync(fd); }
        run('tar', ['-C', path.join(stage, 'transfer'), '-czf', path.join(stage, 'files.tar.gz'), 'data', 'bot']);
        fs.writeFileSync(path.join(stage, 'VERSION'), '1\n');
        const checksums = spawnSync('sha256sum', ['config.env', 'database.dump', 'files.tar.gz'], { cwd: stage, encoding: 'utf8' });
        if (checksums.status !== 0) throw new Error('Не удалось вычислить контрольные суммы.');
        fs.writeFileSync(path.join(stage, 'SHA256SUMS'), checksums.stdout);
        fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
        fs.closeSync(fs.openSync(output, 'wx', 0o600));
        run('tar', ['-C', stage, '-czf', output, 'VERSION', 'SHA256SUMS', 'config.env', 'database.dump', 'files.tar.gz']);
        console.log(`Готово: ${output}`);
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
