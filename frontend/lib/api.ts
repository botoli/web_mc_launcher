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
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      "Не удалось связаться с сервером. Проверьте соединение и повторите попытку.",
      0,
    );
  }
  const data = await response.json().catch(() => null);
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
export function formatSize(bytes: number) {
  return bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1048576).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}
