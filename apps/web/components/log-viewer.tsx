"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { api, errorMessage, formatDateTime } from "@/lib/api";
import type { EventsPage, PlayerEvent } from "@/lib/types";
import { MultiSelect, type SelectOption } from "./multi-select";
import { DropdownMenu } from "./dropdown-menu";

const actions: Record<string, string> = {
  login: "Вход",
  logout: "Выход",
  registered: "Регистрация",
  nickname_changed: "Смена никнейма",
  telegram_linked: "Привязка Telegram",
  telegram_unlinked: "Отвязка Telegram",
  discord_linked: "Привязка Discord",
  discord_unlinked: "Отвязка Discord",
  connect: "Подключение",
  disconnect: "Отключение",
  connection_denied: "Подключение отклонено",
  ban: "Бан в лаунчере",
  unban: "Разбан",
  freeze: "Заморозка",
  unfreeze: "Снятие заморозки",
  status_changed: "Изменение статуса",
  role_changed: "Изменение роли",
  email_changed: "Смена email",
  password_changed: "Смена пароля",
  password_check: "Проверка пароля",
  telegram_username_changed: "Смена Telegram-юзернейма",
  sessions_revoked: "Завершение сессий",
  mod_added: "Добавление мода",
  mod_replaced: "Замена мода",
  mod_deleted: "Удаление мода",
  configs_added: "Добавление конфигов",
  configs_replaced: "Замена конфигов",
  build_config_changed: "Изменение конфигурации сборки",
};
const sources: Record<string, string> = {
  website: "Сайт",
  launcher: "Лаунчер",
  telegram: "Telegram",
  discord: "Discord",
  minecraft: "Minecraft",
};
const methods: Record<string, string> = {
  password: "Пароль",
  token: "Токен",
  cookie: "Сессия сайта",
  bot: "Бот",
};
const outcomes: Record<string, string> = {
  success: "Успешно",
  failed: "Ошибка",
  denied: "Отклонено",
};

const targetLabels: Record<string, string> = {
  website: "Сайт",
  launcher: "Лаунчер",
  telegram: "Telegram",
  discord: "Discord",
  minecraft: "Minecraft",
  server_build: "Сборка сервера",
  admin: "Админ",
  player: "Игрок",
  confirmed: "Подтверждён",
  pending: "Ожидает",
  banned: "Заблокирован",
};
function targetLabel(action: string, target: string) {
  if (action === "freeze" && Number.isFinite(Date.parse(target)))
    return `До ${formatDateTime(Date.parse(target))}`;
  return targetLabels[target] || target;
}

const categories: Record<string, string> = {
  auth: "Авторизация",
  connections: "Подключения Minecraft",
  account: "Аккаунт и подключения",
  moderation: "Модерация",
  administration: "Моды и конфигурации",
};
type LogPlayer = {
  id: string;
  login: string;
  nickname: string;
  telegramId?: string | null;
  discordId?: string | null;
  telegramUsername?: string;
  discordUsername?: string;
  search?: string;
};
type LogOptions = {
  players: LogPlayer[];
  actions: { value: string; category: string }[];
};
type Filters = {
  players: string[];
  actions: string[];
  sources: string[];
  outcome: string;
  from: string;
  to: string;
  page: number;
  limit: number;
  sort: "date" | "player" | "outcome";
  direction: "asc" | "desc";
};
const defaults: Filters = {
  players: [],
  actions: [],
  sources: [],
  outcome: "",
  from: "",
  to: "",
  page: 1,
  limit: 25,
  sort: "date",
  direction: "desc",
};
const time = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Moscow",
});
const date = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Moscow",
});
function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const list = (key: string) => [
    ...new Set(
      params
        .getAll(key)
        .flatMap((value) => value.split(","))
        .filter(Boolean),
    ),
  ];
  const validDate = (key: string) => {
    const value = params.get(key) || "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value))
      ? value
      : "";
  };
  const page = Number(params.get("page"));
  return {
    players: list("players"),
    actions: list("actions"),
    sources: list("source"),
    outcome: Object.hasOwn(outcomes, params.get("outcome") || "")
      ? params.get("outcome")!
      : "",
    from: validDate("from"),
    to: validDate("to"),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    limit: [25, 50, 100].includes(Number(params.get("limit")))
      ? Number(params.get("limit"))
      : 25,
    sort: ["date", "player", "outcome"].includes(params.get("sort") || "")
      ? (params.get("sort") as Filters["sort"])
      : "date",
    direction: params.get("direction") === "asc" ? "asc" : "desc",
  };
}
function writeFilters(filters: Filters, replace = false) {
  const url = new URL(window.location.href);
  for (const key of [
    "players",
    "actions",
    "source",
    "outcome",
    "from",
    "to",
    "page",
    "limit",
    "sort",
    "direction",
  ])
    url.searchParams.delete(key);
  for (const key of ["players", "actions", "sources"] as const)
    for (const value of filters[key])
      url.searchParams.append(key === "sources" ? "source" : key, value);
  for (const key of [
    "outcome",
    "from",
    "to",
    "page",
    "limit",
    "sort",
    "direction",
  ] as const)
    if (filters[key] !== defaults[key])
      url.searchParams.set(key, String(filters[key]));
  if (url.href !== window.location.href)
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
}
function isoMoscowDay(at: number) {
  return new Date(at + 3 * 3_600_000).toISOString().slice(0, 10);
}

