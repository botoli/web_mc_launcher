const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const filename = path.resolve(__dirname, '../apps/web/lib/api.ts');
const source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
let api, ApiError;
before(async () => { ({ api, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)); });
const { parseLogFilters, logQuery } = require('../apps/web/lib/log-filters.ts');
const waitForAbort = signal => new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('a stalled request times out without aborting the caller signal used by loading states', async t => {
    const caller = new AbortController();
    t.mock.method(globalThis, 'fetch', (_url, options) => waitForAbort(options.signal));
    await assert.rejects(api('/api/admin/players', { signal: caller.signal, timeoutMs: 10 }), error =>
        error instanceof ApiError && error.status === 408 && /не ответил вовремя/.test(error.message));
    assert.equal(caller.signal.aborted, false);
});

test('timeout also covers a response body that stalls after its headers arrive', async t => {
    t.mock.method(globalThis, 'fetch', async (_url, options) => ({
        ok: true, status: 200, json: () => waitForAbort(options.signal),
    }));
    await assert.rejects(api('/api/admin/logs', { timeoutMs: 10 }), { status: 408 });
});

test('successful requests and API errors retain their data and status', async t => {
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        assert.equal('timeoutMs' in options, false);
        return Response.json([{ login: 'rider' }]);
    });
    assert.deepEqual(await api('/api/admin/players', { timeoutMs: 100 }), [{ login: 'rider' }]);
    globalThis.fetch = async () => Response.json({ error: 'Временно недоступно' }, { status: 503 });
    await assert.rejects(api('/api/admin/logs'), { message: 'Временно недоступно', status: 503 });
});

test('caller cancellation still aborts the request independently of its timeout', async t => {
    t.mock.method(globalThis, 'fetch', (_url, options) => waitForAbort(options.signal));
    const caller = new AbortController();
    const pending = api('/api/admin/logs', { signal: caller.signal, timeoutMs: 1000 });
    caller.abort();
    await assert.rejects(pending, { status: 0 });
});

test('server and browser normalize the same filters and preserve repeated choices and Moscow dates', () => {
    const filters = parseLogFilters(new URLSearchParams('players=alpha,beta&players=alpha&source=website&source=telegram&from=2026-10-17&to=2026-10-18&page=2&limit=50&sort=player&direction=asc&outcome=denied'));
    assert.deepEqual(filters.players, ['alpha', 'beta']);
    const query = logQuery(filters);
    assert.deepEqual(query.getAll('source'), ['website', 'telegram']);
    assert.equal(query.get('from'), '2026-10-17T00:00:00+03:00');
    assert.equal(query.get('to'), '2026-10-18T23:59:59.999+03:00');
    assert.equal(query.get('page'), '2');
    const invalid = parseLogFilters(new URLSearchParams('page=-1&limit=1000&sort=invalid&outcome=unknown&from=invalid'));
    assert.equal(invalid.page, 1);
    assert.equal(invalid.limit, 25);
    assert.equal(invalid.sort, 'date');
    assert.equal(invalid.outcome, '');
    assert.equal(invalid.from, '');
});
