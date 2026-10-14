"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>Не удалось загрузить страницу</h1>
      <p>Проверьте соединение и попробуйте ещё раз.</p>
      <div className="actions">
        <button className="button primary" onClick={reset}>
          Повторить
        </button>
        <Link className="button secondary" href="/">
          На главную
        </Link>
      </div>
    </main>
  );
}
