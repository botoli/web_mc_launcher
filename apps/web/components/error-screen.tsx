"use client";

import { errorPages, errorPageCSS } from "../../shared/error-pages";

type ErrorCode = keyof typeof errorPages;

export function ErrorScreen({ code = 500, retry }: { code?: ErrorCode; retry?: () => void }) {
  const page = errorPages[code];
  return (
    <main className="error-screen">
      <style>{errorPageCSS}</style>
      <div className="error-screen__content">
        <span className="error-screen__brand">MINECRAFT LAUNCHER</span>
        <span className="error-screen__code">{code}</span>
        <h1>{page.title}</h1>
        <p className="error-screen__description">{page.description}</p>
        <p className="error-screen__hint">{page.hint}</p>
        <div className="error-screen__actions">
          {code !== 404 && (
            <button className="error-screen__button error-screen__button--primary" type="button"
              onClick={retry ?? (() => window.location.reload())}>
              Попробовать ещё раз
            </button>
          )}
          <a className={`error-screen__button${code === 404 ? " error-screen__button--primary" : ""}`} href="/">
            На главную
          </a>
        </div>
      </div>
    </main>
  );
}
