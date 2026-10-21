"use client";

import { AlertCircle, Check, ShieldCheck, X } from "lucide-react";
import { cloneElement, useEffect, useRef } from "react";
import type { PlayerStatus } from "@/lib/types";

export function Notice({
  message,
  kind = "error",
}: {
  message: string;
  kind?: "error" | "success";
}) {
  if (!message) return null;
  const Icon = kind === "success" ? Check : AlertCircle;
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon size={18} />
      <span>{message}</span>
    </div>
  );
}
export function Field({
  label,
  hint,
  inputId,
  children,
}: {
  label: string;
  hint?: string;
  inputId?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = inputId || children.props.id;
  const hintId = hint && id ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": [children.props["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined,
      })}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function StatusBadge({ status }: { status: PlayerStatus }) {
  const labels = {
    confirmed: "Подтверждён",
    pending: "Ожидает",
    banned: "Заблокирован",
  };
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {labels[status] || status}
    </span>
  );
}
export function RoleBadge({ role }: { role: 'admin' | 'player' }) {
  return role === 'admin'
    ? <span className="badge role-admin"><ShieldCheck size={13} aria-hidden="true" />Админ</span>
    : <span className="player-role-label">Игрок</span>;
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function ConfirmDialog({
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (name) ref.current?.showModal();
    else ref.current?.close();
  }, [name]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">Удалить мод?</h2>
        <button
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={20} />
        </button>
      </div>
      <p>
        <strong className="break-word">{name}</strong> будет удалён из сборки.
        Клиенты получат изменения при следующей синхронизации.
      </p>
      <div className="actions">
        <button
          className="button secondary"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          Оставить мод
        </button>
        <button className="button danger" disabled={busy} onClick={onConfirm}>
          {busy ? "Удаление…" : "Удалить мод"}
        </button>
      </div>
    </dialog>
  );
}
