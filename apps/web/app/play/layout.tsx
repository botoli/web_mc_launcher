import type { Metadata } from "next";
import { PlayerSite } from "@/components/player-site";
import "./play.css";
import "./how-to-play/guide.css";

export const metadata: Metadata = {
  title: { default: "Nevermoreland — начни свою историю", template: "%s · Nevermoreland" },
  description: "Твой мир, твои лошади, твоя история. Скачай лаунчер Nevermoreland и узнай, как начать играть.",
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return <PlayerSite>{children}</PlayerSite>;
}
