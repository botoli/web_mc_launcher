const path = require('node:path');
const crypto = require('node:crypto');
const { createDatabase } = require('../apps/api/src/database');

async function createTestDatabase() {
    require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'));
    const schema = `mc_test_${crypto.randomBytes(12).toString('hex')}`;
    const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    const database = createDatabase({ schema, connectionString });
    await database.initialize();
    return {
        database,
        env: { ...process.env, PGSCHEMA: schema, ...(connectionString ? { DATABASE_URL: connectionString } : {}) },
        snapshot: () => database.transaction(state => structuredClone(state)),
        async close() {
            if (!/^mc_test_[a-f0-9]{24}$/.test(schema)) throw new Error('Unsafe test schema');
            try { await database.pool.query(`DROP SCHEMA ${schema} CASCADE`); }
            finally { await database.close(); }
        },
    };
}
module.exports = { createTestDatabase };
