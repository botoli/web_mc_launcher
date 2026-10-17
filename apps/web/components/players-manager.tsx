'use client';

import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, MoreVertical, RefreshCw, Search, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage, formatDate, formatDateTime, json } from '@/lib/api';
import { comparePlayers, playerMatchesActivity, playerMatchesSearch, relativeLogin, type ActivityFilter, type PlayerSort } from '@/lib/player-table';
import type { Profile, PlayerStatus } from '@/lib/types';
import { Notice, PageHeading, StatusBadge } from './ui';
import { DropdownMenu } from './dropdown-menu';

const title = 'Люди, которые создают мир';
const description = 'Все аккаунты лаунчера: профили, роли, активность и статусы.';
const statusActions: { value: PlayerStatus; label: string }[] = [
  { value: 'confirmed', label: 'Подтвердить' }, { value: 'pending', label: 'Перевести в ожидание' }, { value: 'banned', label: 'Заблокировать' },
];

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <tbody aria-hidden="true">{Array.from({ length: rows }, (_, index) => <tr key={index} className="player-skeleton-row">
    <td><div className="player-cell"><span className="avatar skeleton" /><div><span className="skeleton skeleton-name" /><span className="skeleton skeleton-detail" /></div></div></td>
    {Array.from({ length: 4 }, (_, cell) => <td key={cell}><span className="skeleton skeleton-value" /></td>)}
    <td className="player-actions-cell"><span className="skeleton skeleton-action" /></td>
  </tr>)}</tbody>;
}

