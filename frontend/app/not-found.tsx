import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <span className="display-number">404</span>
      <h1>Здесь пока ничего нет</h1>
      <p>Проверьте адрес или вернитесь к своей сборке.</p>
      <Link className="button primary" href="/">
        На главную
      </Link>
    </main>
  );
}
