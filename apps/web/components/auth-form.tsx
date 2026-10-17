"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { api, errorMessage, json } from "@/lib/api";
import { Field, Notice } from "./ui";

export function AuthForm({
  register = false,
  redirectTo = "/profile",
  registered = false,
  initialError = "",
}: {
  register?: boolean;
  redirectTo?: string;
  registered?: boolean;
  initialError?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState(initialError);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    const body = {
      login: String(values.get("login")).trim(),
      password: String(values.get("password")),
      email: String(values.get("email") || "").trim(),
      nickname: String(values.get("nickname") || "").trim(),
    };
    try {
      await api(register ? "/api/register" : "/api/auth", json("POST", body));
      if (register) {
        setCreated(true);
        setBusy(false);
      } else {
        const requested = redirectTo;
        // Redirects stay on this origin; a full navigation picks up the new cookie.
        const destination = new URL(requested, window.location.origin);
        window.location.assign(
          destination.origin === window.location.origin
            ? destination.pathname + destination.search
            : "/profile",
        );
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  if (created)
    return (
      <div className="registration-success">
        <span className="round-icon">
          <ArrowRight size={25} />
        </span>
        <h1>Всё готово к игре</h1>
        <p>Аккаунт создан. Войди с новым логином и паролем.</p>
        <Link href="/login?registered=1" className="button primary full-width">
          Перейти ко входу <ArrowRight size={18} />
        </Link>
      </div>
    );
  return (
    <>
      <h1>{register ? "Начни своё приключение" : "С возвращением"}</h1>
      <p className="auth-description">
        {register
          ? "Создай аккаунт, чтобы присоединиться к своему миру."
          : "Войди в аккаунт лаунчера. Твой мир уже ждёт."}
      </p>
      <Notice message={error} />
      {!register && registered && (
        <Notice
          kind="success"
          message="Аккаунт создан. Введите логин и пароль."
        />
      )}
      <form
        method="post"
        action={register ? "/api/web-auth/register" : "/api/web-auth/login"}
        onSubmit={submit}
      >
        <input type="hidden" name="redirect" value={redirectTo} />
        <fieldset className="form-fieldset" disabled={busy}>
          <Field
            label="Логин"
            hint={register ? "От 3 до 32 символов." : undefined}
          >
            <input
              id="login"
              name="login"
              required
              minLength={3}
              maxLength={register ? 32 : undefined}
              autoComplete="username"
              placeholder={register ? "Придумай логин" : "Твой логин"}
            />
          </Field>
          {register && (
            <>
              <Field
                label="Игровой никнейм"
                hint="Необязательно. Можно изменить в профиле."
              >
                <input
                  id="nickname"
                  name="nickname"
                  maxLength={16}
                  autoComplete="nickname"
                  placeholder="Имя в игре"
                />
              </Field>
              <Field label="Email" hint="Необязательно.">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.ru"
                />
              </Field>
            </>
          )}
          <Field
            label="Пароль"
            inputId="password"
            hint={register ? "Не менее 4 символов." : undefined}
          >
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                required
                minLength={4}
                autoComplete={register ? "new-password" : "current-password"}
                placeholder={register ? "Придумай пароль" : "Твой пароль"}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          <button className="button primary full-width" type="submit">
            {busy
              ? register
                ? "Создаём аккаунт…"
                : "Входим…"
              : register
                ? "Создать аккаунт"
                : "Войти"}
            <ArrowRight size={18} />
          </button>
        </fieldset>
      </form>
      <p className="auth-switch">
        {register ? "Уже есть аккаунт?" : "Первый раз здесь?"}{" "}
        <Link href={register ? "/login" : "/register"}>
          {register ? "Войти" : "Создать аккаунт"}
        </Link>
      </p>
    </>
  );
}
