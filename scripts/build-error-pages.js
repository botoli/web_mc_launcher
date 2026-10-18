const fs = require('node:fs');
const path = require('node:path');
const { errorPages, renderErrorPage } = require('../apps/shared/error-pages');
const directory = path.resolve(__dirname, '../deploy/error-pages');
fs.mkdirSync(directory, { recursive: true });
for (const code of Object.keys(errorPages)) {
    fs.writeFileSync(path.join(directory, `${code}.html`), renderErrorPage(Number(code)));
}
