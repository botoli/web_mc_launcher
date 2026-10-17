'use client';

import { useEffect, useState } from 'react';

// Keep a closing popup mounted briefly, but inert, so it can fade out safely.
export function useMenuPresence(open: boolean) {
  const [retained, setRetained] = useState(false);
  useEffect(() => {
    if (open) { setRetained(true); return; }
    if (!retained) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setRetained(false); return; }
    const timer = window.setTimeout(() => setRetained(false), 150);
    return () => window.clearTimeout(timer);
  }, [open, retained]);
  return open || retained;
}
