import type { Profile } from './types';

export type ActivityFilter = 'all' | 'today' | 'week' | 'inactive' | 'never';
export type PlayerSort = 'name' | 'registeredAt' | 'lastLogin';
const day = 86_400_000;
const moscowDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
const relative = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'always' });

export function playerMatchesSearch(player: Profile, search: string) {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  return [player.login, player.nickname, player.email, player.telegramUsername, player.discordUsername, player.telegramId, player.discordId]
    .some(value => value?.toLocaleLowerCase('ru-RU').includes(query));
}
export function playerMatchesActivity(player: Profile, activity: ActivityFilter, now: number) {
  const last = player.lastLogin;
  if (activity === 'all') return true;
  if (activity === 'never') return !last;
  if (!last) return false;
  if (activity === 'today') return moscowDay.format(last) === moscowDay.format(now);
  if (activity === 'week') return last >= now - 7 * day && last <= now;
  return last <= now - 30 * day;
}
export function comparePlayers(a: Profile, b: Profile, sort: PlayerSort, direction: 'asc' | 'desc') {
  // Accounts without a login stay at the end in either direction.
  if (sort === 'lastLogin' && (!a.lastLogin || !b.lastLogin)) {
    return a.lastLogin ? -1 : b.lastLogin ? 1 : a.login.localeCompare(b.login);
  }
  const result = sort === 'name'
    ? (a.nickname || a.login).localeCompare(b.nickname || b.login, 'ru-RU', { numeric: true, sensitivity: 'base' })
    : (a[sort] || 0) - (b[sort] || 0);
  return (direction === 'asc' ? result : -result) || a.login.localeCompare(b.login);
}
export function relativeLogin(value: number | null, now: number) {
  if (!value) return 'Ещё не заходил';
  const elapsed = Math.max(0, now - value);
  if (elapsed < 60_000) return 'Только что';
  if (elapsed < 3_600_000) return relative.format(-Math.floor(elapsed / 60_000), 'minute');
  if (elapsed < day) return relative.format(-Math.floor(elapsed / 3_600_000), 'hour');
  if (elapsed < 30 * day) return relative.format(-Math.floor(elapsed / day), 'day');
  if (elapsed < 365 * day) return relative.format(-Math.floor(elapsed / (30 * day)), 'month');
  return relative.format(-Math.floor(elapsed / (365 * day)), 'year');
}
