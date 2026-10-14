"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Save,
  Server,
  Blocks,
  Users,
  HardDrive,
  RotateCcw,
} from "lucide-react";
import { api, errorMessage, json } from "@/lib/api";
import type { BuildConfig, ClientInfo, DashboardData } from "@/lib/types";
import { Field, Notice, PageHeading } from "./ui";
import { VoxelScene } from "./voxel-scene";

function formFrom(config: BuildConfig) {
  return {
    version: config.version,
    loader: config.loader,
    loaderVersion: config.loaderVersion,
    javaVersion: String(config.javaVersion),
    minMemory: String(config.minMemory),
    maxMemory: String(config.maxMemory),
    serverIP: config.servers[0]?.address || "",
  };
}
export function BuildDashboard({
  initial,
  client,
}: {
  initial: DashboardData;
  client: ClientInfo;
}) {
  const [saved, setSaved] = useState(initial.buildConfig);
  const [form, setForm] = useState(() => formFrom(saved));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({
    message: "",
    kind: "success" as "error" | "success",
  });
  const [copied, setCopied] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(saved));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [copied]);
  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setNotice({ message: "", kind: "success" });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (Number(form.minMemory) > Number(form.maxMemory)) {
      setNotice({
        message: "Минимальная память не может превышать максимальную.",
        kind: "error",
      });
      return;
    }
    setBusy(true);
    setNotice({ message: "", kind: "success" });
    try {
      const result = await api<{ config: BuildConfig }>(
        "/api/build-config",
        json("POST", form),
      );
      setSaved(result.config);
      setForm(formFrom(result.config));
      setNotice({
        message:
          "Сборка сохранена. Игроки получат настройки при следующем запуске лаунчера.",
        kind: "success",
      });
    } catch (error) {
      setNotice({ message: errorMessage(error), kind: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(saved.servers[0]?.address || "");
      setCopied(true);
    } catch {
      setNotice({
        message:
          "Не удалось скопировать адрес. Выделите и скопируйте его вручную.",
        kind: "error",
      });
    }
  }
  return (
    <>
      <PageHeading
        title="Твоя следующая сборка"
        description="Настрой мир, в который игроки захотят вернуться."
        action={
          <span className="badge confirmed">
            <span className="status-dot" />
            Сервис лаунчера доступен
          </span>
        }
      />
      <section className="build-hero" aria-label="Текущая сборка">
        <div className="hero-content">
          <span className="hero-label">
            <BoxLabel />
            Текущая сборка
          </span>
          <h2>
            Minecraft <span>{saved.version}</span>
          </h2>
          <div className="hero-tags">
            <span>{saved.loader}</span>
            <span>Java {saved.javaVersion}</span>
          </div>
          <button
            className="server-address"
            onClick={copyAddress}
            aria-label="Скопировать адрес игрового сервера"
          >
            <Server size={16} />
            <span>{saved.servers[0]?.address || "Адрес не указан"}</span>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <span className="sr-only" role="status">
            {copied ? "Адрес скопирован" : ""}
          </span>
        </div>
        <VoxelScene />
      </section>
      <div className="stats-strip">
        <Link href="/players">
          <Users size={20} />
          <span>
            <strong>{initial.userCount}</strong> игроков зарегистрировано
          </span>
          <ArrowUpRight size={16} />
        </Link>
        <Link href="/mods">
          <Blocks size={20} />
          <span>
            <strong>{initial.mods.length}</strong> модов в сборке
          </span>
          <ArrowUpRight size={16} />
        </Link>
        <div>
          <HardDrive size={20} />
          <span>
            <strong>
              {(saved.maxMemory / 1024).toLocaleString("ru-RU", {
                maximumFractionDigits: 1,
              })}{" "}
              ГБ
            </strong>{" "}
            максимальная память
          </span>
        </div>
      </div>
      <div className="build-layout">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Настройки сборки</h2>
              <p>Единая конфигурация для всех игроков.</p>
            </div>
            {dirty && <span className="unsaved">Есть изменения</span>}
          </div>
          <form onSubmit={save}>
            <fieldset disabled={busy} className="form-fieldset">
              <div className="form-section">
                <h3>Версия и окружение</h3>
                <div className="form-grid">
                  <Field label="Версия Minecraft">
                    <select
                      id="version"
                      value={form.version}
                      onChange={(e) => update("version", e.target.value)}
                    >
                      {[...new Set([form.version, ...initial.versions])].map(
                        (v) => (
                          <option key={v}>{v}</option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="Загрузчик модов">
                    <select
                      id="loader"
                      value={form.loader}
                      onChange={(e) => update("loader", e.target.value)}
                    >
                      {[...new Set([form.loader, ...initial.loaders])].map(
                        (l) => (
                          <option key={l} value={l}>
                            {(
                              {
                                neoforge: "NeoForge",
                                forge: "Forge",
                                fabric: "Fabric",
                                vanilla: "Vanilla",
                              } as Record<string, string>
                            )[l] || l}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field
                    label="Версия загрузчика"
                    hint={
                      form.loader === "vanilla"
                        ? "Для Vanilla загрузчик не используется."
                        : "Должна подходить к версии Minecraft."
                    }
                  >
                    <input
                      id="loaderVersion"
                      required={form.loader !== "vanilla"}
                      disabled={form.loader === "vanilla"}
                      value={form.loaderVersion}
                      onChange={(e) => update("loaderVersion", e.target.value)}
                      placeholder="Например, 21.1.248"
                    />
                  </Field>
                  <Field label="Версия Java">
                    <input
                      id="javaVersion"
                      type="number"
                      min="8"
                      max="99"
                      required
                      value={form.javaVersion}
                      onChange={(e) => update("javaVersion", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
              <div className="form-section">
                <h3>Память и подключение</h3>
                <div className="form-grid">
                  <Field label="Минимальная память, МБ">
                    <input
                      id="minMemory"
                      type="number"
                      min="512"
                      step="1"
                      required
                      value={form.minMemory}
                      onChange={(e) => update("minMemory", e.target.value)}
                    />
                  </Field>
                  <Field label="Максимальная память, МБ">
                    <input
                      id="maxMemory"
                      type="number"
                      min="512"
                      step="1"
                      required
                      value={form.maxMemory}
                      onChange={(e) => update("maxMemory", e.target.value)}
                    />
                  </Field>
                  <div className="span-two">
                    <Field
                      label="Адрес игрового сервера"
                      hint="IP или домен с портом, например play.example.ru:25565"
                    >
                      <input
                        id="serverIP"
                        required
                        value={form.serverIP}
                        onChange={(e) => update("serverIP", e.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </fieldset>
            <Notice {...notice} />
            <div className="form-footer">
              <span>
                {dirty
                  ? "Изменения ещё не сохранены"
                  : "Все изменения сохранены"}
              </span>
              <div className="actions">
                {dirty && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setForm(formFrom(saved));
                      setNotice({ message: "", kind: "success" });
                    }}
                  >
                    <RotateCcw size={16} />
                    Отменить
                  </button>
                )}
                <button className="button primary" disabled={!dirty || busy}>
                  <Save size={17} />
                  {busy ? "Сохранение…" : "Сохранить сборку"}
                </button>
              </div>
            </div>
          </form>
        </section>
        <aside className="build-aside">
          <section className="sync-note">
            <span className="round-icon">
              <Check size={22} />
            </span>
            <h2>Одна сборка для всех</h2>
            <p>
              После сохранения лаунчер получит новые настройки при следующем
              запуске. Моды синхронизируются с сервером.
            </p>
            <Link href="/mods">
              Управлять модами <ArrowUpRight size={16} />
            </Link>
          </section>
          <section className="panel client-panel">
            <Download size={24} />
            <h2>Лаунчер для игроков</h2>
            <p>
              {client.size > 0
                ? `Версия ${client.version} готова к скачиванию.`
                : "Файл лаунчера пока недоступен."}
            </p>
            {client.size > 0 ? (
              <a className="button secondary full-width" href={client.url}>
                <Download size={16} />
                Скачать лаунчер
              </a>
            ) : (
              <span className="badge neutral">Ожидаем файл</span>
            )}
            <Link className="subtle-link" href="/profile">
              Открыть кабинет игрока <ArrowUpRight size={15} />
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
function BoxLabel() {
  return <Blocks size={16} />;
}
