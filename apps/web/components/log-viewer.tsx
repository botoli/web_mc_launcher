'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, RefreshCw, ScrollText } from 'lucide-react';
import { api, errorMessage, formatDateTime } from '@/lib/api';
import type { EventsPage } from '@/lib/types';
import { Notice } from './ui';

const actions: Record<string, string> = {
  login: 'Вход', logout: 'Выход', registered: 'Регистрация', nickname_changed: 'Смена никнейма',
  telegram_linked: 'Привязка Telegram', telegram_unlinked: 'Отвязка Telegram',
  discord_linked: 'Привязка Discord', discord_unlinked: 'Отвязка Discord',
  connect: 'Подключение', disconnect: 'Отключение', connection_denied: 'Подключение отклонено',
  ban: 'Бан в лаунчере', unban: 'Разбан', freeze: 'Заморозка', unfreeze: 'Снятие заморозки',
  status_changed: 'Изменение статуса', role_changed: 'Изменение роли',
  email_changed: 'Смена email', password_changed: 'Смена пароля', password_check: 'Проверка пароля',
  telegram_username_changed: 'Смена Telegram-юзернейма', sessions_revoked: 'Завершение сессий',
  mod_added: 'Добавление мода', mod_replaced: 'Замена мода', mod_deleted: 'Удаление мода',
  build_config_changed: 'Изменение конфигурации сборки',
};
const sources: Record<string, string> = { website: 'Сайт', launcher: 'Лаунчер', telegram: 'Telegram', discord: 'Discord', minecraft: 'Minecraft' };
const methods: Record<string, string> = { password: 'Пароль', token: 'Токен', cookie: 'Сессия сайта', bot: 'Бот' };
const outcomes: Record<string, string> = { success: 'Успешно', failed: 'Ошибка', denied: 'Отклонено' };

const targetLabels: Record<string, string> = { website: 'Сайт', launcher: 'Лаунчер', telegram: 'Telegram', discord: 'Discord', minecraft: 'Minecraft', server_build: 'Сборка сервера', admin: 'Админ', player: 'Игрок', confirmed: 'Подтверждён', pending: 'Ожидает', banned: 'Заблокирован' };
function targetLabel(action: string, target: string) {
  if (action === 'freeze' && Number.isFinite(Date.parse(target))) return `До ${formatDateTime(Date.parse(target))}`;
  return targetLabels[target] || target;
}

