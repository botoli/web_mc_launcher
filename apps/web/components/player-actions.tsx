'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Shield, RefreshCw } from 'lucide-react';
import { api, errorMessage, formatDateTime, json } from '@/lib/api';
import type { Profile } from '@/lib/types';
import { Field, Notice, PageHeading, RoleBadge, StatusBadge } from './ui';
import { LogViewer } from './log-viewer';

const tabs = [{ id: 'data', label: 'Данные об игроке' }, { id: 'auth', label: 'Лог авторизаций' }, { id: 'connections', label: 'Подключения на сервер' }, { id: 'all', label: 'Все действия' }];
const labels: Record<string, string> = { ban: 'Забанить аккаунт', unban: 'Разбанить аккаунт', freeze: 'Заморозить аккаунт', unfreeze: 'Снять заморозку' };

export function PlayerActions({ initial }: { initial: Profile }) {
  const [player, setPlayer] = useState(initial), [tab, setTab] = useState('data');
  const [hours, setHours] = useState('24'), [reason, setReason] = useState(''), [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState({ message: '', kind: 'success' as 'success' | 'error' });
  const [now, setNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const endpoint = `/api/admin/players/${encodeURIComponent(player.login)}`;
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (action) dialog.current?.showModal(); else dialog.current?.close(); }, [action]);
  const frozen = Boolean(player.frozenUntil && (!now || player.frozenUntil > now));
  async function moderate() {
    setBusy(true); setNotice({ message: '', kind: 'success' });
    try {
      const result = await api<{ player: Profile }>(`${endpoint}/moderation`, json('POST', { action, hours: Number(hours), reason }));
      setPlayer(result.player); setAction(null); setReason(''); setNotice({ message: 'Ограничения аккаунта обновлены.', kind: 'success' });
    } catch (error) { setAction(null); setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true);
    try { setPlayer(await api<Profile>(endpoint)); setNotice({ message: 'Данные игрока обновлены.', kind: 'success' }); }
    catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(false); }
  }
  return <div className="player-detail" data-player-status={player.registrationStatus} data-player-role={player.role}>
    <Link className="back-link" href="/players"><ArrowLeft size={16} />Все игроки</Link>
    <PageHeading title={player.nickname || player.login} description={`Аккаунт ${player.login} · данные и история действий`} action={<button className="button secondary" disabled={busy} onClick={refresh}><RefreshCw size={16} />Обновить данные</button>} />
    <div className="player-flags"><StatusBadge status={player.registrationStatus} /><RoleBadge role={player.role} />{frozen && <span className="badge pending">Заморожен до {formatDateTime(player.frozenUntil)}</span>}</div>
    <Notice {...notice} />
    <div className="player-tabs" role="tablist" aria-label="Действия игрока">{tabs.map((item, index) => <button key={item.id} id={`tab-${item.id}`} type="button" role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls="player-tab-panel" onClick={() => setTab(item.id)} onKeyDown={e => {
      let next = index;
      if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      else return;
      e.preventDefault(); setTab(tabs[next].id); document.getElementById(`tab-${tabs[next].id}`)?.focus();
    }}>{item.label}</button>)}</div>
    <div key={tab} id="player-tab-panel" className="tab-content-enter" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'data' ? <div className="player-detail-grid"><section className="panel"><h2>Данные об игроке</h2><dl className="player-data">{[
        ['Логин', player.login], ['Никнейм', player.nickname], ['Email', player.email || 'Не указан'],
        ['Telegram', player.telegramId ? `${player.telegramUsername ? '@' + player.telegramUsername + ' · ' : ''}${player.telegramId}` : 'Не привязан'], ['Discord', player.discordId ? `${player.discordUsername ? player.discordUsername + ' · ' : ''}${player.discordId}` : 'Не привязан'],
        ['Регистрация', formatDateTime(player.registeredAt)], ['Последний вход', formatDateTime(player.lastLogin)],
        ['Роль', player.role === 'admin' ? 'Админ' : 'Игрок'],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        <section className="panel moderation-panel"><div className="section-heading"><h2>Доступ к лаунчеру</h2><Shield size={21} /></div><p className="muted">Бан и заморозка действуют в лаунчере. Игрок сохраняет доступ к своему профилю на сайте. Заморозка снимается автоматически по истечении срока.</p>{player.moderationReason && <p className="moderation-reason">Причина: {player.moderationReason}</p>}
          <Field label="Причина ограничения"><input id="moderation-reason" value={reason} maxLength={500} disabled={busy} placeholder="Обязательна для бана и заморозки" onChange={e => setReason(e.target.value)} /></Field>
          <Field label="Заморозка на часов" hint="Допустим дробный срок, максимум 8760 часов."><input id="freeze-hours" type="number" min="0.01" max="8760" step="0.01" value={hours} disabled={busy} onChange={e => setHours(e.target.value)} /></Field>
          <div className="actions">{player.registrationStatus === 'banned' ? <button className="button primary" disabled={busy} onClick={() => setAction('unban')}>Разбанить</button> : <><button className="button danger" disabled={busy || !reason.trim()} onClick={() => setAction('ban')}>Бан аккаунта</button><button className="button secondary" disabled={busy || !reason.trim() || !Number.isFinite(Number(hours)) || Number(hours) <= 0 || Number(hours) > 8760} onClick={() => setAction('freeze')}>Заморозить</button></>}{frozen && <button className="button secondary" disabled={busy} onClick={() => setAction('unfreeze')}>Снять заморозку</button>}</div>
        </section></div> : <>{tab === 'connections' && <p className="log-explanation">История фактических подключений, переданная игровым сервером. Входы в лаунчер находятся во вкладке авторизаций.</p>}<LogViewer key={tab} login={player.login} category={tab === 'all' ? '' : tab} /></>}
    </div>
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="moderation-title" onCancel={e => { e.preventDefault(); if (!busy) setAction(null); }}><h2 id="moderation-title">{action && labels[action]}?</h2><p>Игрок: <strong>{player.nickname}</strong>{action === 'freeze' && ` · срок: ${hours} ч.`}{reason && <><br />Причина: {reason}</>}</p><div className="actions"><button className="button secondary" autoFocus disabled={busy} onClick={() => setAction(null)}>Отмена</button><button className="button danger" disabled={busy} onClick={moderate}>{busy ? 'Сохранение…' : 'Подтвердить'}</button></div></dialog>
  </div>;
}