function EventDetails({ event }: { event: PlayerEvent }) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  return (
    <div className="event-details-content">
      <dl className="event-details">
        {[
          ["ID события", event.id],
          ["ID игрока", event.login || "—"],
          ["Timestamp", new Date(event.at).toISOString()],
          ["Инициатор", event.actor || "—"],
          ["Источник", sources[event.source] || event.source],
          ["ID источника / бот", event.bot || "—"],
          [
            "Действие",
            `${actions[event.action] || "Действие"} (${event.action})`,
          ],
          ["Результат", outcomes[event.outcome] || event.outcome],
          ["Способ", methods[event.method] || event.method || "—"],
          ["Объект", targetLabel(event.action, event.target) || "—"],
          ["IP", event.ip || "—"],
          ["Причина / ошибка", event.reason || "—"],
          ["Telegram ID", event.telegramId || "—"],
          ["Discord ID", event.discordId || "—"],
          ["Telegram username", event.telegramUsername ? `@${event.telegramUsername}` : "—"],
          ["Discord username", event.discordUsername || "—"],
          ["User agent", event.userAgent || "Не передано"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="event-copy">
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(event.id);
              setCopied(true);
              setCopyError("");
            } catch {
              setCopyError(
                "Не удалось скопировать ID. Его можно выделить в подробностях.",
              );
            }
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "ID скопирован" : "Скопировать ID события"}
        </button>
        <span role="status">{copyError}</span>
      </div>
    </div>
  );
}

