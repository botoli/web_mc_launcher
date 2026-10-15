import type { NextConfig } from "next";
import path from "node:path";

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
  async rewrites() {
    return ["api", "mods", "download"].map((prefix) => ({
      source: `/${prefix}/:path*`,
      destination: `${backend}/${prefix}/:path*`,
    }));
  },
};
export default config;