export function LogViewer({ login, category = '' }: { login?: string; category?: string }) {
  const [query, setQuery] = useState(''), [source, setSource] = useState(''), [outcome, setOutcome] = useState('');
  const [group, setGroup] = useState(category), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<EventsPage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, source, outcome, category: group, page: String(page) });
      if (login) params.set('login', login);
      if (from) params.set('from', `${from}T00:00:00+03:00`);
      if (to) params.set('to', `${to}T23:59:59.999+03:00`);
      api<EventsPage>(`/api/admin/logs?${params}`).then(result => { if (active) setData(result); })
        .catch(err => { if (active) { setError(errorMessage(err)); setData(null); } })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, source, outcome, group, from, to, page, refresh, login]);
  function reset() { setQuery(''); setSource(''); setOutcome(''); setGroup(category); setFrom(''); setTo(''); setPage(1); }
  return <section className="panel logs-panel">
    <div className="log-filters">
      <input aria-label="Поиск в логах" placeholder="Ник, логин, @username, IP или бот…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
      {!category && <select aria-label="Тип событий" value={group} onChange={e => { setGroup(e.target.value); setPage(1); }}><option value="">Все действия</option><option value="auth">Авторизации</option><option value="connections">Подключения</option><option value="account">Аккаунт</option><option value="administration">Моды и конфигурация</option><option value="moderation">Модерация</option></select>}
      <select aria-label="Источник события" value={source} onChange={e => { setSource(e.target.value); setPage(1); }}><option value="">Все источники</option>{Object.entries(sources).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Результат события" value={outcome} onChange={e => { setOutcome(e.target.value); setPage(1); }}><option value="">Любой результат</option>{Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label className="date-filter">С даты<input type="date" aria-label="С даты" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="date-filter">По дату<input type="date" aria-label="По дату" value={to} min={from} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      <button className="button secondary" onClick={reset}>Сбросить</button>
      <button className="button secondary" aria-label="Обновить логи" disabled={loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={16} />Обновить</button>
    </div>
    <Notice message={error} />
    <div className="log-meta"><span role="status">{loading ? 'Загрузка событий…' : `Найдено событий: ${data?.total || 0}`}</span><span>Время — Москва (UTC+3)</span></div>
    {!error && data && data.items.length > 0 ? <>
      <div className="table-scroll log-table-scroll" role="region" tabIndex={0} aria-label="Журнал действий" aria-busy={loading}>
        <table className="logs-table"><thead><tr><th>Дата и время</th><th>Игрок</th><th>Telegram / Discord</th><th>Действие</th><th>Откуда</th><th>Куда / объект</th><th>IP</th><th>Результат</th><th><span className="sr-only">Подробности</span></th></tr></thead>
        <tbody>{data.items.map(event => <Fragment key={event.id}><tr className={expanded === event.id ? 'event-expanded' : ''}>
          <td className="event-time"><time dateTime={new Date(event.at).toISOString()}>{new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Moscow' }).format(event.at)}</time><small>{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' }).format(event.at)}</small></td>
          <td>{event.login ? <Link className="event-player" href={`/players/${encodeURIComponent(event.login)}`}>{event.nickname || event.login}<small>{event.login}</small></Link> : <><strong>Аккаунт не привязан</strong><small className="event-detail">{event.telegramId ? 'Telegram' : 'Discord'}</small></>}</td>
          <td className="event-identities">{event.telegramId || event.telegramUsername ? <span title={`Telegram ID: ${event.telegramId}`}>{event.telegramUsername ? `@${event.telegramUsername}` : `TG: ${event.telegramId}`}</span> : null}{event.discordId || event.discordUsername ? <span title={`Discord ID: ${event.discordId}`}>{event.discordUsername || `Discord: ${event.discordId}`}</span> : null}{!event.telegramId && !event.telegramUsername && !event.discordId && !event.discordUsername && <span className="muted">—</span>}</td>
          <td><strong>{actions[event.action] || event.action}</strong></td>
          <td><span className={`source-badge source-${event.source}`}>{sources[event.source] || event.source}</span>{event.bot && <small className="event-detail">{event.bot}</small>}</td>
          <td className="event-target">{targetLabel(event.action, event.target) || (event.action === 'login' || event.action === 'logout' ? targetLabels[event.source === 'telegram' ? 'launcher' : event.source] : '—')}</td>
          <td><code className="event-ip">{event.ip || '—'}</code></td>
          <td><span className={`badge ${event.outcome === 'success' ? 'confirmed' : 'banned'}`}><span className="status-dot" />{outcomes[event.outcome] || event.outcome}</span></td>
          <td><button className="icon-button" aria-label={`Подробности события ${event.id}`} aria-expanded={expanded === event.id} aria-controls={`event-${event.id}`} onClick={() => setExpanded(current => current === event.id ? null : event.id)}><ChevronDown size={17} /></button></td>
        </tr>{expanded === event.id && <tr id={`event-${event.id}`} className="event-details-row"><td colSpan={9}><dl className="event-details">{[
          ['Когда', formatDateTime(event.at) + ' МСК'], ['Инициатор', event.actor], ['Способ', methods[event.method] || event.method || '—'],
          ['Назначение', targetLabel(event.action, event.target) || event.target || '—'], ['Причина', event.reason || '—'],
          ['Telegram ID', event.telegramId || '—'], ['Discord ID', event.discordId || '—'], ['Устройство', event.userAgent || 'Не передано'],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></td></tr>}</Fragment>)}</tbody></table>
      </div>
      <div className="log-pagination"><button className="button secondary" disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>Назад</button><span>Страница {page} из {Math.max(1, Math.ceil(data.total / data.limit))}</span><button className="button secondary" disabled={loading || page * data.limit >= data.total} onClick={() => setPage(p => p + 1)}>Далее</button></div>
    </> : !loading && !error && <div className="empty-state"><ScrollText size={32} /><h3>События не найдены</h3><p>Измени фильтры. Новые действия появятся здесь после их совершения.</p></div>}
  </section>;
}
