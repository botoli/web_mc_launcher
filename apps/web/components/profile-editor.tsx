'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Download, Mail, Save, ShieldCheck, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, formatDate, json } from '@/lib/api';
import type { ClientInfo, Profile } from '@/lib/types';
import { Field, Notice, PageHeading, RoleBadge, StatusBadge } from './ui';

export function ProfileEditor({ initial, client }: { initial: Profile; client: ClientInfo | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial.nickname);
  const [nickname, setNickname] = useState(initial.nickname);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [notice, setNotice] = useState({ message: '', kind: 'success' as 'success' | 'error' });
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice({ message: '', kind: 'success' });
    try {
      await api('/api/profile', json('PUT', { nickname: nickname.trim() }));
      setSaved(nickname.trim()); setNickname(nickname.trim()); setNotice({ message: 'Никнейм сохранён.', kind: 'success' }); router.refresh();
    } catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(false); }
  }
  return <><PageHeading title="Твой профиль" description="Так тебя знают в лаунчере и на сервере." />
    <section className="profile-hero" data-player-status={initial.registrationStatus} data-player-role={initial.role}><span className="profile-avatar">{initial.login.slice(0, 2).toUpperCase()}</span><div><h2>{saved || initial.login}</h2><p>{initial.login}</p><div className="profile-badges"><StatusBadge status={initial.registrationStatus} /><RoleBadge role={initial.role} /></div></div></section>
    <div className="profile-layout"><section className="panel"><div className="section-heading"><div><h2>Данные игрока</h2><p>Никнейм можно изменить в любое время.</p></div><UserRound size={22} className="muted" /></div><form onSubmit={save}><div className="profile-fields"><Field label="Логин" hint="Используется для входа. Его нельзя изменить."><input id="profile-login" value={initial.login} readOnly /></Field><Field label="Игровой никнейм" hint="От 1 до 16 символов."><input id="nickname" minLength={1} maxLength={16} required disabled={busy || !ready} value={nickname} onChange={event => { setNickname(event.target.value); setNotice({ message: '', kind: 'success' }); }} /></Field><Field label="Email"><input id="profile-email" readOnly value={initial.email || 'Не указан'} /></Field><Notice {...notice} /></div><div className="form-footer"><span>{nickname !== saved ? 'Есть несохранённые изменения' : 'Профиль актуален'}</span><button className="button primary" disabled={busy || !ready || nickname.trim() === saved || !nickname.trim()}><Save size={17} />{busy ? 'Сохранение…' : 'Сохранить никнейм'}</button></div></form></section>
      <aside className="panel profile-details"><h2>История аккаунта</h2><dl><div><dt><CalendarDays size={17} />Дата регистрации</dt><dd>{formatDate(initial.registeredAt)}</dd></div><div><dt><ShieldCheck size={17} />Последний вход</dt><dd>{formatDate(initial.lastLogin)}</dd></div><div><dt><Mail size={17} />Статус регистрации</dt><dd><StatusBadge status={initial.registrationStatus} /></dd></div></dl>{client && client.size > 0 && <div className="profile-launcher"><p>Лаунчер · версия {client.version}</p><a className="button primary full-width" href={client.url} download><Download size={17} />Скачать последнюю версию</a></div>}</aside></div>
  </>;
}
