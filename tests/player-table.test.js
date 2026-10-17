const { test } = require('node:test');
const assert = require('node:assert/strict');
const { playerMatchesSearch, playerMatchesActivity, comparePlayers, relativeLogin } = require('../apps/web/lib/player-table.ts');
const now = Date.parse('2026-10-17T14:00:00+03:00');
const day = 86_400_000;
const player = { login: 'tg_964264865', nickname: 'Builder', email: 'user@example.test', telegramUsername: 'TestTelegram', discordUsername: 'test.discord', telegramId: '964264865', discordId: '123456789', lastLogin: null };

test('search covers all exposed identifiers, ignores case and surrounding spaces', () => {
  for (const query of ['TG_964264865', ' builder ', 'USER@EXAMPLE', 'testtelegram', 'TEST.DISCORD', '964264865', '123456789', '']) assert.equal(playerMatchesSearch(player, query), true, query);
  assert.equal(playerMatchesSearch(player, 'absent'), false);
  assert.equal(playerMatchesSearch({ ...player, email: '', telegramUsername: '', discordUsername: '', telegramId: null, discordId: null }, '964264865'), true);
});

test('activity uses Moscow calendar days and precise seven/thirty day boundaries', () => {
  const matches = (lastLogin, filter, clock = now) => playerMatchesActivity({ ...player, lastLogin }, filter, clock);
  assert.equal(matches(null, 'all'), true);
  assert.equal(matches(null, 'never'), true);
  for (const filter of ['today', 'week', 'inactive']) assert.equal(matches(null, filter), false);
  const midnight = Date.parse('2026-10-17T00:15:00+03:00');
  assert.equal(matches(Date.parse('2026-10-16T23:59:00+03:00'), 'today', midnight), false);
  assert.equal(matches(Date.parse('2026-10-17T00:01:00+03:00'), 'today', midnight), true);
  assert.equal(matches(now - 7 * day, 'week'), true);
  assert.equal(matches(now - 7 * day - 1, 'week'), false);
  assert.equal(matches(now - 30 * day, 'inactive'), true);
  assert.equal(matches(now - 30 * day + 1, 'inactive'), false);
});

test('last-login sorting keeps accounts without activity last in either direction', () => {
  const older = { ...player, login: 'older', lastLogin: now - day };
  const recent = { ...player, login: 'recent', lastLogin: now };
  assert.deepEqual([player, recent, older].sort((a, b) => comparePlayers(a, b, 'lastLogin', 'desc')).map(p => p.login), ['recent', 'older', player.login]);
  assert.deepEqual([player, recent, older].sort((a, b) => comparePlayers(a, b, 'lastLogin', 'asc')).map(p => p.login), ['older', 'recent', player.login]);
  assert.equal(comparePlayers({ ...player, nickname: 'Player 2' }, { ...player, nickname: 'Player 10' }, 'name', 'asc') < 0, true);
});

test('relative login handles missing, future and elapsed timestamps in Russian', () => {
  assert.equal(relativeLogin(null, now), 'Ещё не заходил');
  assert.equal(relativeLogin(now + day, now), 'Только что');
  assert.equal(relativeLogin(now - 2 * 3_600_000, now), '2 часа назад');
  assert.equal(relativeLogin(now - day, now), '1 день назад');
  assert.equal(relativeLogin(now - 5 * day, now), '5 дней назад');
});
