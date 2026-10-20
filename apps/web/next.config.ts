import type { NextConfig } from "next";
import path from "node:path";
import { readFileSync } from "node:fs";

const playerBackgrounds = JSON.parse(
  readFileSync(path.join(__dirname, "lib/player-backgrounds.json"), "utf8"),
) as Record<string, { desktop: string; mobile: string }>;

const backend =
  process.env.BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  turbopack: { root: path.resolve(__dirname, "../..") },
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    process.env.DOMAIN || "89.125.214.122",
  ],
  async headers() {
    return Object.values(playerBackgrounds).flatMap(({ desktop, mobile }) =>
      [desktop, mobile].map(source => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      })),
    );
  },
  async rewrites() {
    return ["api", "mods", "download"].map((prefix) => ({
      source: `/${prefix}/:path*`,
      destination: `${backend}/${prefix}/:path*`,
    }));
  },
};
export default config;
