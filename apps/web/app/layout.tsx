import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./admin-motion.css";

export const metadata: Metadata = {
  title: { default: "Minecraft Launcher", template: "%s · Minecraft Launcher" },
  description: "Сборка, моды и игроки вашего Minecraft-сервера в одном месте.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#1A1A1A" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
