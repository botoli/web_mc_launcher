const fs = require('node:fs/promises');
const path = require('node:path');

// Mirror the real layout so path regressions cannot silently use production data.
async function copyApiFixture(root, destination) {
    await fs.cp(path.join(root, 'apps/api'), path.join(destination, 'apps/api'), { recursive: true });
    await fs.copyFile(path.join(root, 'server.js'), path.join(destination, 'server.js'));
}

module.exports = { copyApiFixture };
