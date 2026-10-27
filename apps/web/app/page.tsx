import Link from 'next/link';
import { serverGet, type Area, type Category, type ProductList } from '@/lib/api';
import { ProductGrid } from '@/components/product-card';
import { ParallaxScene, Tilt } from '@/components/pointer-motion';

interface Home {
  banners: { id: string; titleBn: string; altBn: string; imageUrl: string; linkUrl: string | null }[];
  collections: { slug: string; titleBn: string }[];
  pages: { slug: string; titleBn: string }[];
}

export default async function HomePage() {
  const [home, categories, products, areas] = await Promise.all([
    serverGet<Home>('/content/home'),
    serverGet<Category[]>('/catalog/categories'),
    serverGet<ProductList>('/catalog/products?limit=12&sort=newest'),
    serverGet<Area[]>('/delivery/areas'),
  ]);
  const collections = await Promise.all(
    (home?.collections ?? []).map(async (c) => ({ ...c, products: (await serverGet<ProductList>(`/catalog/products?collection=${c.slug}&limit=8`))?.data ?? [] })),
  );
  const hasPage = (slug: string) => home?.pages.some((p) => p.slug === slug);

  return (
    <>
      {/* Hero: brand band. Copy is from the supplied invitation; no invented offers or awards. */}
      <section className="hero-bg full-bleed relative overflow-hidden px-4 pb-9 pt-6 text-white md:pb-12 md:pt-9" aria-labelledby="hero-title">
        <ParallaxScene className="mx-auto grid max-w-6xl items-center gap-8 min-[1184px]:px-4 md:grid-cols-[1.3fr_1fr]">
          {/* Decorative depth layers: pure CSS shapes, moved by pointer on fine-pointer devices only. */}
          <span aria-hidden className="depth-layer pointer-events-none absolute -right-20 -top-10 h-56 w-56 rounded-full bg-accent-500/15 md:-right-16 md:top-4 md:h-72 md:w-72 md:bg-accent-500/20 [--depth:28]" />
          <span aria-hidden className="depth-layer pointer-events-none absolute bottom-0 left-1/3 hidden h-40 w-40 rounded-full bg-white/10 md:block [--depth:-18]" />
          <div className="relative">
            <p className="reveal font-latin text-sm uppercase tracking-[0.2em] text-sky-300">Serving Purity</p>
            <h1 id="hero-title" className="reveal mt-2 text-3xl font-bold leading-tight md:text-[2.75rem]" style={{ ['--i' as string]: 1 }}>
              সিলেটের নিজস্ব দুগ্ধজাত পণ্য,
              <br />
              <span className="text-accent-500">আপনার দোরগোড়ায়</span>
            </h1>
            <p className="reveal mt-4 max-w-xl text-lg text-brand-100" style={{ ['--i' as string]: 2 }}>
              গরুর খাঁটি কাঁচা দুধ, দই, মিষ্টি, ঘি এবং বেকারি পণ্য — অনলাইনে অর্ডার করুন, পছন্দের সময়ে ডেলিভারি নিন।
            </p>
            <div className="reveal mt-6 flex flex-wrap gap-3" style={{ ['--i' as string]: 3 }}>
              <Link href="#products" className="btn bg-white text-brand-700 shadow-lg hover:bg-brand-100">
                পণ্য দেখুন
              </Link>
              {hasPage('delivery-policy') && (
                <Link href="/pages/delivery-policy" className="btn border border-white/40 text-white hover:bg-white/10">
                  ডেলিভারি তথ্য
                </Link>
              )}
            </div>
          </div>
          <div className="relative hidden justify-self-center md:block" aria-hidden>
            <div className="depth-layer [--depth:12]">
              <Tilt max={8}>
                <div className="animate-float rounded-3xl bg-white p-5 shadow-[0_30px_60px_rgba(8,12,40,0.45)]">
                  <img src="/logo.png" alt="" width={450} height={240} className="h-auto w-64" />
                </div>
              </Tilt>
            </div>
          </div>
        </ParallaxScene>
      </section>
      <div className="full-bleed -mt-px bg-brand-700">
        <svg className="milk-wave" viewBox="0 0 1440 28" preserveAspectRatio="none" aria-hidden>
          <path fill="currentColor" d="M0 28V12c120 10 240 16 360 10S600 0 720 2s240 20 360 20 240-10 360-14v20Z" />
        </svg>
      </div>

      {home && home.banners.length > 0 && (
        <section aria-label="ঘোষণা" className="mt-6 grid gap-3 md:grid-cols-2">
          {home.banners.map((b) => {
            const img = (
              <img src={b.imageUrl} alt={b.altBn} className="aspect-[3/1] w-full rounded-2xl object-cover" loading="lazy" />
            );
            return b.linkUrl ? (
              <Link key={b.id} href={b.linkUrl}>
                {img}
              </Link>
            ) : (
              <div key={b.id}>{img}</div>
            );
          })}
        </section>
      )}

      {categories && categories.length > 0 && (
        <section className="reveal mt-6" aria-labelledby="cat-title">
          <h2 id="cat-title" className="text-xl font-bold">
            ক্যাটাগরি
          </h2>
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-2">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.slug}`} className="btn btn-ghost whitespace-nowrap rounded-full">
                  {c.nameBn}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {collections
        .filter((c) => c.products.length > 0)
        .map((c) => (
          <section key={c.slug} className="mt-6" aria-labelledby={`col-${c.slug}`}>
            <h2 id={`col-${c.slug}`} className="mb-3 text-xl font-bold">
              {c.titleBn}
            </h2>
            <ProductGrid products={c.products} />
          </section>
        ))}

      <section id="products" className="mt-8 scroll-mt-28" aria-labelledby="all-title">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="all-title" className="text-xl font-bold">
            সব পণ্য
          </h2>
          <Link href="/search" className="text-accent-ink underline underline-offset-4">
            সব দেখুন
          </Link>
        </div>
        <ProductGrid products={products?.data ?? []} />
      </section>

      <section className="card reveal mt-8 p-4" aria-labelledby="area-title-home">
        <h2 id="area-title-home" className="text-lg font-bold">
          যেসব এলাকায় ডেলিভারি দেওয়া হয়
        </h2>
        {areas && areas.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {areas.map((a) => (
              <li key={a.id} className="rounded-full bg-accent-100 px-3 py-1 text-sm text-brand-700">
                {a.nameBn}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">ডেলিভারি এলাকার তালিকা শীঘ্রই প্রকাশ করা হবে।</p>
        )}
      </section>

      {(hasPage('about') || hasPage('faq')) && (
        <section className="mt-6 grid gap-3 md:grid-cols-2">
          {hasPage('about') && (
            <Link href="/pages/about" className="card block p-5 hover:bg-brand-100">
              <h2 className="font-bold">দুধওয়ালা সম্পর্কে</h2>
              <p className="text-sm text-muted">আমাদের গল্প পড়ুন →</p>
            </Link>
          )}
          {hasPage('faq') && (
            <Link href="/pages/faq" className="card block p-5 hover:bg-brand-100">
              <h2 className="font-bold">সাধারণ জিজ্ঞাসা</h2>
              <p className="text-sm text-muted">অর্ডার, ডেলিভারি ও পেমেন্ট →</p>
            </Link>
          )}
        </section>
      )}
    </>
  );
}
