'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type SelectOption = { value: string; label: string; description?: string; search?: string; group?: string };

// DropdownMenu handles commands; this combobox keeps multiple filter choices open.
export function MultiSelect({ label, placeholder, searchPlaceholder, options, value, onChange, loading, error, onRetry }: {
  label: string; placeholder: string; searchPlaceholder?: string; options: SelectOption[];
  value: string[]; onChange: (value: string[]) => void; loading?: boolean; error?: string; onRetry?: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 360 });
  const available = useMemo(() => [...options, ...value.filter(key => !options.some(option => option.value === key)).map(key => ({ value: key, label: key }))], [options, value]);
  const filtered = available.filter(option => `${option.label} ${option.description || ''} ${option.search || ''}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  const summary = value.length === 1 ? available.find(option => option.value === value[0])?.label : value.length ? `Выбрано: ${value.length}` : placeholder;
  function close(restore = false) { setOpen(false); if (restore) trigger.current?.focus(); }
  useLayoutEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const positionPopup = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const below = window.innerHeight - anchor.bottom - 14;
      const above = anchor.top - 14;
      const height = Math.min(360, Math.max(below, above));
      const up = below < 220 && above > below;
      const width = popup.current?.getBoundingClientRect().width || 300;
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
        top: up ? Math.max(8, anchor.top - Math.min(popup.current?.scrollHeight || height, height) - 6) : anchor.bottom + 6,
        maxHeight: Math.max(150, up ? above : below) });
    };
    positionPopup();
    const outside = (event: Event) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', positionPopup);
    window.addEventListener('scroll', positionPopup, true);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', positionPopup); window.removeEventListener('scroll', positionPopup, true);
    };
  }, [open]);
  function toggle(key: string) { onChange(value.includes(key) ? value.filter(item => item !== key) : [...value, key]); }
  return <>
    <button ref={trigger} type="button" className={`multi-select-trigger${value.length ? ' has-value' : ''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={value.length ? available.filter(option => value.includes(option.value)).map(option => option.label).join(', ') : placeholder}
      onClick={() => { setSearch(''); setOpen(current => !current); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSearch(''); setOpen(true); }
        if (event.key === 'Escape') close(true);
      }}><span>{summary}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label={label} className="dropdown-menu multi-select-popup" style={position}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (!(event.target instanceof HTMLInputElement) || event.key.startsWith('Arrow'))) {
          event.preventDefault();
          const nodes = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
          const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : current < 0 ? (event.key === 'ArrowUp' ? nodes.length - 1 : 0) : (current + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
          nodes[next]?.focus();
        }
        if (event.key === 'Enter' && event.target === searchInput.current) { event.preventDefault(); if (filtered[0]) toggle(filtered[0].value); }
      }}>
      <div className="multi-select-search"><Search size={15} aria-hidden="true" /><input ref={searchInput} aria-label={searchPlaceholder || `Поиск: ${label}`} placeholder={searchPlaceholder || 'Поиск…'} value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div className="multi-select-summary"><span aria-live="polite">Выбрано: {value.length}</span><button type="button" disabled={!value.length} onClick={() => { onChange([]); searchInput.current?.focus(); }}>Очистить</button></div>
      {error ? <div className="multi-select-state" role="alert">{error}<button type="button" className="button secondary" onClick={onRetry}>Повторить</button></div>
        : loading ? <p className="multi-select-state" role="status">Загрузка…</p>
          : <div role="listbox" aria-label={label} aria-multiselectable="true" className="multi-select-options">
            {filtered.map((option, index) => <FragmentOption key={option.value} option={option} showGroup={Boolean(option.group && option.group !== filtered[index - 1]?.group)} selected={value.includes(option.value)} toggle={toggle} />)}
            {!filtered.length && <p className="multi-select-state">Ничего не найдено</p>}
          </div>}
    </div>, document.body)}
  </>;
}

function FragmentOption({ option, showGroup, selected, toggle }: { option: SelectOption; showGroup: boolean; selected: boolean; toggle: (value: string) => void }) {
  return <>{showGroup && <div className="multi-select-group" role="presentation">{option.group}</div>}
    <button type="button" role="option" aria-selected={selected} className={`dropdown-item multi-select-option${selected ? ' selected' : ''}`} onClick={() => toggle(option.value)}>
      <span className="multi-select-check" aria-hidden="true">{selected && <Check size={13} />}</span><span className="multi-select-option-text"><span title={option.label}>{option.label}</span>{option.description && <small title={option.description}>{option.description}</small>}</span>
    </button></>;
}
