const path = require('node:path');

// Resolve storage and configuration from the repository, regardless of cwd.
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

module.exports = { ROOT_DIR, DATA_DIR };
