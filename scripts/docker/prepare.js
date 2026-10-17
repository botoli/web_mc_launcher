const { createDatabase } = require('../../apps/api/src/database');
const { networkConfig } = require('../../apps/api/src/config/network');
async function main() {
    const database = createDatabase();
    try {
        await database.initialize();
        const { publicURL } = networkConfig();
        await database.transaction(state => {
            // A restored build may contain the previous server's public address.
            if (state.settings.build) state.settings.build.launcherServer = publicURL;
        });
    } finally { await database.close(); }
}
main().catch(error => { console.error('[Docker] Database preparation failed:', error.code || error.message); process.exitCode = 1; });
