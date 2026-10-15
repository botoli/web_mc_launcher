'use client';

import { Search, Users, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { api, errorMessage, formatDate, json } from '@/lib/api';
import type { Profile, PlayerStatus } from '@/lib/types';
import { Notice, PageHeading, StatusBadge } from './ui';

export function PlayersManager({ initial, canManageRoles }: { initial: Profile[]; canManageRoles: boolean }) {
  const [players, setPlayers] = useState(initial);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState({ message: '', kind: 'success' as 'error' | 'success' });
  const filtered = players.filter(player => (filter === 'all' || player.registrationStatus === filter) && `${player.login} ${player.nickname} ${player.email}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  async function changeStatus(login: string, status: PlayerStatus) {
    setBusy(login); setNotice({ message: '', kind: 'success' });
    try {
      const result = await api<{ player: Profile }>(`/api/admin/players/${encodeURIComponent(login)}/status`, json('PUT', { status }));
      setPlayers(current => current.map(player => player.login === login ? result.player : player));
      setNotice({ message: `Статус игрока ${login} обновлён.`, kind: 'success' });
    } catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(null); }
  }
  async function refresh() {
    setRefreshing(true);
    try { setPlayers(await api<Profile[]>('/api/admin/players')); setNotice({ message: 'Список игроков обновлён.', kind: 'success' }); }
    catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setRefreshing(false); }
  }
  async function changeRole(login: string, role: Profile['role']) {
    setBusy(login); setNotice({ message: '', kind: 'success' });
    try {
      const result = await api<{ player: Profile }>(`/api/admin/players/${encodeURIComponent(login)}/role`, json('PUT', { role }));
      setPlayers(current => current.map(player => player.login === login ? result.player : player));
      setNotice({ message: `Роль игрока ${login} изменена на «${role === 'admin' ? 'Админ' : 'Игрок'}».`, kind: 'success' });
    } catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(null); }
  }
  return <>
    <PageHeading title="Люди, которые создают мир" description="Все аккаунты лаунчера: профили, роли, активность и статусы." action={<button className="button secondary" disabled={refreshing || busy !== null} onClick={refresh}><RefreshCw size={16} className={refreshing ? 'spinning' : ''} />{refreshing ? 'Обновление…' : 'Обновить'}</button>} />
    <div className="player-summary"><Users size={24} /><strong>{players.length}</strong><span>игроков зарегистрировано</span><span className="summary-divider" /><span>{players.filter(player => player.registrationStatus === 'confirmed').length} подтверждено</span></div>
    <Notice {...notice} />
    <section className="panel players-panel"><div className="table-toolbar"><div className="search-field"><Search size={18} /><input aria-label="Поиск игроков" placeholder="Логин, никнейм или email…" value={search} onChange={event => setSearch(event.target.value)} /></div><select aria-label="Фильтр по статусу" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все статусы</option><option value="confirmed">Подтверждён</option><option value="pending">Ожидает</option><option value="banned">Заблокирован</option></select><span className="results-count">Найдено: {filtered.length}</span></div>
      {filtered.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица игроков"><table><thead><tr><th>Игрок</th><th>Email</th><th>Статус</th><th>Роль</th><th>Регистрация</th><th>Последний вход</th><th>Изменить статус</th><th>Действия</th></tr></thead><tbody>{filtered.map(player => <tr key={player.login}><td><div className="player-cell"><span className="avatar">{player.login.slice(0, 2).toUpperCase()}</span><div><Link href={`/players/${encodeURIComponent(player.login)}`}><strong>{player.nickname || player.login}</strong></Link><small>{player.login}</small></div></div></td><td className="muted">{player.email || '—'}</td><td><StatusBadge status={player.registrationStatus} />{player.frozenUntil && <span className="badge pending">Заморожен</span>}</td><td>{canManageRoles ? <select aria-label={`Роль ${player.login}`} value={player.role} disabled={busy !== null || refreshing || player.canManageRoles} title={player.canManageRoles ? 'botoli1 управляет ролями, его роль закреплена' : undefined} onChange={event => changeRole(player.login, event.target.value as Profile['role'])}><option value="player">Игрок</option><option value="admin">Админ</option></select> : <span className={`badge ${player.role === 'admin' ? 'pending' : 'neutral'}`}>{player.role === 'admin' ? 'Админ' : 'Игрок'}</span>}</td><td>{formatDate(player.registeredAt)}</td><td className="muted">{formatDate(player.lastLogin)}</td><td><select aria-label={`Статус ${player.login}`} value={player.registrationStatus} disabled={busy !== null || refreshing} onChange={event => changeStatus(player.login, event.target.value as PlayerStatus)}><option value="confirmed">Подтверждён</option><option value="pending">Ожидает</option><option value="banned">Заблокирован</option></select>{busy === player.login && <small role="status">Сохраняем…</small>}</td><td><Link className="button secondary" href={`/players/${encodeURIComponent(player.login)}`}>Действия</Link></td></tr>)}</tbody></table></div>
      : <div className="empty-state"><Users size={35} /><h3>{players.length ? 'Игроки не найдены' : 'Первое приключение ещё впереди'}</h3><p>{players.length ? 'Измени запрос или выбери другой статус.' : 'После регистрации игроки появятся здесь.'}</p>{players.length > 0 && <button className="button secondary" onClick={() => { setSearch(''); setFilter('all'); }}>Сбросить фильтры</button>}</div>}
    </section>
  </>;
}
