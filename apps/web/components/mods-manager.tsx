'use client';

import { useState } from 'react';
import { Blocks, Download, FileArchive, Search, Trash2, X } from 'lucide-react';
import { api, errorMessage, formatSize, json } from '@/lib/api';
import type { Mod } from '@/lib/types';
import { ConfirmDialog, Notice } from './ui';
import { ResourceUpload } from './resource-upload';

export function ModsManager({ initial }: { initial: Mod[] }) {
  const [mods, setMods] = useState(initial);
  const [search, setSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [sort, setSort] = useState('name');
  const [notice, setNotice] = useState({ message: '', kind: 'success' as 'success' | 'error' });
  const filtered = mods.filter(mod => mod.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => sort === 'size' ? b.size - a.size || a.name.localeCompare(b.name) : a.name.localeCompare(b.name, 'ru', { numeric: true }));
  function chooseFile(candidate?: File) {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.jar')) { setNotice({ message: 'Выберите мод в формате .jar.', kind: 'error' }); return; }
    if (candidate.size > 500 * 1024 * 1024) { setNotice({ message: 'Файл слишком большой. Максимальный размер — 500 МБ.', kind: 'error' }); return; }
    setFile(candidate); setNotice({ message: '', kind: 'success' });
  }
  async function refresh() { const data = await api<{ mods: Mod[] }>('/api/mods-list'); setMods(data.mods); }
  async function upload() {
    if (!file) return;
    setBusy(true); setNotice({ message: '', kind: 'success' });
    try {
      const body = new FormData(); body.append('mod', file);
      await api('/api/upload-mod', { method: 'POST', body });
      // Refresh from the server so replacements do not create duplicate rows.
      await refresh(); setFile(null);
      setNotice({ message: 'Мод загружен. Он появится у игроков при следующей синхронизации.', kind: 'success' });
    } catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api('/api/delete-mod', json('POST', { name: confirm }));
      setMods(current => current.filter(mod => mod.name !== confirm)); setConfirm(null);
      setNotice({ message: 'Мод удалён из сборки.', kind: 'success' });
    } catch (error) { setConfirm(null); setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setDeleting(false); }
  }
  return <>
    <div className="section-heading resource-heading"><div><h2 id="mods-title">Установленные моды <span className="count">{mods.length}</span></h2><p>{mods.length ? formatSize(mods.reduce((total, mod) => total + mod.size, 0)) : '0 Б'} · Этот набор получают все игроки</p></div>{mods.length > 0 && <a href="/api/download-mods" className="button secondary"><Download size={17} aria-hidden="true" />Скачать сборку</a>}</div>
    <ResourceUpload id="mod-file" extension=".jar" title="Добавить мод" file={file} busy={busy} replacement={!!file && mods.some(mod => mod.name === file.name)} onChoose={chooseFile} onClear={() => setFile(null)} onUpload={upload} />
    <Notice {...notice} />
    <section className="panel mods-panel" aria-label="Список модов">
      <div className="mods-toolbar"><div className="search-field"><Search size={18} aria-hidden="true" /><input id="mods-search" type="search" aria-label="Поиск модов" placeholder="Поиск по названию мода…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button search-clear" aria-label="Очистить поиск" onClick={() => setSearch('')}><X size={16} /></button>}</div>
      <select aria-label="Сортировка модов" value={sort} onChange={event => setSort(event.target.value)}><option value="name">По названию</option><option value="size">Сначала большие</option></select></div>
      <div className="mod-list-caption"><span role="status">{search.trim() ? `Найдено: ${filtered.length} из ${mods.length}` : `Всего файлов: ${mods.length}`}</span><span>Действия</span></div>
      {filtered.length ? <ul className="mod-list">{filtered.map(mod => <li key={mod.name}><span className="file-icon"><FileArchive size={21} /></span><div className="mod-name"><strong title={mod.name}>{mod.name}</strong><small>{formatSize(mod.size)}</small></div><a className="icon-button" href={`/mods/${encodeURIComponent(mod.name)}`} download title="Скачать мод" aria-label={`Скачать ${mod.name}`}><Download size={18} /></a><button className="icon-button delete-button" disabled={busy || deleting} title="Удалить мод" aria-label={`Удалить ${mod.name}`} onClick={() => setConfirm(mod.name)}><Trash2 size={18} /></button></li>)}</ul>
      : <div className="empty-state"><Blocks size={35} /><h3>{search ? 'Моды не найдены' : 'Мир ждёт новых возможностей'}</h3><p>{search ? 'Попробуй другое название или очисти поиск.' : 'Добавь первый .jar-файл с помощью формы выше.'}</p>{search && <button className="button secondary" onClick={() => setSearch('')}>Очистить поиск</button>}</div>}
    </section><ConfirmDialog name={confirm} busy={deleting} onCancel={() => setConfirm(null)} onConfirm={remove} />
  </>;
}
