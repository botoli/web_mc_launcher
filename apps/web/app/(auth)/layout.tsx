import { Brand } from "@/components/shell";
import { Blocks, ShieldCheck } from "lucide-react";
import { AuthBackground } from "./auth-background";
import styles from "./auth-layout.module.css";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className={styles.layout}>
      <AuthBackground />
      <section className={styles.story}>
        <Brand />
        <div className={styles.content}>
          <span className="badge neutral">
            <span className="status-dot" />
            Minecraft Launcher
          </span>
          <h2>
            Управление <span>сервером</span>
          </h2>
          <p>
            Сборка, моды, игроки и настройки -
            <br />в одной панели
          </p>
          <div className={styles.features}>
            <span>
              <Blocks size={18} />
              Сборка и конфиги
            </span>
            <span>
              <ShieldCheck size={18} />
              Игроки и журнал
            </span>
          </div>
        </div>
        <span className={styles.storyFooter}>
          Панель управления Minecraft-сервером.
        </span>
      </section>

      <section className={`auth-main ${styles.main}`}>
        <div className={styles.mobileBrand}>
          <Brand />
        </div>
        <div className={`auth-form ${styles.form}`}>{children}</div>
        <footer className={styles.footer}>
          Minecraft Server · Панель управления
        </footer>
      </section>
    </main>
  );
}
