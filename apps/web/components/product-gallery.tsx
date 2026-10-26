'use client';

import { useState } from 'react';
import { ProductImage } from './product-image';

interface Img {
  url: string;
  altBn: string;
}

/** Main photo with a thumbnail strip when a product has more than one image. */
export function ProductGallery({ images, name }: { images: Img[]; name: string }) {
  const [i, setI] = useState(0);
  const cur = images[i];
  return (
    <div>
      <div className="card aspect-square overflow-hidden">
        {/* key forces a fresh load/fade-in per image */}
        <ProductImage key={cur?.url ?? 'none'} src={cur?.url ?? null} alt={cur?.altBn ?? name} eager />
      </div>
      {images.length > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="ছবির তালিকা">
          {images.map((img, n) => (
            <li key={img.url} className="shrink-0">
              <button
                type="button"
                onClick={() => setI(n)}
                aria-label={`ছবি ${n + 1}`}
                aria-current={n === i}
                className={`block h-16 w-16 overflow-hidden rounded-xl border-2 transition-[border-color,transform] duration-200 active:scale-95 ${n === i ? 'border-brand-600' : 'border-transparent opacity-80 hover:opacity-100'}`}
              >
                <ProductImage src={img.url} alt="" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
