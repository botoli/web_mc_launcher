export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = options.body instanceof FormData ? 600_000 : 20_000, ...requestOptions } = options;
  const controller = new AbortController();
  const cancel = () => controller.abort(requestOptions.signal?.reason);
  if (requestOptions.signal?.aborted) cancel();
  else requestOptions.signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...requestOptions,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return null;
    });
    if (!response.ok || !data || data.error) {
      if (response.status === 401 && typeof window !== "undefined") {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(window.location.pathname)}`,
        );
      }
      throw new ApiError(
        response.status === 401
          ? "Сессия завершена. Войдите снова."
          : data?.error || "Не удалось выполнить запрос. Попробуйте ещё раз.",
        response.status,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      timedOut
        ? 'Сервер не ответил вовремя. Проверьте соединение и повторите загрузку.'
        : "Не удалось связаться с сервером. Проверьте соединение и повторите попытку.",
      timedOut ? 408 : 0,
    );
  } finally {
    clearTimeout(timer);
    requestOptions.signal?.removeEventListener('abort', cancel);
  }
}
export function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Что-то пошло не так. Попробуйте ещё раз.";
}
export function formatDate(value: number | null) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeZone: "Europe/Moscow",
      }).format(new Date(value))
    : "Ещё не заходил";
}
export function formatDateTime(value: number | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Moscow',
  }).format(new Date(value)) : '—';
}
export function formatSize(bytes: number) {
  return bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1048576).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}
