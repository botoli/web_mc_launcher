"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { PlayerBackdrop } from "./player-backdrop";
import { BlockLoader } from "./block-loader";
import type { PlayerTheme } from "@/lib/player-themes";

const preferenceKey = "nevermoreland-player-theme";
const themes = [
  { value: "halloween", label: "Хеллоуин", icon: Moon },
  { value: "original", label: "Оригинальная тема", icon: Sun },
] as const;

function HorseMark() {
  return (
    <svg width="32" height="36" viewBox="0 0 32 36" fill="currentColor" aria-hidden="true">
      <path d="M9 2h5v4h5V2h4v9h4v5h3v9h-7v-5h-4v5h4v9H5V23h4v-7H5v-5h4V2Zm10 10v4h4v-4h-4Z" />
    </svg>
  );
}

export function PlayerSite({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showLoading, setShowLoading] = useState(false);
  const navigationStarted = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<PlayerTheme | null>(null);
  const [activeTheme, setActiveTheme] = useState<PlayerTheme | null>(null);
  const [themeError, setThemeError] = useState("");

  useEffect(() => { container.current?.scrollTo(0, 0); }, [pathname]);

  useEffect(() => {
    if (!showLoading || pending) return;
    // Keep fast transitions readable without delaying the route request.
    const minimum = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360;
    const timer = window.setTimeout(() => setShowLoading(false), Math.max(0, minimum - (performance.now() - navigationStarted.current)));
    return () => window.clearTimeout(timer);
  }, [pending, showLoading]);

  useEffect(() => {
    let initial: PlayerTheme = "original";
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved === "halloween" || saved === "original") {
        initial = saved;
      } else if (saved === "regular") {
        localStorage.setItem(preferenceKey, "original");
      }
    } catch {
      // The switch still works when browser storage is unavailable.
    }
    setTheme(initial);
  }, []);

  function selectTheme(next: PlayerTheme) {
    setThemeError("");
    setTheme(next);
    try {
      localStorage.setItem(preferenceKey, next);
    } catch {}
  }

  function handleBackgroundError(failed: PlayerTheme) {
    if (failed !== theme) return;
    setTheme(activeTheme);
    setThemeError("Не удалось загрузить оформление. Попробуй выбрать тему ещё раз.");
    try {
      if (activeTheme) localStorage.setItem(preferenceKey, activeTheme);
      else localStorage.removeItem(preferenceKey);
    } catch {}
  }

  return (
    <div ref={container} className="player-site" data-view={pathname === "/play/how-to-play" || pathname === "/play/telegram" ? "guide" : "home"} data-theme={activeTheme || undefined} data-ready={activeTheme !== null}
      onClickCapture={event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
        const link = event.target.closest<HTMLAnchorElement>("a[href]");
        if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
        const next = new URL(link.href, window.location.href);
        if (next.origin !== window.location.origin || !/^\/play(?:\/how-to-play|\/telegram)?\/?$/.test(next.pathname)) return;
        if (next.pathname === window.location.pathname && next.search === window.location.search) return;
        event.preventDefault();
        navigationStarted.current = performance.now();
        setShowLoading(true);
        startTransition(() => router.push(next.pathname + next.search + next.hash));
      }}>
      <a className="player-skip" href="#player-main">К содержимому</a>
      <PlayerBackdrop theme={theme} activeTheme={activeTheme} onReady={setActiveTheme} onError={handleBackgroundError} />
      <div className="player-shade" aria-hidden="true" />
      <header className="player-header" inert={showLoading}>
        <Link className="player-brand" href="/play" aria-label="Nevermoreland — главная">
          <HorseMark />
          <span>NEVERMORELAND</span>
        </Link>
        <div className="player-themes" data-selected={theme || "original"} role="group" aria-label="Оформление сайта" aria-busy={theme !== activeTheme}>
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              className="player-theme"
              onClick={() => selectTheme(value)}
              aria-pressed={theme === value}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </header>
      {themeError && <p className="player-theme-error" role="status">{themeError}</p>}
      <div className="player-content" key={pathname} inert={showLoading} aria-busy={showLoading}>{children}</div>
      <footer className="player-footer" inert={showLoading}>
        <span>Твой мир. Твои лошади. Твоя история.</span>
        <span>MINECRAFT · NEVERMORELAND</span>
      </footer>
      <div className="player-navigation-screen" data-visible={showLoading} aria-hidden={!showLoading}>
        <span className="player-loading-brand" aria-hidden="true"><HorseMark /><span>NEVERMORELAND</span></span><BlockLoader label="Загружаем страницу…" />
      </div>
    </div>
  );
}
