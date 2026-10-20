import { publicClientInfo } from "@/lib/server-api";

export const dynamic = "force-dynamic";

// Keep all browser-visible downloads on the player's origin. Never redirect to
// client.url: older releases may still contain the administrative hostname.
export async function GET() {
  try {
    const client = await publicClientInfo();
    if (!client?.size) throw new Error("No published launcher");
    const pathname = new URL(client.url, "http://localhost").pathname;
    if (
      !/^\/download\/launcher\/[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?\.zip$/.test(
        pathname,
      ) &&
      pathname !== "/api/download-launcher"
    ) {
      throw new Error("Unexpected download path");
    }
    const backend =
      process.env.BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
    const upstream = await fetch(`${backend}${pathname}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok || !upstream.body) throw new Error("Download unavailable");
    const version = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(
      client.version,
    )
      ? `-${client.version}`
      : "";
    const extension = pathname === "/api/download-launcher" && /\.exe(?:"|;|$)/i.test(upstream.headers.get("content-disposition") || "") ? "exe" : "zip";
    return new Response(upstream.body, {
      headers: {
        "Content-Type": extension === "zip" ? "application/zip" : "application/octet-stream",
        "Content-Disposition": `attachment; filename="Nevermoreland-Launcher${version}.${extension}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, {
      status: 303,
      headers: { Location: "/play?download=unavailable", "Cache-Control": "no-store" },
    });
  }
}
