const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPlayerServices } = require('../apps/api/src/players/services');

test('log options, combined filters, Moscow dates and sorting apply before pagination', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-log-filters-'));
  const users = { admin: { role: 'admin' }, alpha: { nickname: 'Alpha', telegramId: '123' }, beta: { nickname: 'Beta', discordId: '456' } };
  let now = Date.parse('2026-10-16T23:59:59+03:00');
  const service = createPlayerServices({ users, saveUsers() {}, dataDir: dir, now: () => now });
  const before = service.audit(null, 'alpha', 'auth', 'login', { source: 'website', outcome: 'success' });
  now += 1000;
  const first = service.audit(null, 'alpha', 'auth', 'password_check', { source: 'telegram', outcome: 'failed', telegramUsername: 'old_name' });
  now += 1000;
  const second = service.audit(null, 'beta', 'auth', 'login', { source: 'discord', outcome: 'denied' });
  now += 1000;
  const unlinked = service.audit(null, '', 'account', 'telegram_unlinked', { source: 'telegram', telegramId: '789' });
  const app = express();
  service.install(app, (req, res, next) => {
    if (!req.get('X-User')) return res.sendStatus(401);
    req.user = { login: req.get('X-User') }; next();
  });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const get = async (query, user = 'admin', route = '/api/admin/logs') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}?${query}`, { headers: user ? { 'X-User': user } : {} });
    return { status: response.status, body: response.status === 200 ? await response.json() : null };
  };
  const options = await get('', 'admin', '/api/admin/logs/options');
  assert.equal(options.body.actions.find(action => action.value === 'password_check').category, 'auth');
  assert.match(options.body.players.find(player => player.id === 'alpha').search, /old_name/);
  assert.ok(options.body.players.some(player => player.id === 'telegram:789'));
  assert.ok(options.body.players.every(player => !Object.hasOwn(player, 'email')));
  for (const route of ['/api/admin/logs', '/api/admin/logs/options']) {
    assert.equal((await get('', '', route)).status, 401);
    assert.equal((await get('', 'alpha', route)).status, 403);
  }
  const filtered = await get('players=alpha&players=beta&actions=login&actions=password_check&source=telegram&source=discord&from=2026-10-17T00:00:00%2B03:00&to=2026-10-17T23:59:59.999%2B03:00');
  assert.deepEqual(filtered.body.items.map(event => event.id), [second.id, first.id]);
  assert.equal((await get('players=alpha&outcome=failed')).body.total, 1);
  assert.deepEqual((await get('players=telegram%3A789')).body.items.map(event => event.id), [unlinked.id]);
  assert.deepEqual((await get('sort=date&direction=asc&limit=1&page=2')).body.items.map(event => event.id), [first.id]);
  assert.equal((await get('players=alpha,beta&sort=player&direction=asc&limit=1&page=3')).body.items[0].login, 'beta');
  const last = await get('players=alpha&page=999&limit=1');
  assert.equal(last.body.page, 2); assert.equal(last.body.items[0].id, before.id);
  assert.equal((await get('players=missing&page=999')).body.page, 1);
  assert.equal((await get('from=2026-10-18&to=2026-10-17')).status, 400);
  assert.equal((await get('sort=invalid')).status, 400);
  assert.equal((await get('page=0')).status, 400);
  assert.equal((await get('login=alpha', 'admin', '/api/admin/players/beta/actions')).body.items.every(event => event.login === 'beta'), true);
});
