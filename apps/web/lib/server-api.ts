import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Profile } from "./types";

export async function serverApi<T>(path: string, returnTo = "/"): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get("mc_launcher_token");
  if (!token) redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  const backend =
    process.env.BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const response = await fetch(`${backend}${path}`, {
    headers: { Cookie: `mc_launcher_token=${encodeURIComponent(token.value)}` },
    cache: "no-store",
  });
  if (response.status === 401)
    redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  if (response.status === 403) redirect('/profile');
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Не удалось загрузить данные сервера.");
  return response.json() as Promise<T>;
}

export const requireProfile = (returnTo = "/profile") =>
  serverApi<Profile>("/api/profile", returnTo);
