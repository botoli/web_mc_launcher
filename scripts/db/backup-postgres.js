const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

require('@next/env').loadEnvConfig(path.resolve(__dirname, '../..'));
const { host, port, database, user, password, ssl } = new Client({ connectionString: process.env.DATABASE_URL }).connectionParameters;
if (!database) throw new Error('Database connection is not configured');
const dir = path.resolve(__dirname, '../../data/backups');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, `postgres-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
fs.closeSync(fs.openSync(file, 'wx', 0o600));
const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--file', file], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PGHOST: host, PGPORT: String(port), PGDATABASE: database, PGUSER: user, PGPASSWORD: password || '',
        ...(process.env.PGSCHEMA ? { PGOPTIONS: `-c search_path=${process.env.PGSCHEMA}` } : {}),
        ...(ssl ? { PGSSLMODE: process.env.PGSSLMODE || 'require' } : {}) },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { if (code === 0) console.log(file); else process.exitCode = code || 1; });
