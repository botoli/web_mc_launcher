'use client';

import { useState } from 'react';
import { Check, Download, FileArchive, FolderCog } from 'lucide-react';
import { api, errorMessage, formatDateTime, formatSize } from '@/lib/api';
import type { ConfigArchive } from '@/lib/types';
import { Notice } from './ui';
import { ResourceUpload } from './resource-upload';

export function ConfigsManager({ initial }: { initial: ConfigArchive | null }) {
  const [configs, setConfigs] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ message: '', kind: 'success' as 'success' | 'error' });

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
      setNotice({ message: 'Конфиги загружены и добавлены в архив сборки для лаунчера.', kind: 'success' });
    } catch (error) { setNotice({ message: errorMessage(error), kind: 'error' }); }
    finally { setBusy(false); }
  }

  return <>
    <div className="panel configs-panel">
    <div className="section-heading resource-heading"><div><h2 id="configs-title">Конфиги</h2><p>Общие настройки модов и сборки</p></div><FolderCog size={22} aria-hidden="true" /></div>
    <div className={`config-status ${configs ? 'published' : ''}`}>{configs ? <><Check size={14} aria-hidden="true" />Добавлены в сборку</> : 'Архив не загружен'}</div>
    <ResourceUpload id="configs-file" extension=".zip" title={configs ? 'Обновить конфиги' : 'Добавить конфиги'} file={file} busy={busy} replacement={!!configs} onChoose={chooseFile} onClear={() => setFile(null)} onUpload={upload} />
    <Notice {...notice} />
      {configs ? <>
        <div className="section-heading config-current-heading"><h3>Текущий архив</h3><span className="count">Файлов: {configs.fileCount}</span></div>
        <div className="config-archive-name"><FileArchive size={24} /><strong>{configs.name}</strong></div>
        <dl className="config-details"><div><dt>Размер архива</dt><dd>{formatSize(configs.size)}</dd></div><div><dt>После распаковки</dt><dd>{formatSize(configs.unpackedSize)}</dd></div><div><dt>Обновлён</dt><dd>{formatDateTime(configs.updatedAt)}</dd></div><div><dt>Папка в сборке</dt><dd><code>configs/</code></dd></div></dl>
        <a className="button secondary" href="/api/download-configs"><Download size={17} />Скачать конфиги</a>
      </> : <div className="config-empty"><p>Загрузи ZIP-архив, чтобы игроки получили одинаковые настройки модов.</p></div>}
      <details className="configs-hint"><summary>Как подготовить архив</summary><p>Добавь в ZIP содержимое папки настроек или папку <code>config/</code> либо <code>configs/</code> целиком. Лаунчер распакует файлы в <code>configs/</code>.</p><p>Новый архив полностью заменяет предыдущий набор конфигов.</p></details>
    </div>
  </>;
}
