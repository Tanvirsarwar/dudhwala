'use client';

import { useEffect, useRef, useState } from 'react';
import { BottleIcon } from './icons';

/** Real photo, or a flat brand tile saying the photo is coming (never a stock/AI image — UI_UX_SPEC §5). */
export function ProductImage({ src, alt, eager = false }: { src: string | null; alt: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // A server-rendered <img> can fail before React hydrates and attaches onError; check once on mount.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-brand-100 text-brand-600" role="img" aria-label={`${alt} — ছবি শীঘ্রই আসছে`}>
        <BottleIcon />
        <span className="text-xs">ছবি শীঘ্রই আসছে</span>
      </div>
    );
  }
  return (
    // Plain <img>: product photos come from the media CDN; no runtime image optimiser to operate.
    <img ref={ref} src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover" width={600} height={600} />
  );
}
