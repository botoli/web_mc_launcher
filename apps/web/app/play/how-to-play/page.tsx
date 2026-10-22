import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  FolderArchive,
  Globe,
  Info,
  Monitor,
  Play,
  Send,
} from "lucide-react";
import { PlayerBots } from "@/components/player-bots";
import { telegramBot } from "@/lib/player-config";

export const metadata: Metadata = { title: "Как начать играть" };

const steps = [
  {
    number: "01",
    icon: FolderArchive,
    title: "Скачай и распакуй",
    text: (
      <>
        Скачай ZIP-архив для Windows x64 и распакуй его в отдельную папку.
        Запусти <code>Nevermore.exe</code> из этой папки.
      </>
    ),
    detail: (
      <>
        Не запускай лаунчер прямо из архива. Инструкция по установке и замене
        файлов — в <code>README.txt</code>.
      </>
    ),
  },
  {
    number: "02",
    icon: Send,
    title: "Войди через Telegram",
    text: (
      <>
        Нажми «Войти через Telegram» в лаунчере. Открой {telegramBot.handle} по
        ссылке и отправь код с экрана входа. Код состоит из 8 символов и
        действует 5 минут.
      </>
    ),
    detail: (
      <>
        При первом входе бот попросит ник и пароль. Если аккаунт уже привязан к
        Telegram, останется только подтвердить вход кнопкой.
      </>
    ),
  },
  {
    number: "03",
    icon: Play,
    title: "Запусти игру",
    text: (
      <>
        После подтверждения вернись в лаунчер. Выбери настройки памяти, дождись
        установки сборки и нажми «Играть».
      </>
    ),
    detail: (
      <>
        Для первой установки и обновлений понадобится интернет. Не закрывай
        лаунчер, пока сборка устанавливается.
      </>
    ),
  },
];

export default function HowToPlay() {
  return (
    <main id="player-main" className="player-guide">
      <Link href="/play" className="player-back">
        <ArrowLeft size={17} aria-hidden="true" /> На главную
      </Link>
      <div className="player-guide-heading">
        <p className="player-eyebrow">
          <span /> КАК НАЧАТЬ ИГРАТЬ
        </p>
        <h1>
          До приключения —<br />
          <em>всего три шага.</em>
        </h1>
        <p>
          Установи лаунчер, привяжи аккаунт и отправляйся в мир Nevermoreland.
        </p>
        <ul className="player-requirements" aria-label="Что понадобится">
          <li>
            <Monitor size={16} aria-hidden="true" /> Windows x64
          </li>
          <li>
            <Globe size={16} aria-hidden="true" /> Интернет
          </li>
          <li>
            <Send size={16} aria-hidden="true" /> Аккаунт Telegram
          </li>
        </ul>
      </div>
      <div className="player-guide-layout">
        <ol className="player-steps">
          {steps.map(({ number, icon: Icon, title, text, detail }) => (
            <li key={number} className="player-step">
              <span className="player-step-number" aria-hidden="true">
                {number}
              </span>
              <div>
                <h2>
                  <Icon size={24} aria-hidden="true" />
                  {title}
                </h2>
                <p>{text}</p>
                <div className="player-step-detail">
                  <Info size={18} aria-hidden="true" />
                  <p>{detail}</p>
                </div>
                {number === "02" && (
                  <Link className="player-text-link" href="/play/telegram">
                    Подробно о входе и регистрации{" "}
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
        <aside className="player-guide-aside" aria-label="Перед началом игры">
          <div className="player-guide-picture" aria-hidden="true" />
          <div className="player-guide-aside-copy">
            <p className="player-guide-platform">
              <Monitor size={16} aria-hidden="true" /> Windows x64 · ZIP-архив
            </p>
            <h2>
              Первый шаг —<br /> скачать лаунчер.
            </h2>
            <p>Он установит игровую сборку и поможет начать путешествие.</p>
            <a
              className="player-button player-button-primary"
              href="/play/download"
            >
              <Download size={19} aria-hidden="true" /> Скачать для Windows
            </a>
          </div>
        </aside>
      </div>
      <PlayerBots />
      <section className="player-faq" aria-labelledby="player-faq-title">
        <p className="player-eyebrow">ЕСЛИ ОСТАЛИСЬ ВОПРОСЫ</p>
        <h2 id="player-faq-title">Поможем освоиться</h2>
        <details>
          <summary>
            Нужно ли создавать аккаунт на сайте?
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <p>
            Нет. Начни вход в лаунчере и отправь код Telegram-боту. Там можно
            создать новый аккаунт или привязать существующий. Без кода из
            лаунчера регистрация в боте не начинается.
          </p>
        </details>
        <details>
          <summary>
            Ссылка на Telegram не открылась. Что делать?
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <p>
            Открой <a href={telegramBot.url}>{telegramBot.handle}</a> вручную и
            нажми «Запустить», если ещё не общался с ботом. Отправь код из
            лаунчера прямо в чат. Одного открытия ссылки недостаточно — код
            нужно отправить сообщением.
          </p>
        </details>
        <details>
          <summary>
            У меня уже есть аккаунт. Создавать новый?
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <p>
            Нет. После кода укажи прежний игровой ник и действующий пароль. Бот
            предложит «Привязать и войти», сохранив существующий аккаунт. Если
            Telegram уже привязан, вводить ник и пароль повторно не нужно.{" "}
            <Link href="/play/telegram#account-choice">
              Выбрать свой сценарий входа
            </Link>
            .
          </p>
        </details>
        <details>
          <summary>
            Как обновить лаунчер?
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <p>
            Кнопка скачивания на сайте выдаёт последнюю опубликованную версию.
            Перед заменой файлов закрой лаунчер и следуй инструкции README.txt
            из нового архива. Интернет понадобится и для обновления игровой
            сборки.
          </p>
        </details>
        <details>
          <summary>
            Можно играть с телефона или на macOS?
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <p>
            Текущая версия лаунчера предназначена для Windows x64. На телефоне
            можно прочитать инструкцию и подтвердить вход в Telegram, а сам
            лаунчер нужно установить на компьютер с Windows.
          </p>
        </details>
      </section>
    </main>
  );
}
