const archiver = require('archiver');
const yauzl = require('yauzl');

async function makeZip(entries) {
    const archive = archiver('zip', { store: true });
    const chunks = [];
    archive.on('data', chunk => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => { archive.on('end', resolve); archive.on('error', reject); });
    for (const [name, content] of entries) archive.append(content, { name });
    await archive.finalize();
    await finished;
    return Buffer.concat(chunks);
}

async function readZip(buffer) {
    const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
    return new Promise((resolve, reject) => {
        const files = {};
        zip.on('error', reject);
        zip.on('entry', entry => {
            if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
            zip.openReadStream(entry, (error, stream) => {
                if (error) { reject(error); return; }
                const chunks = [];
                stream.on('error', reject);
                stream.on('data', chunk => chunks.push(chunk));
                stream.on('end', () => { files[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
            });
        });
        zip.on('end', () => resolve(files));
        zip.readEntry();
    });
}

module.exports = { makeZip, readZip };
