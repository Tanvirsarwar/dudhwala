'use client';

import { useEffect, useRef, useState } from 'react';
import { BottleIcon, BreadIcon, CupIcon, SweetIcon } from './icons';

const FALLBACK_ICON: Record<string, () => React.JSX.Element> = { 'dairy-sweets': SweetIcon, 'doi-dairy': CupIcon, bakery: BreadIcon };

/**
 * Real photo, or an intentional category tile (dot grid + line icon) saying the photo is coming. Never a stock/AI/fake product image.
 * Shows a shimmer until the file has loaded, then fades the photo in.
 */
export function ProductImage({ src, alt, category = '', eager = false }: { src: string | null; alt: string; category?: string; eager?: boolean }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const ref = useRef<HTMLImageElement>(null);
  // A server-rendered <img> can finish (or fail) before React hydrates and attaches handlers; check once on mount.
  useEffect(() => {
    const img = ref.current;
    if (!img?.complete) return;
    setState(img.naturalWidth === 0 ? 'failed' : 'ready');
  }, [src]);
  if (!src || state === 'failed') {
    const Icon = FALLBACK_ICON[category] ?? BottleIcon;
    return (
      <div className="photo-fallback" data-cat={category} role="img" aria-label={`${alt} — ছবি শীঘ্রই আসছে`}>
        <Icon />
        <small>ছবি শীঘ্রই আসছে</small>
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
