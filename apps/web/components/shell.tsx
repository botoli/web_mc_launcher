"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  Blocks,
  Users,
  UserRound,
  LogOut,
  ArrowUpRight,
  Menu,
  X,
  ScrollText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { Notice, RoleBadge } from "./ui";
import { BlockLoader } from "./block-loader";
import { useMenuPresence } from "./use-menu-presence";

const links = [
  { href: "/", label: "Сборка", icon: Box },
  { href: "/mods", label: "Моды и конфиги", icon: Blocks },
  { href: "/players", label: "Игроки", icon: Users },
  { href: "/logs", label: "Логи", icon: ScrollText },
  { href: "/profile", label: "Мой профиль", icon: UserRound },
];
function NavigationScreen({ pending }: { pending: boolean }) {
  return pending ? createPortal(<div className="navigation-screen"><BlockLoader label="Загружаем страницу…" /></div>, document.body) : null;
}
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Minecraft Launcher — главная">
      <span className="brand-mark">
        <Box size={25} strokeWidth={1.6} />
      </span>
      <span>
        Minecraft<span className="brand-subtitle">Launcher</span>
      </span>
    </Link>
  );
}
export function Shell({
  user,
  children,
}: {
  user: Profile;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [departing, setDeparting] = useState(false);
  useEffect(() => {
    const restored = () => setDeparting(false);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // Keep the current page usable if an unsaved-changes prompt cancels navigation.
      queueMicrotask(() => { if (event.defaultPrevented) restored(); });
    };
    window.addEventListener('pageshow', restored);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('pageshow', restored);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);
  useEffect(() => setDeparting(false), [pathname]);
  const scrimPresent = useMenuPresence(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function navigate(href: string) {
    setOpen(false);
    setDeparting(true);
    // Paint the loading screen before the browser starts replacing the document.
    requestAnimationFrame(() => requestAnimationFrame(() => window.location.assign(href)));
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/api/logout", { method: "POST" });
      navigate("/login");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <div className="app-shell" inert={departing} aria-hidden={departing || undefined}
      onClickCapture={event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
        const link = event.target.closest<HTMLAnchorElement>('a[href]');
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
        const next = new URL(link.href, window.location.href);
        const page = /^\/(?:mods|logs|profile|login|register)?\/?$/.test(next.pathname) || /^\/players(?:\/[^/]+)?\/?$/.test(next.pathname);
        if (next.origin !== window.location.origin || !page) return;
        if (next.pathname === window.location.pathname && next.search === window.location.search && next.hash) return;
        event.preventDefault();
        navigate(next.href);
      }}>
      <div className="mobile-bar">
        <Brand />
        <button
          className="icon-button"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {scrimPresent && (
        <button
          className="sidebar-scrim"
          data-state={open ? 'open' : 'closed'}
          inert={!open}
          aria-hidden={!open}
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
        />
      )}
      <aside id="sidebar" className={`sidebar ${open ? "is-open" : ""}`}>
        <Brand />
        <span className="nav-caption">Управление сервером</span>
        <nav aria-label="Основная навигация">
          {links.filter(({ href }) => user.role === 'admin' || href === '/profile').map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`nav-link ${pathname === href || (href !== '/' && pathname.startsWith(href + '/')) ? "active" : ""}`}
              aria-current={pathname === href || (href !== '/' && pathname.startsWith(href + '/')) ? "page" : undefined}
            >
              <Icon size={19} />
              {label}
              {pathname === href && <span className="nav-marker" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Blocks size={22} />
            <p>
              Твоя сборка.
              <br />
              <strong>Твои правила.</strong>
            </p>
            <Link href="/profile" onClick={() => setOpen(false)}>
              Кабинет игрока <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="account" data-player-status={user.registrationStatus} data-player-role={user.role}>
            <span className="avatar">
              {user.login.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{user.login}</strong>
              <RoleBadge role={user.role} />
            </div>
            <button
              className="icon-button"
              aria-label="Выйти из аккаунта"
              title="Выйти"
              disabled={busy}
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <NavigationScreen pending={departing} />
      <main className="main-content">
        <div className="topbar">
          <span>Рабочее пространство</span>
          <Link href="/profile">
            <UserRound size={16} />
            {user.nickname || user.login}
          </Link>
        </div>
        <div className="page-content">
          <noscript><p className="notice error">JavaScript отключён. Данные доступны для просмотра; для поиска, фильтров и действий включите JavaScript для этого сайта.</p></noscript>
          <Notice message={error} />
          <div className="page-enter">{children}</div>
        </div>
        <footer className="page-footer">
          <span>Minecraft Launcher</span>
          <span>Всё для следующего приключения.</span>
        </footer>
      </main>
    </div>
  );
}
