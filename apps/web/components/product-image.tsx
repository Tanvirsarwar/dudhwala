'use client';

import { useEffect, useRef, useState } from 'react';
import { BottleIcon } from './icons';

/**
 * Real photo, or a flat brand tile saying the photo is coming (never a stock/AI image — UI_UX_SPEC §5).
 * Shows a shimmer until the file has loaded, then fades the photo in.
 */
export function ProductImage({ src, alt, eager = false }: { src: string | null; alt: string; eager?: boolean }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const ref = useRef<HTMLImageElement>(null);
  // A server-rendered <img> can finish (or fail) before React hydrates and attaches handlers; check once on mount.
  useEffect(() => {
    const img = ref.current;
    if (!img?.complete) return;
    setState(img.naturalWidth === 0 ? 'failed' : 'ready');
  }, [src]);
  if (!src || state === 'failed') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-brand-100 text-brand-600" role="img" aria-label={`${alt} — ছবি শীঘ্রই আসছে`}>
        <BottleIcon />
        <span className="text-xs">ছবি শীঘ্রই আসছে</span>
      </div>
    );
  }
  return (
    <div className={`h-full w-full ${state === 'loading' ? 'skeleton' : ''}`}>
      {/* Plain <img>: product photos come from the media CDN; no runtime image optimiser to operate. */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
        className={`img-zoom h-full w-full object-cover transition-opacity duration-300 ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
        width={600}
        height={600}
      />
    </div>
  );
}
