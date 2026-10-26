import Link from 'next/link';
import { serverGet, type Area, type Category, type ProductList } from '@/lib/api';
import { ProductGrid } from '@/components/product-card';

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
      <section className="-mx-4 bg-brand-600 px-4 pb-10 pt-8 text-white md:pb-14 md:pt-12" aria-labelledby="hero-title">
        <div className="mx-auto max-w-6xl">
          <p className="font-latin text-sm uppercase tracking-[0.2em] text-sky-300">Serving Purity</p>
          <h1 id="hero-title" className="mt-2 text-3xl font-bold leading-tight md:text-5xl">
            সিলেটের নিজস্ব দুগ্ধজাত পণ্য,
            <br />
            <span className="text-accent-500">আপনার দোরগোড়ায়</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-brand-100">গরুর খাঁটি কাঁচা দুধ, দই, মিষ্টি, ঘি এবং বেকারি পণ্য — অনলাইনে অর্ডার করুন, পছন্দের সময়ে ডেলিভারি নিন।</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="#products" className="btn bg-white text-brand-700 hover:bg-brand-100">
              পণ্য দেখুন
            </Link>
            {hasPage('delivery-policy') && (
              <Link href="/pages/delivery-policy" className="btn border border-white/40 text-white hover:bg-brand-500">
                ডেলিভারি তথ্য
              </Link>
            )}
          </div>
        </div>
      </section>
      <svg className="milk-wave -mx-4 -mt-px w-[calc(100%+2rem)] bg-brand-600" viewBox="0 0 1440 28" preserveAspectRatio="none" aria-hidden>
        <path fill="currentColor" d="M0 28V12c120 10 240 16 360 10S600 0 720 2s240 20 360 20 240-10 360-14v20Z" />
      </svg>

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
        <section className="mt-8" aria-labelledby="cat-title">
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
          <section key={c.slug} className="mt-8" aria-labelledby={`col-${c.slug}`}>
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

      <section className="card mt-10 p-5" aria-labelledby="area-title-home">
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