export function LogViewer({
  login,
  category = "",
}: {
  login?: string;
  category?: string;
}) {
  const tableRegion = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Filters>(defaults),
    [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<EventsPage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<LogOptions>({
      players: [],
      actions: [],
    }),
    [optionsLoading, setOptionsLoading] = useState(true),
    [optionsError, setOptionsError] = useState("");
  const [optionsRefresh, setOptionsRefresh] = useState(0);
  useEffect(() => {
    const region = tableRegion.current, scrollPage = region?.closest('.page-content');
    if (!region || !scrollPage) return;
    // Keep the header pinned to the page while the table can scroll horizontally.
    const pinHeader = () => {
      const bounds = region.getBoundingClientRect();
      const offset = Math.max(0, Math.min(scrollPage.getBoundingClientRect().top - bounds.top, bounds.height - 43));
      region.style.setProperty('--log-header-offset', `${offset}px`);
    };
    const observer = new ResizeObserver(pinHeader);
    observer.observe(region); scrollPage.addEventListener('scroll', pinHeader, { passive: true });
    window.addEventListener('resize', pinHeader); pinHeader();
    return () => { observer.disconnect(); scrollPage.removeEventListener('scroll', pinHeader); window.removeEventListener('resize', pinHeader); };
  }, []);
  useEffect(() => {
    if (!login) setFilters(readFilters());
    setReady(true);
    const restore = () => {
      if (!login) {
        setFilters(readFilters());
        setExpanded(null);
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [login]);
  function change(patch: Partial<Filters>, replace = false) {
    const next = { ...filters, page: 1, ...patch };
    if (!login) writeFilters(next, replace);
    setFilters(next);
    setExpanded(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError("");
    api<LogOptions>("/api/admin/logs/options", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch((err) => {
        if (!controller.signal.aborted) setOptionsError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRefresh, refresh]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(filters.page),
      limit: String(filters.limit),
      sort: filters.sort,
      direction: filters.direction,
    });
    if (login) params.set("login", login);
    if (category) params.set("category", category);
    for (const key of ["players", "actions", "sources"] as const)
      for (const value of filters[key])
        params.append(key === "sources" ? "source" : key, value);
    if (filters.outcome) params.set("outcome", filters.outcome);
    if (filters.from) params.set("from", `${filters.from}T00:00:00+03:00`);
    if (filters.to) params.set("to", `${filters.to}T23:59:59.999+03:00`);
    api<EventsPage>(`/api/admin/logs?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        if (result.page !== filters.page) {
          const next = { ...filters, page: result.page };
          setFilters(next);
          if (!login) writeFilters(next, true);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, ready, category, login, refresh]);
  function reset() {
    change(defaults);
  }
  const hasFilters = Boolean(
    filters.players.length ||
    filters.actions.length ||
    filters.sources.length ||
    filters.outcome ||
    filters.from ||
    filters.to,
  );
  const playerOptions: SelectOption[] = options.players.map((player) => ({
    value: player.id,
    label:
      player.nickname ||
      player.login ||
      player.telegramUsername ||
      player.discordUsername ||
      "Аккаунт не привязан",
    description: player.login || player.id,
    search: [
      player.login,
      player.nickname,
      player.telegramId,
      player.discordId,
      player.telegramUsername,
      player.discordUsername,
      player.search,
    ]
      .filter(Boolean)
      .join(" "),
  }));
  const actionOptions = options.actions
    .filter((action) => !category || action.category === category)
    .map((action) => ({
      value: action.value,
      label: actions[action.value] || "Другое действие",
      group: categories[action.category] || action.category,
      search: action.value,
    }));
  const sortHeader = (key: Filters["sort"], label: string) => {
    const Icon =
      filters.sort === key
        ? filters.direction === "asc"
          ? ArrowUp
          : ArrowDown
        : ArrowUpDown;
    return (
      <th
        scope="col"
        aria-sort={
          filters.sort === key
            ? filters.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <button
          className="table-sort"
          onClick={() =>
            change({
              sort: key,
              direction:
                filters.sort === key && filters.direction === "desc"
                  ? "asc"
                  : "desc",
            })
          }
        >
          {label}
          <Icon size={12} />
        </button>
      </th>
    );
  };
  function quickRange(days: number, yesterday = false) {
    const end = Date.now() - (yesterday ? 86_400_000 : 0);
    change({
      from: isoMoscowDay(end - (days - 1) * 86_400_000),
      to: isoMoscowDay(end),
    });
  }
  const pages = Math.max(1, Math.ceil((data?.total || 0) / filters.limit));
  return (
    <section className="panel logs-panel" aria-label="Логи игроков">
      <div className={`log-filters${login ? " log-filters-player" : ""}`}>
        {!login && (
          <div className="log-player-filter">
            <MultiSelect
              label="Игроки"
              placeholder="Выберите игроков или ID"
              searchPlaceholder="Поиск по игроку или ID..."
              options={playerOptions}
              value={filters.players}
              onChange={(players) => change({ players })}
              loading={optionsLoading}
              error={optionsError}
              onRetry={() => setOptionsRefresh((value) => value + 1)}
            />
          </div>
        )}
        <MultiSelect
          label="Действие"
          placeholder="Все действия"
          searchPlaceholder="Поиск действия..."
          options={actionOptions}
          value={filters.actions}
          onChange={(actions) => change({ actions })}
          loading={optionsLoading}
          error={optionsError}
          onRetry={() => setOptionsRefresh((value) => value + 1)}
        />
        <MultiSelect
          label="Источник"
          placeholder="Все источники"
          options={Object.entries(sources).map(([value, label]) => ({
            value,
            label,
          }))}
          value={filters.sources}
          onChange={(sources) => change({ sources })}
        />
        <select
          aria-label="Результат события"
          value={filters.outcome}
          onChange={(event) => change({ outcome: event.target.value })}
        >
          <option value="">Любой результат</option>
          {Object.entries(outcomes).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="log-date-range">
          <label className="date-filter">
            <span>С даты</span>
            <input
              type="date"
              aria-label="С даты"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => change({ from: event.target.value })}
            />
          </label>
          <label className="date-filter">
            <span>По дату</span>
            <input
              type="date"
              aria-label="По дату"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => change({ to: event.target.value })}
            />
          </label>
          <DropdownMenu
            label="Быстрый период"
            className="icon-button log-quick-range"
            items={[
              { label: "Сегодня", onSelect: () => quickRange(1) },
              { label: "Вчера", onSelect: () => quickRange(1, true) },
              { label: "Последние 7 дней", onSelect: () => quickRange(7) },
              { label: "Последние 30 дней", onSelect: () => quickRange(30) },
            ]}
          >
            <CalendarDays size={16} />
          </DropdownMenu>
        </div>
        <div className="log-filter-buttons">
          <button className="button secondary" onClick={reset}>
            Сбросить
          </button>
          <button
            className="button primary"
            aria-label="Обновить логи"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={14} />
            Обновить
          </button>
        </div>
      </div>
      <div className="log-meta">
        <span role="status">
          {loading
            ? "Загрузка событий…"
            : error
              ? "Данные недоступны"
              : `Найдено событий: ${data?.total || 0}`}
        </span>
        <span>Время — Москва (UTC+3)</span>
      </div>
      <div
        ref={tableRegion}
        className="table-scroll log-table-scroll"
        role="region"
        tabIndex={0}
        aria-label="Журнал действий"
        aria-busy={loading}
      >
        <table className="logs-table">
          <colgroup>
            {[
              "time",
              "player",
              "contact",
              "action",
              "source",
              "target",
              "ip",
              "outcome",
              "details",
            ].map((name) => (
              <col key={name} className={`log-col-${name}`} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {sortHeader("date", "Дата и время")}
              {sortHeader("player", "Игрок")}
              <th scope="col" className="log-contact">
                Контакт
              </th>
              <th scope="col">Действие</th>
              <th scope="col">Источник</th>
              <th scope="col">Объект</th>
              <th scope="col" className="log-ip">
                IP
              </th>
              {sortHeader("outcome", "Результат")}
              <th scope="col" className="log-details-cell">
                <span className="sr-only">Подробности</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: data ? Math.max(1, data.items.length) : filters.limit }, (_, index) => (
                <tr key={index} className="event-skeleton" aria-hidden="true">
                  {Array.from({ length: 9 }, (_, cell) => (
                    <td
                      key={cell}
                      className={
                        cell === 2 ? "log-contact" : cell === 6 ? "log-ip" : ""
                      }
                    >
                      <span className="skeleton" />
                      {(cell === 0 || cell === 1) && (
                        <span className="skeleton event-skeleton-small" />
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={9}>
                  <div className="log-state" role="alert">
                    <AlertCircle size={24} />
                    <h3>Не удалось загрузить логи</h3>
                    <p>{error}</p>
                    <button
                      className="button secondary"
                      onClick={() => setRefresh((value) => value + 1)}
                    >
                      Повторить
                    </button>
                  </div>
                </td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={9}>
                  <div className="log-state">
                    <ScrollText size={24} />
                    <h3>
                      {hasFilters
                        ? "По выбранным фильтрам событий не найдено"
                        : "Событий пока нет"}
                    </h3>
                    {hasFilters && (
                      <button className="button secondary" onClick={reset}>
                        Сбросить фильтры
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              data.items.map((event) => (
                <Fragment key={event.id}>
                  <tr
                    className={`event-row${expanded === event.id ? " event-expanded" : ""}`}
                  >
                    <td className="event-time">
                      <time dateTime={new Date(event.at).toISOString()}>
                        {time.format(event.at)}
                      </time>
                      <small>{date.format(event.at)}</small>
                    </td>
                    <td>
                      {event.login ? (
                        <Link
                          className="event-player"
                          href={`/players/${encodeURIComponent(event.login)}`}
                          title={event.nickname || event.login}
                        >
                          <span>{event.nickname || event.login}</span>
                          <small title={event.login}>{event.login}</small>
                        </Link>
                      ) : (
                        <span
                          className="event-player-unlinked"
                          title="Аккаунт не привязан"
                        >
                          Не привязан
                          <small title={event.telegramId || event.discordId}>
                            {event.telegramId || event.discordId || "—"}
                          </small>
                        </span>
                      )}
                    </td>
                    <td className="event-identities log-contact">
                      <span
                        title={[
                          event.telegramUsername &&
                            `Telegram: @${event.telegramUsername}`,
                          event.discordUsername &&
                            `Discord: ${event.discordUsername}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {event.telegramUsername
                          ? `@${event.telegramUsername}`
                          : event.discordUsername || "—"}
                      </span>
                    </td>
                    <td>
                      <span
                        className="event-action"
                        title={actions[event.action] || "Другое действие"}
                      >
                        {actions[event.action] || "Другое действие"}
                      </span>
                    </td>
                    <td>
                      <span className={`source-badge source-${event.source}`}>
                        {sources[event.source] || "Другой источник"}
                      </span>
                      {event.bot && (
                        <small className="event-detail" title={event.bot}>
                          {event.bot}
                        </small>
                      )}
                    </td>
                    <td className="event-target">
                      <span title={targetLabel(event.action, event.target)}>
                        {targetLabel(event.action, event.target) || "—"}
                      </span>
                    </td>
                    <td className="log-ip">
                      <code className="event-ip" title={event.ip}>
                        {event.ip || "—"}
                      </code>
                    </td>
                    <td>
                      <span
                        className={`badge event-outcome ${event.outcome === "success" ? "confirmed" : event.outcome === "denied" ? "denied" : "banned"}`}
                      >
                        <span className="status-dot" />
                        {outcomes[event.outcome] || event.outcome}
                      </span>
                    </td>
                    <td className="log-details-cell">
                      <button
                        className="icon-button"
                        aria-label={`Подробности события ${event.id}`}
                        aria-expanded={expanded === event.id}
                        aria-controls={
                          expanded === event.id
                            ? `event-${event.id}`
                            : undefined
                        }
                        onClick={() =>
                          setExpanded((current) =>
                            current === event.id ? null : event.id,
                          )
                        }
                      >
                        <ChevronDown size={16} />
                      </button>
                    </td>
                  </tr>
                  {expanded === event.id && (
                    <tr id={`event-${event.id}`} className="event-details-row">
                      <td colSpan={9}>
                        <EventDetails event={event} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="log-pagination">
        <span className="log-page-total">{data?.total || 0} событий</span>
        <label className="log-page-size">
          Показывать
          <select
            aria-label="Событий на странице"
            value={filters.limit}
            onChange={(event) => change({ limit: Number(event.target.value) })}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="log-page-navigation">
          <button
            className="button secondary"
            disabled={loading || Boolean(error) || filters.page <= 1}
            onClick={() => change({ page: filters.page - 1 })}
          >
            Назад
          </button>
          <span>
            Страница {filters.page} из {pages}
          </span>
          <button
            className="button secondary"
            disabled={loading || Boolean(error) || filters.page >= pages}
            onClick={() => change({ page: filters.page + 1 })}
          >
            Далее
          </button>
        </div>
      </div>
    </section>
  );
}
