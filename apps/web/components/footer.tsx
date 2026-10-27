import { DeveloperCredit } from './developer-credit';
import Link from 'next/link';
import { serverGet } from '@/lib/api';

interface Home {
  pages: { slug: string; titleBn: string }[];
}

/** Footer shows only published policy pages; nothing is hard-coded about the business. */
export async function Footer() {
  const home = await serverGet<Home>('/content/home', 60).catch(() => null);
  const pages = home?.pages ?? [];
  return (
    <footer className="mt-16 bg-brand-700 text-white">
      <svg className="milk-wave -mt-px rotate-180" viewBox="0 0 1440 28" preserveAspectRatio="none" aria-hidden>
        <path fill="currentColor" d="M0 0h1440v10c-120 12-240 18-360 12S840 4 720 6 480 24 360 24 120 14 0 10Z" />
      </svg>
      <div className="page-w grid gap-6 py-8 md:grid-cols-3">
        <div>
          <p className="text-lg font-bold">দুধওয়ালা</p>
          <p className="font-latin text-sm tracking-wide text-sky-300">DUDHWALA FOOD PRODUCTS · Serving Purity</p>
        </div>
        <nav aria-label="তথ্য ও নীতিমালা">
          <ul className="grid gap-2 text-sm">
            {pages.map((p) => (
              <li key={p.slug}>
                <Link href={`/pages/${p.slug}`} className="hover:text-accent-100 hover:underline">
                  {p.titleBn}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/account" className="hover:text-accent-100 hover:underline">
                আমার অর্ডার
              </Link>
            </li>
          </ul>
        </nav>
        <p className="text-sm text-sky-300">© {new Date().getFullYear()} Dudhwala Food Products</p>
      </div>
      <div className="page-w pb-6">
        <DeveloperCredit size="footer" />
      </div>
    </footer>
  );
}
