import { Brand } from "@/components/shell";
import { VoxelScene } from "@/components/voxel-scene";
import { Blocks, ShieldCheck } from "lucide-react";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <img src="./background/background.png" alt="" />
        <Brand />
        <div className="auth-story-content">
          <span className="badge neutral">
            <span className="status-dot" />
            Minecraft Launcher
          </span>
          <h2>
            Больше, чем
            <br />
            просто блоки.
          </h2>
          <p>
            Одна сборка. Общий мир.
            <br />И бесконечно много историй.
          </p>
          <VoxelScene />
          <div className="story-features">
            <span>
              <Blocks size={18} />
              Моды в одной сборке
            </span>
            <span>
              <ShieldCheck size={18} />
              Твой игровой профиль
            </span>
          </div>
        </div>
        <span className="story-footer">Приключения начинаются здесь.</span>
      </section>

      <section className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form">{children}</div>
        <footer>Minecraft Launcher · Твой мир, твои правила</footer>
      </section>
    </main>
  );
}
