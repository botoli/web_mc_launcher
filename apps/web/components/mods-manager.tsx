'use client';

import { useRef, useState } from 'react';
import { Blocks, Download, FileArchive, Search, Trash2, Upload, X } from 'lucide-react';
import { api, errorMessage, formatSize, json } from '@/lib/api';
import type { Mod } from '@/lib/types';
import { ConfirmDialog, Notice } from './ui';

export function ModsManager({ initial }: { initial: Mod[] }) {
  const [mods, setMods] = useState(initial);
  const [search, setSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState({ message: '', kind: 'success' as 'success' | 'error' });
  const fileInput = useRef<HTMLInputElement>(null);
  const filtered = mods.filter(mod => mod.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
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
      await refresh(); setFile(null); if (fileInput.current) fileInput.current.value = '';
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
    <div className="section-heading resource-heading"><div><h2 id="mods-title">Моды</h2><p>Дополнения для твоей сборки.</p></div>{mods.length > 0 && <a href="/api/download-mods" className="button secondary"><Download size={17} />Скачать сборку</a>}</div>
    <section className={`upload-panel ${dragging ? 'dragging' : ''}`}>
      <input className="sr-only" id="mod-file" ref={fileInput} type="file" accept=".jar" disabled={busy} onChange={event => chooseFile(event.target.files?.[0])} />
      <label htmlFor="mod-file" className="dropzone" onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) chooseFile(event.dataTransfer.files[0]); }}>
        <span className="upload-icon"><Upload size={25} /></span><div><h2>Добавить мод в сборку</h2><p>Перетащи файл сюда или <span>выбери на компьютере</span></p><small>Формат .jar · до 500 МБ</small></div>
      </label>
      {file && <div className="selected-file"><FileArchive size={20} /><div><strong>{file.name}</strong><small>{formatSize(file.size)}{mods.some(mod => mod.name === file.name) && ' · Заменит существующий файл'}</small></div><button className="icon-button" disabled={busy} aria-label="Отменить выбор файла" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}><X size={18} /></button><button className="button primary" disabled={busy} onClick={upload}><Upload size={17} />{busy ? 'Загрузка…' : 'Загрузить мод'}</button></div>}
    </section><Notice {...notice} />
    <section className="panel mods-panel"><div className="section-heading"><div><h2>Установленные моды <span className="count">{mods.length}</span></h2><p>Этот набор получают все игроки.</p></div><div className="search-field"><Search size={18} /><input id="mods-search" aria-label="Поиск модов" placeholder="Найти мод…" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
      {filtered.length ? <ul className="mod-list">{filtered.map(mod => <li key={mod.name}><span className="file-icon"><FileArchive size={21} /></span><div className="mod-name"><strong>{mod.name}</strong><small>{formatSize(mod.size)}</small></div><a className="icon-button" href={`/mods/${encodeURIComponent(mod.name)}`} download aria-label={`Скачать ${mod.name}`}><Download size={18} /></a><button className="icon-button delete-button" disabled={busy || deleting} aria-label={`Удалить ${mod.name}`} onClick={() => setConfirm(mod.name)}><Trash2 size={18} /></button></li>)}</ul>
      : <div className="empty-state"><Blocks size={35} /><h3>{search ? 'Моды не найдены' : 'Мир ждёт новых возможностей'}</h3><p>{search ? 'Попробуй другое название или очисти поиск.' : 'Добавь первый .jar-файл с помощью формы выше.'}</p>{search && <button className="button secondary" onClick={() => setSearch('')}>Очистить поиск</button>}</div>}
    </section><ConfirmDialog name={confirm} busy={deleting} onCancel={() => setConfirm(null)} onConfirm={remove} />
  </>;
}
