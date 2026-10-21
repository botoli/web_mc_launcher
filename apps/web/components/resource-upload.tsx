'use client';

import { useRef, useState } from 'react';
import { FileArchive, LoaderCircle, Upload, X } from 'lucide-react';
import { formatSize } from '@/lib/api';

/** Shared keyboard-accessible picker and drop target for build resources. */
export function ResourceUpload({ id, extension, title, file, busy, replacement, onChoose, onClear, onUpload }: {
  id: string;
  extension: '.jar' | '.zip';
  title: string;
  file: File | null;
  busy: boolean;
  replacement: boolean;
  onChoose: (file?: File) => void;
  onClear: () => void;
  onUpload: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div className={`upload-panel resource-upload ${dragging && !busy ? 'dragging' : ''}`} aria-busy={busy}
    onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) onChoose(event.dataTransfer.files[0]); }}>
    <input hidden id={id} ref={input} type="file" accept={extension} disabled={busy} tabIndex={-1} aria-label={title}
      onChange={event => { onChoose(event.target.files?.[0]); event.target.value = ''; }} />
    {file ? <div className="resource-selection">
      <span className="upload-icon"><FileArchive size={22} aria-hidden="true" /></span>
      <div className="resource-file" role="status"><strong>{file.name}</strong><small>{formatSize(file.size)}</small></div>
      <button className="icon-button" disabled={busy} aria-label="Отменить выбор файла" title="Отменить выбор" onClick={onClear}><X size={18} /></button>
      {replacement && <p className="replacement-note">{extension === '.jar' ? 'Мод с таким именем будет заменён.' : 'Текущий набор конфигов будет полностью заменён.'}</p>}
      <button className="button primary resource-submit" disabled={busy} onClick={onUpload}>
        {busy ? <LoaderCircle size={17} className="spinning" aria-hidden="true" /> : <Upload size={17} aria-hidden="true" />}
        {busy ? 'Загрузка…' : replacement ? 'Заменить и загрузить' : extension === '.jar' ? 'Загрузить мод' : 'Загрузить конфиги'}
      </button>
    </div> : <button type="button" className="dropzone resource-picker" disabled={busy} onClick={() => input.current?.click()} aria-describedby={`${id}-hint`}>
      <span className="upload-icon"><Upload size={22} aria-hidden="true" /></span>
      <span className="resource-picker-copy"><strong>{dragging ? 'Отпусти файл для добавления' : title}</strong><span>Перетащи файл или <span className="picker-link">выбери на компьютере</span></span><small id={`${id}-hint`}>{extension.toUpperCase()} · до 500 МБ</small></span>
    </button>}
  </div>;
}
