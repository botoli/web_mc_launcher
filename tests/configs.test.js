const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../apps/api/src/configs/archive');
const { makeZip } = require('./zip-fixture');

async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-configs-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return { dir, store: createConfigStore(dir) };
}
function upload(data, name = 'settings.zip') { return { name, size: data.length, data }; }

test('normalizes loose and wrapped configs, hashes contents, persists and replaces snapshots', async t => {
    const { dir, store } = await fixture(t);
    assert.equal(store.info(), null);
    const first = await store.replace(upload(await makeZip([['configs/mod.toml', 'value=1'], ['configs/nested/test.json', '{}']])));
    assert.equal(first.fileCount, 2);
    assert.equal(first.unpackedSize, 9);
    const reader = store.acquire();
    assert.equal(await fs.readFile(path.join(reader.directory, 'mod.toml'), 'utf8'), 'value=1');
    const same = await store.replace(upload(await makeZip([['nested/test.json', '{}'], ['mod.toml', 'value=1']])));
    assert.equal(first.hash, same.hash, 'ZIP ordering and outer folder do not affect the content hash');
    const next = await store.replace(upload(await makeZip([['config/mod.toml', 'value=2']])));
    assert.notEqual(next.hash, first.hash, 'same-size edits must update the hash');
    const current = store.acquire();
    assert.equal(await fs.readFile(path.join(current.directory, 'mod.toml'), 'utf8'), 'value=2');
    await assert.rejects(fs.access(path.join(current.directory, 'nested/test.json')));
    assert.equal(await fs.readFile(path.join(reader.directory, 'mod.toml'), 'utf8'), 'value=1', 'in-flight downloads retain the old revision');
    reader.release(); current.release();
    const restarted = createConfigStore(dir);
    assert.deepEqual(restarted.info(), next);
    const afterRestart = restarted.acquire();
    assert.equal(await fs.readFile(path.join(afterRestart.directory, 'mod.toml'), 'utf8'), 'value=2');
    afterRestart.release();
});

test('rejects invalid ZIPs, traversal, duplicates, conflicting paths and damaged contents without replacing configs', async t => {
    const { store, dir } = await fixture(t);
    const good = await store.replace(upload(await makeZip([['good.toml', 'valid']])));
    const traversal = await makeZip([['xx/evil.toml', 'bad']]);
    const malicious = Buffer.from(traversal.toString('latin1').replaceAll('xx/evil.toml', '../evil.toml'), 'latin1');
    const damaged = await makeZip([['bad.toml', 'unique-original-content']]);
    damaged[damaged.indexOf('unique-original-content')] ^= 1;
    const oversize = await makeZip([['large.toml', 'x']]);
    oversize.writeUInt32LE(1024 * 1024 * 1024 + 1, oversize.indexOf(Buffer.from('504b0102', 'hex')) + 24);
    for (const data of [Buffer.from('not a zip'), await makeZip([]), malicious, damaged, oversize,
        await makeZip([['same.toml', 'a'], ['SAME.toml', 'b']]),
        await makeZip([['nested', 'a'], ['nested/config.toml', 'b']]),
    ]) {
        await assert.rejects(store.replace(upload(data)), { status: 400 });
        assert.deepEqual(store.info(), good);
    }
    await assert.rejects(store.replace(upload(Buffer.from('no'), 'settings.rar')), { status: 400 });
    await assert.rejects(store.replace({ ...upload(Buffer.from('no')), truncated: true }), { status: 413 });
    await assert.rejects(store.replace(undefined), { status: 400 });
    await assert.rejects(fs.access(path.join(dir, 'evil.toml')));
});
