const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const crc32 = require('buffer-crc32');

const MAX_FILES = 10000;
const MAX_UNPACKED_SIZE = 1024 * 1024 * 1024;

function invalid(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function openZip(buffer) {
    return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, {
        lazyEntries: true, autoClose: false, strictFileNames: true,
    }, (error, zip) => error ? reject(invalid('Не удалось прочитать ZIP-архив.')) : resolve(zip)));
}

function readEntries(zip) {
    return new Promise((resolve, reject) => {
        const entries = [];
        let size = 0;
        zip.on('error', () => reject(invalid('ZIP-архив повреждён или содержит недопустимые пути.')));
        zip.on('entry', entry => {
            try {
                if (entries.length >= MAX_FILES) throw invalid('В архиве должно быть не более 10 000 записей.');
                const name = entry.fileName;
                const parts = name.replace(/\/$/, '').split('/');
                if (!name || name.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
                    throw invalid('Архив содержит недопустимый путь.');
                const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
                if (mode && mode !== 0x8000 && mode !== 0x4000) throw invalid('Ссылки и специальные файлы в архиве запрещены.');
                if (entry.generalPurposeBitFlag & 1) throw invalid('Архив с паролем не поддерживается.');
                size += entry.uncompressedSize;
                if (size > MAX_UNPACKED_SIZE) throw invalid('Размер распакованного архива превышает 1 ГБ.');
                entries.push(entry);
                zip.readEntry();
            } catch (error) { reject(error); }
        });
        zip.on('end', () => resolve(entries));
        zip.readEntry();
    });
}

// Publish a complete snapshot only after every file has been validated and extracted.
function createConfigStore(dataDir) {
    const snapshot = path.join(dataDir, 'configs');
    fs.mkdirSync(snapshot, { recursive: true });
    const manifest = path.join(snapshot, 'current.json');
    let current = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : null;
    const readers = new Map();
    const retired = new Set();
    function cleanup(revision) {
        if (!retired.has(revision) || readers.has(revision)) return;
        retired.delete(revision);
        fsp.rm(path.join(snapshot, revision), { recursive: true, force: true }).catch(error => console.error('[MCL] Config cleanup:', error.message));
    }

    function acquire() {
        if (!current) return null;
        const revision = current.revision;
        readers.set(revision, (readers.get(revision) || 0) + 1);
        let released = false;
        return { directory: path.join(snapshot, revision, 'files'), release() {
            if (released) return;
            released = true;
            const count = readers.get(revision) - 1;
            if (count) readers.set(revision, count); else readers.delete(revision);
            cleanup(revision);
        } };
    }

    async function replace(upload) {
        if (!upload || Array.isArray(upload) || !/\.zip$/i.test(upload.name)) throw invalid('Выберите один архив в формате .zip.');
        if (upload.truncated || upload.size > 500 * 1024 * 1024) throw Object.assign(new Error('Максимальный размер архива — 500 МБ.'), { status: 413 });
        const zip = await openZip(upload.data);
        let staging;
        try {
            const entries = await readEntries(zip);
            const files = entries.filter(entry => !entry.fileName.endsWith('/'));
            if (!files.length) throw invalid('Архив не содержит файлов конфигурации.');
            // Accept both loose configuration files and one enclosing config(s) folder.
            const prefix = ['configs/', 'config/'].find(value => files.every(entry => entry.fileName.startsWith(value))) || '';
            const names = new Set();
            const normalized = files.map(entry => {
                const name = entry.fileName.slice(prefix.length);
                const key = name.toLowerCase();
                if (names.has(key)) throw invalid('В архиве есть файлы с одинаковыми путями.');
                names.add(key);
                return { entry, name };
            }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
            for (const { name } of normalized) {
                const parts = name.toLowerCase().split('/');
                for (let i = 1; i < parts.length; i++) {
                    if (names.has(parts.slice(0, i).join('/'))) throw invalid('Пути файлов и папок в архиве пересекаются.');
                }
            }
            staging = await fsp.mkdtemp(path.join(snapshot, 'revision-'));
            const hash = crypto.createHash('sha256');
            let unpackedSize = 0;
            for (const { entry, name } of normalized) {
                const destination = path.join(staging, 'files', ...name.split('/'));
                await fsp.mkdir(path.dirname(destination), { recursive: true });
                const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, source) => error ? reject(invalid('ZIP-архив повреждён.')) : resolve(source)));
                hash.update(JSON.stringify([name, entry.uncompressedSize]));
                let checksum = 0;
                await pipeline(stream, new Transform({
                    transform(chunk, encoding, done) {
                        unpackedSize += chunk.length;
                        if (unpackedSize > MAX_UNPACKED_SIZE) return done(invalid('Размер распакованного архива превышает 1 ГБ.'));
                        hash.update(chunk);
                        checksum = crc32.unsigned(chunk, checksum);
                        done(null, chunk);
                    },
                }), fs.createWriteStream(destination, { flags: 'wx' }));
                if (checksum !== entry.crc32) throw invalid('Файл в ZIP-архиве повреждён: контрольная сумма не совпадает.');
            }
            const next = {
                name: path.basename(upload.name.replace(/\\/g, '/')),
                size: upload.size, unpackedSize, fileCount: files.length,
                hash: hash.digest('hex'), updatedAt: Date.now(),
            };
            const published = { info: next, revision: path.basename(staging) };
            await fsp.writeFile(path.join(staging, 'current.json'), JSON.stringify(published));
            fs.renameSync(path.join(staging, 'current.json'), manifest);
            staging = null;
            const previous = current;
            current = published;
            if (previous) { retired.add(previous.revision); cleanup(previous.revision); }
            return next;
        } catch (error) {
            if (error.status) throw error;
            if (error.code && !['Z_DATA_ERROR', 'Z_BUF_ERROR'].includes(error.code)) throw error;
            throw invalid('ZIP-архив повреждён.');
        } finally {
            zip.close();
            if (staging) await fsp.rm(staging, { recursive: true, force: true });
        }
    }

    return { acquire, info: () => current?.info || null, replace };
}

module.exports = { createConfigStore };
