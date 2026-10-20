import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";

export default async function PlayerHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <main id="player-main" className="player-home">
      <div className="player-home-copy">
        <p className="player-eyebrow"><span /> MINECRAFT · NEVERMORELAND</p>
        <h1>Твоя история<br />начинается<br /><em>здесь.</em></h1>
        <p className="player-intro">Мир, в который хочется возвращаться.<br />Седлай коня — навстречу приключениям.</p>
        <div className="player-home-actions">
          <a className="player-button player-button-primary" href="/play/download">
            <Download size={20} aria-hidden="true" /> Скачать для Windows
          </a>
          <Link className="player-button player-button-secondary" href="/play/how-to-play">
            Как начать играть <ArrowRight size={19} aria-hidden="true" />
          </Link>
        </div>
        <p className="player-download-note">Windows x64 <span>·</span> ZIP-архив</p>
        {params.download === "unavailable" && (
          <p className="player-download-error" role="status">
            Лаунчер пока недоступен для скачивания. Попробуй немного позже.
          </p>
        )}
      </div>
    </main>
  );
}
