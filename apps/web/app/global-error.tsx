"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function GlobalError() {
  return (
    <html lang="ru">
      <head><title>500 · Minecraft Launcher</title><meta name="robots" content="noindex,nofollow" /></head>
      <body style={{ margin: 0 }}><ErrorScreen code={500} /></body>
    </html>
  );
}
