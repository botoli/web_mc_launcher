'use client';

import { useRef, useState } from 'react';
import { Download, FileArchive, FolderCog, Upload, X } from 'lucide-react';
import { api, errorMessage, formatDateTime, formatSize } from '@/lib/api';
import type { ConfigArchive } from '@/lib/types';
import { Notice } from './ui';

export function ConfigsManager({ initial }: { initial: ConfigArchive | null }) {
  const [configs, setConfigs] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState({ message: '', kind: 'success' as 'success' | 'error' });
  const input = useRef<HTMLInputElement>(null);

  function chooseFile(candidate?: File) {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.zip')) {
      setNotice({ message: 'Выберите архив конфигов в формате .zip.', kind: 'error' });
      return;
    }
    if (candidate.size > 500 * 1024 * 1024) {
      setNotice({ message: 'Архив слишком большой. Максимальный размер — 500 МБ.', kind: 'error' });
      return;
    }
    setFile(candidate);
    setNotice({ message: '', kind: 'success' });
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setNotice({ message: '', kind: 'success' });
    try {
      const body = new FormData();
      body.append('configs', file);
      const result = await api<{ configs: ConfigArchive }>('/api/upload-configs', { method: 'POST', body });
      setConfigs(result.configs);
      setFile(null);
      if (input.current) input.current.value = '';
      setNotice({ message: 'Конфиги загружены и добавлены в архив сборки для лаунчера.', kind: 'success' });
    } catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(false); }
  }

  return <>
    <div className="section-heading resource-heading"><div><h2 id="configs-title">Конфиги</h2><p>Общие настройки модов и сборки.</p></div></div>
    <div className={`upload-panel ${dragging ? 'dragging' : ''}`}>
      <input className="sr-only" id="configs-file" ref={input} type="file" accept=".zip" disabled={busy} onChange={event => chooseFile(event.target.files?.[0])} />
      <label htmlFor="configs-file" className="dropzone" onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) chooseFile(event.dataTransfer.files[0]); }}>
        <span className="upload-icon"><Upload size={25} /></span><div><h3>Загрузить архив конфигов</h3><p>Перетащи ZIP сюда или <span>выбери на компьютере</span></p><small>Формат .zip · до 500 МБ</small></div>
      </label>
      {file && <div className="selected-file"><FileArchive size={20} /><div><strong>{file.name}</strong><small>{formatSize(file.size)}{configs && ' · Заменит текущий набор конфигов'}</small></div><button className="icon-button" disabled={busy} aria-label="Отменить выбор архива" onClick={() => { setFile(null); if (input.current) input.current.value = ''; }}><X size={18} /></button><button className="button primary" disabled={busy} onClick={upload}><Upload size={17} />{busy ? 'Загрузка…' : 'Загрузить конфиги'}</button></div>}
    </div>
    <Notice {...notice} />
    <div className="panel configs-panel">
      {configs ? <>
        <div className="section-heading"><h3>Текущий архив</h3><span className="count">Файлов: {configs.fileCount}</span></div>
        <div className="config-archive-name"><FileArchive size={24} /><strong>{configs.name}</strong></div>
        <dl className="config-details"><div><dt>Размер архива</dt><dd>{formatSize(configs.size)}</dd></div><div><dt>После распаковки</dt><dd>{formatSize(configs.unpackedSize)}</dd></div><div><dt>Обновлён</dt><dd>{formatDateTime(configs.updatedAt)}</dd></div><div><dt>Папка в сборке</dt><dd><code>configs/</code></dd></div></dl>
        <a className="button secondary" href="/api/download-configs"><Download size={17} />Скачать конфиги</a>
      </> : <div className="empty-state"><FolderCog size={35} /><h3>Конфиги ещё не загружены</h3><p>Добавь ZIP-архив с настройками для сборки.</p></div>}
      <p className="configs-hint">Файлы из архива попадут в <code>configs/</code> при распаковке сборки лаунчером. Можно загрузить содержимое папки или архив с папкой <code>config/</code> либо <code>configs/</code> внутри. Новый архив полностью заменяет опубликованный набор.</p>
    </div>
  </>;
}