export function PlayersLoading() {
  return <div className="players-page">
    <PageHeading title={title} description={description} action={<button className="button secondary" disabled><RefreshCw size={16} />Обновить</button>} />
    <p className="player-summary" role="status">Загружаем игроков…</p>
    <section className="panel players-panel" aria-label="Список игроков" aria-busy="true">
      <div className="table-toolbar players-toolbar"><span className="skeleton skeleton-toolbar" /></div>
      <div className="table-scroll players-table-scroll"><table className="players-table"><thead><tr>{['Игрок', 'Статус', 'Роль', 'Регистрация', 'Последний вход', 'Действия'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><TableSkeleton /></table></div>
    </section>
  </div>;
}

function PlayerRow({ player, canManageRoles, disabled, saving, now, changeStatus, changeRole, copyId }: {
  player: Profile; canManageRoles: boolean; disabled: boolean; saving: boolean; now: number;
  changeStatus: (login: string, status: PlayerStatus | 'unban') => void;
  changeRole: (login: string, role: Profile['role']) => void;
  copyId: (login: string) => void;
}) {
  const statusButton = useRef<HTMLButtonElement>(null);
  const roleSelect = useRef<HTMLSelectElement>(null);
  const canEditRole = canManageRoles && !player.canManageRoles;
  const frozen = Boolean(player.frozenUntil && player.frozenUntil > now);
  return <tr aria-busy={saving}>
    <td className="player-name-cell"><div className="player-cell"><span className="avatar" aria-hidden="true">{(player.nickname || player.login).slice(0, 2).toUpperCase()}</span><div>
      <Link href={`/players/${encodeURIComponent(player.login)}`} title={player.nickname || player.login}><strong>{player.nickname || player.login}</strong></Link>
      <small title={player.login}>{player.login}</small>
    </div></div></td>
    <td><DropdownMenu buttonRef={statusButton} align="start" label={`Статус ${player.login}`} className="player-status-button" disabled={disabled}
      items={statusActions.map(item => ({ label: item.label, selected: player.registrationStatus === item.value, disabled: player.registrationStatus === item.value, danger: item.value === 'banned', onSelect: () => changeStatus(player.login, item.value) }))}>
      <StatusBadge status={player.registrationStatus} /><ChevronDown size={12} />
    </DropdownMenu>{frozen && <small className="player-freeze" title={`До ${formatDateTime(player.frozenUntil)} МСК`}>Заморожен</small>}
      {saving && <span className="sr-only" role="status">Сохраняем {player.login}…</span>}
    </td>
    <td>{canManageRoles ? <select ref={roleSelect} className="player-role-select" aria-label={`Роль ${player.login}`} value={player.role} disabled={disabled || !canEditRole} title={player.canManageRoles ? 'Роль владельца закреплена' : undefined}
      onChange={event => changeRole(player.login, event.target.value as Profile['role'])}><option value="player">Игрок</option><option value="admin">Админ</option></select>
      : <span className={`player-role-label ${player.role === 'admin' ? 'is-admin' : ''}`}>{player.role === 'admin' ? 'Админ' : 'Игрок'}</span>}</td>
    <td className="player-date"><time dateTime={new Date(player.registeredAt).toISOString()} title={`${formatDateTime(player.registeredAt)} МСК`}>{formatDate(player.registeredAt)}</time>
      <small>{new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(player.registeredAt)} МСК</small></td>
    <td className="player-date"><span title={player.lastLogin ? `${formatDateTime(player.lastLogin)} МСК` : undefined}>{relativeLogin(player.lastLogin, now)}</span>
      {player.lastLogin && <small>{formatDate(player.lastLogin)}</small>}</td>
    <td className="player-actions-cell"><DropdownMenu label={`Действия ${player.login}`} disabled={disabled} items={[
      { label: 'Открыть профиль', href: `/players/${encodeURIComponent(player.login)}` },
      { label: 'Изменить статус', onSelect: () => statusButton.current?.click() },
      ...(canEditRole ? [{ label: 'Изменить роль', onSelect: () => roleSelect.current?.focus() }] : []),
      { label: 'Скопировать ID', onSelect: () => copyId(player.login) },
      { label: player.registrationStatus === 'banned' ? 'Разблокировать' : 'Заблокировать', separator: true, danger: player.registrationStatus !== 'banned', onSelect: () => changeStatus(player.login, player.registrationStatus === 'banned' ? 'unban' : 'banned') },
    ]}><MoreVertical size={19} /></DropdownMenu></td>
  </tr>;
}

export function PlayersManager({ canManageRoles }: { canManageRoles: boolean }) {
  const [players, setPlayers] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [activity, setActivity] = useState<ActivityFilter>('all');
  const [sort, setSort] = useState<PlayerSort>('registeredAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState({ message: '', kind: 'success' as 'error' | 'success' });
  const request = useRef(false);
  const refresh = useCallback(async () => {
    if (request.current) return;
    request.current = true; setLoading(true); setLoadError(''); setNotice({ message: '', kind: 'success' });
    try { setPlayers(await api<Profile[]>('/api/admin/players')); setLoaded(true); setNow(Date.now()); }
    catch (error) { setLoadError(errorMessage(error)); }
    finally { request.current = false; setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const filtered = useMemo(() => players.filter(player =>
    (status === 'all' || player.registrationStatus === status) && (role === 'all' || player.role === role)
    && playerMatchesSearch(player, search) && playerMatchesActivity(player, activity, now)
  ).sort((a, b) => comparePlayers(a, b, sort, direction)), [players, status, role, search, activity, now, sort, direction]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const disabled = busy !== null || loading || Boolean(loadError);
  const hasFilters = Boolean(search || status !== 'all' || role !== 'all' || activity !== 'all');
  function resetFilters() { setSearch(''); setStatus('all'); setRole('all'); setActivity('all'); setPage(1); }
  function changeSort(column: PlayerSort) {
    setDirection(sort === column && direction === 'asc' ? 'desc' : 'asc'); setSort(column); setPage(1);
  }
  function sortHeader(column: PlayerSort, label: string) {
    const Icon = sort !== column ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
    return <th scope="col" aria-sort={sort === column ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="table-sort" onClick={() => changeSort(column)}>{label}<Icon size={13} /></button></th>;
  }
  async function updatePlayer(login: string, field: 'status' | 'role' | 'unban', value: PlayerStatus | Profile['role'] | 'unban') {
    if (request.current) return;
    request.current = true; setBusy(login); setNotice({ message: '', kind: 'success' });
    try {
      const result = await api<{ player: Profile }>(`/api/admin/players/${encodeURIComponent(login)}/${field === 'unban' ? 'moderation' : field}`, field === 'unban' ? json('POST', { action: 'unban' }) : json('PUT', { [field]: value }));
      setPlayers(current => current.map(player => player.login === login ? result.player : player));
      setNotice({ message: field !== 'role' ? `Статус игрока ${login} обновлён.` : `Роль игрока ${login} изменена на «${value === 'admin' ? 'Админ' : 'Игрок'}».`, kind: 'success' });
    } catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { request.current = false; setBusy(null); }
  }
  async function copyId(login: string) {
    try { await navigator.clipboard.writeText(login); setNotice({ message: `ID игрока ${login} скопирован.`, kind: 'success' }); }
    catch { setNotice({ message: `Не удалось скопировать ID. Идентификатор игрока: ${login}`, kind: 'error' }); }
  }

  return <div className="players-page">
    <PageHeading title={title} description={description} action={<button className="button secondary" disabled={loading || busy !== null} onClick={refresh}><RefreshCw size={16} className={loading ? 'spinning' : ''} />{loading ? 'Обновление…' : 'Обновить'}</button>} />
    <p className="player-summary">{loaded ? <>{players.length} игроков · {players.filter(player => player.registrationStatus === 'confirmed').length} подтверждено · {players.filter(player => player.registrationStatus === 'pending').length} ожидают · {players.filter(player => player.registrationStatus === 'banned').length} заблокировано</> : loading ? 'Загружаем игроков…' : 'Список игроков недоступен'}</p>
    <Notice {...notice} />
    <section className="panel players-panel" aria-label="Список игроков" aria-busy={loading}>
      <div className="table-toolbar players-toolbar">
        <div className="search-field"><Search size={17} /><input aria-label="Поиск игроков" placeholder="Поиск игрока, ника или email…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />{search && <button className="icon-button" aria-label="Очистить поиск игроков" onClick={() => { setSearch(''); setPage(1); }}><X size={15} /></button>}</div>
        <select aria-label="Фильтр по статусу" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">Все статусы</option><option value="confirmed">Подтверждён</option><option value="pending">Ожидает</option><option value="banned">Заблокирован</option></select>
        <select aria-label="Фильтр по роли" value={role} onChange={event => { setRole(event.target.value); setPage(1); }}><option value="all">Все роли</option><option value="player">Игрок</option><option value="admin">Админ</option></select>
        <select aria-label="Фильтр по активности" value={activity} onChange={event => { setActivity(event.target.value as ActivityFilter); setPage(1); }}><option value="all">Вся активность</option><option value="today">Заходил сегодня</option><option value="week">Последние 7 дней</option><option value="inactive">Не заходил 30+ дней</option><option value="never">Никогда не заходил</option></select>
        <span className="results-count" role="status">Найдено: {loading || loadError ? '—' : filtered.length}</span>
      </div>
      <div className="table-scroll players-table-scroll" tabIndex={0} role="region" aria-label="Таблица игроков">
        <table className="players-table"><thead><tr>{sortHeader('name', 'Игрок')}<th scope="col">Статус</th><th scope="col">Роль</th>{sortHeader('registeredAt', 'Регистрация')}{sortHeader('lastLogin', 'Последний вход')}<th scope="col" className="player-actions-cell">Действия</th></tr></thead>
          {loading ? <TableSkeleton rows={loaded ? Math.max(1, visible.length) : 6} /> : <tbody>{!loadError && visible.map(player => <PlayerRow key={player.login} player={player} canManageRoles={canManageRoles} disabled={disabled} saving={busy === player.login} now={now} changeStatus={(login, value) => updatePlayer(login, value === 'unban' ? 'unban' : 'status', value)} changeRole={(login, value) => updatePlayer(login, 'role', value)} copyId={copyId} />)}</tbody>}
        </table>
      </div>
      {loading && <span className="sr-only" role="status">Загружаем игроков…</span>}
      {!loading && (loadError ? <div className="empty-state player-table-error" role="alert"><AlertCircle size={30} /><h3>Не удалось загрузить игроков</h3><p>{loadError}</p><button className="button secondary" onClick={refresh}>Повторить</button></div>
        : !filtered.length && <div className="empty-state"><Users size={32} /><h3>{players.length ? 'По вашему запросу ничего не найдено' : 'Игроков пока нет'}</h3><p>{players.length ? 'Измените запрос или сбросьте фильтры.' : 'После регистрации игроки появятся здесь.'}</p>{hasFilters && <button className="button secondary" onClick={resetFilters}>Сбросить фильтры</button>}</div>)}
      {!loading && !loadError && players.length > 25 && <footer className="players-pagination">
        <label>Показывать: <select aria-label="Игроков на странице" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <span className="pagination-range">{filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)} из {filtered.length}</span>
        <nav aria-label="Страницы игроков"><button className="icon-button" aria-label="Предыдущая страница" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><span aria-live="polite">{currentPage} / {pages}</span><button className="icon-button" aria-label="Следующая страница" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></nav>
      </footer>}
    </section>
  </div>;
}
