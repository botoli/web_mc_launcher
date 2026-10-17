'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMenuPresence } from './use-menu-presence';

export type MenuItem = {
  label: string; href?: string; onSelect?: () => void; disabled?: boolean;
  danger?: boolean; separator?: boolean; selected?: boolean;
};

export function DropdownMenu({ label, children, items, className = 'icon-button', disabled, buttonRef, align = 'end' }: {
  label: string; children: ReactNode; items: MenuItem[]; className?: string; disabled?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>; align?: 'start' | 'end';
}) {
  const id = useId();
  const ownRef = useRef<HTMLButtonElement>(null);
  const trigger = buttonRef || ownRef;
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const present = useMenuPresence(open);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const lastOnOpen = useRef(false);
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const popup = menu.current?.getBoundingClientRect();
      if (!anchor || !popup) return;
      const left = align === 'start' ? anchor.left : anchor.right - popup.width;
      const top = anchor.bottom + 6 + popup.height > window.innerHeight - 8 ? anchor.top - popup.height - 6 : anchor.bottom + 6;
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - popup.width - 8)), top: Math.max(8, top) });
    };
    updatePosition();
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)');
    (lastOnOpen.current ? items?.[items.length - 1] : items?.[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, align, trigger]);
  return <>
    <button ref={trigger} type="button" className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => { lastOnOpen.current = false; setOpen(value => !value); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); lastOnOpen.current = event.key === 'ArrowUp'; setOpen(true);
        } else if (event.key === 'Escape') close(true);
      }}>{children}</button>
    {present && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className="dropdown-menu" style={position} data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={!open}
      onKeyDown={event => {
        const nodes = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
        const current = nodes.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === 'Tab') close(true);
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
          nodes[next]?.focus();
        }
      }}>
      {items.map(item => <div key={item.label}>{item.separator && <div className="dropdown-separator" role="separator" />}
        {item.href ? <Link role="menuitem" tabIndex={-1} className={`dropdown-item${item.danger ? ' danger' : ''}`} href={item.href} onClick={() => close()}>{item.label}</Link>
          : <button type="button" role="menuitem" tabIndex={-1} className={`dropdown-item${item.danger ? ' danger' : ''}${item.selected ? ' selected' : ''}`} disabled={item.disabled} onClick={() => { close(true); item.onSelect?.(); }}>{item.label}{item.selected && <span aria-hidden="true">✓</span>}</button>}
      </div>)}
    </div>, document.body)}
  </>;
}
