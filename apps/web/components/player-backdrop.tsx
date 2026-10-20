"use client";

import { useEffect, useState } from "react";
import { playerBackgrounds, type PlayerTheme } from "@/lib/player-themes";

type Props = {
  theme: PlayerTheme | null;
  activeTheme: PlayerTheme | null;
  onReady: (theme: PlayerTheme) => void;
  onError: (theme: PlayerTheme) => void;
};

export function PlayerBackdrop({ theme, activeTheme, onReady, onError }: Props) {
  const [layers, setLayers] = useState<PlayerTheme[]>([]);
  const [decoded, setDecoded] = useState<Partial<Record<PlayerTheme, boolean>>>({});

  useEffect(() => {
    if (theme && !layers.includes(theme)) setLayers(previous => [...previous, theme]);
    if (theme && decoded[theme]) onReady(theme);
  }, [theme, layers, decoded, onReady]);

  return (
    <div className="player-backdrop" aria-hidden="true">
      <noscript>
        <picture className="player-backdrop-fallback">
          <source media="(max-width: 700px)" srcSet={playerBackgrounds.original.mobile} />
          <img src={playerBackgrounds.original.desktop} alt="" />
        </picture>
      </noscript>
      {layers.map((value, index) => (
        <picture
          key={value}
          className="player-backdrop-layer"
          data-theme={value}
          data-active={activeTheme === value}
        >
          <source media="(max-width: 700px)" srcSet={playerBackgrounds[value].mobile} />
          <img
            src={playerBackgrounds[value].desktop}
            alt=""
            decoding="async"
            fetchPriority={index === 0 ? "high" : "auto"}
            draggable={false}
            onLoad={async event => {
              const image = event.currentTarget;
              const source = image.currentSrc;
              try {
                await image.decode();
                if (image.currentSrc === source) {
                  setDecoded(previous => ({ ...previous, [value]: true }));
                }
              } catch {
                // A responsive source can change while the previous one decodes.
              }
            }}
            onError={() => {
              setLayers(previous => previous.filter(layer => layer !== value));
              setDecoded(previous => ({ ...previous, [value]: false }));
              onError(value);
            }}
          />
        </picture>
      ))}
    </div>
  );
}
