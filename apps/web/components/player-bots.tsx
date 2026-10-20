import Link from "next/link";
import { ArrowRight, ArrowUpRight, Construction, Send } from "lucide-react";
import { telegramBot } from "@/lib/player-config";

export function PlayerBots() {
  return (
    <section className="player-bots" aria-labelledby="player-bots-title">
      <div className="player-section-heading">
        <p className="player-eyebrow">АККАУНТ ВСЕГДА ПОД РУКОЙ</p>
        <h2 id="player-bots-title">Твои помощники за пределами игры</h2>
        <p>Вход, профиль и сессии — через бота. Начни с Telegram.</p>
      </div>
      <div className="player-bot-grid">
        <article className="player-bot-card">
          <div className="player-bot-card-top"><Send size={24} aria-hidden="true" /><span className="player-status"><span /> Доступен</span></div>
          <h3>Telegram</h3>
          <a className="player-bot-handle" href={telegramBot.url}>{telegramBot.handle} <ArrowUpRight size={16} aria-hidden="true" /></a>
          <p>Создай аккаунт или привяжи существующий по коду из лаунчера. После входа здесь можно менять ник, email и пароль, управлять сессиями.</p>
          <Link className="player-text-link" href="/play/telegram">Как войти через бота <ArrowRight size={18} aria-hidden="true" /></Link>
        </article>
        <article className="player-bot-card player-bot-development">
          <div className="player-bot-card-top"><Construction size={24} aria-hidden="true" /><span className="player-status player-status-development">В разработке</span></div>
          <h3>Discord</h3>
          <div className="player-workbench" aria-hidden="true"><span /><span /><span /><i /></div>
          <p>Бот ещё в мастерской. Готовим ещё один способ быть ближе к своему аккаунту. Пока для входа и управления профилем используй Telegram.</p>
          <span className="player-development-note">Подключение пока недоступно</span>
        </article>
      </div>
    </section>
  );
}
