"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import styles from "./auth-layout.module.css";

const source = "/backgrounds/auth-835968525843.webp";
const embers = [12, 23, 31, 39, 47, 56, 64, 73, 81, 89];

export function AuthBackground() {
  const pathname = usePathname();

  return <BackgroundScene key={pathname} />;
}

function BackgroundScene() {
  const image = useRef<HTMLImageElement>(null);
  const [imageReady, setImageReady] = useState(false);
  const [introReady, setIntroReady] = useState(false);
  const [finished, setFinished] = useState(false);
  const loaded = imageReady && introReady;

  useEffect(() => {
    // A cached image may finish before React attaches its load handler.
    if (image.current?.complete && image.current.naturalWidth > 0) {
      setImageReady(true);
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIntroReady(true);
      setFinished(true);
      return;
    }

    // Let the atmosphere appear even when the image loads instantly.
    const timer = window.setTimeout(() => setIntroReady(true), 600);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className={styles.scene}
      data-loaded={loaded}
      data-finished={finished}
      aria-hidden="true"
    >
      <Image
        ref={image}
        src={source}
        alt=""
        fill
        priority
        unoptimized
        sizes="100vw"
        className={styles.background}
        onLoad={() => setImageReady(true)}
        onError={() => setFinished(true)}
        onAnimationEnd={() => setFinished(true)}
      />
      {!finished && (
        <div className={styles.atmosphere}>
          <div className={styles.halo} />
          <div className={styles.fog} />
          <div className={styles.fogLow} />
          {embers.map((left, index) => (
            <i
              key={left}
              className={styles.ember}
              style={{
                "--left": `${left}%`,
                "--delay": `${index * -0.63}s`,
                "--duration": `${4.5 + (index % 4) * 0.8}s`,
              } as CSSProperties}
            />
          ))}
        </div>
      )}
      <noscript>
        <img
          src={source}
          alt=""
          className={`${styles.background} ${styles.fallback}`}
        />
      </noscript>
    </div>
  );
}
