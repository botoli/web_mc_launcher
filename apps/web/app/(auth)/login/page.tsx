import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
export const metadata: Metadata = { title: "Вход" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <AuthForm
      redirectTo={
        typeof params.redirect === "string" ? params.redirect : "/profile"
      }
      registered={params.registered !== undefined}
      initialError={
        typeof params.error === "string" ? params.error.slice(0, 200) : ""
      }
    />
  );
}
