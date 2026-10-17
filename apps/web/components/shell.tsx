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
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { Notice } from "./ui";

const links = [
  { href: "/", label: "Сборка", icon: Box },
  { href: "/mods", label: "Моды и конфиги", icon: Blocks },
  { href: "/players", label: "Игроки", icon: Users },
  { href: "/logs", label: "Логи", icon: ScrollText },
  { href: "/profile", label: "Мой профиль", icon: UserRound },
];
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/api/logout", { method: "POST" });
      window.location.assign("/login");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
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
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
        />
      )}
      <aside id="sidebar" className={`sidebar ${open ? "is-open" : ""}`}>
        <Brand />
        <span className="nav-caption">Управление сервером</span>
        <nav aria-label="Основная навигация">
          {links.filter(({ href }) => user.role === 'admin' || href === '/profile').map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`nav-link ${pathname === href || (href !== '/' && pathname.startsWith(href + '/')) ? "active" : ""}`}
              aria-current={pathname === href || (href !== '/' && pathname.startsWith(href + '/')) ? "page" : undefined}
            >
              <Icon size={19} />
              {label}
              {pathname === href && <span className="nav-marker" />}
            </Link>
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
          <div className="account">
            <span className="avatar">
              {user.login.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{user.login}</strong>
              <small>{user.role === 'admin' ? 'Админ' : 'Игрок'}</small>
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
      <main className="main-content">
        <div className="topbar">
          <span>Рабочее пространство</span>
          <Link href="/profile">
            <UserRound size={16} />
            {user.nickname || user.login}
          </Link>
        </div>
        <div className="page-content">
          <Notice message={error} />
          {children}
        </div>
        <footer className="page-footer">
          <span>Minecraft Launcher</span>
          <span>Всё для следующего приключения.</span>
        </footer>
      </main>
    </div>
  );
}
