import type { Metadata, Viewport } from 'next';
import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/500.css';
import '@fontsource/hind-siliguri/600.css';
import '@fontsource/hind-siliguri/700.css';
import '@fontsource-variable/inter';
import './globals.css';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { MaintenanceBanner } from '@/components/maintenance-banner';

export const metadata: Metadata = {
  title: { default: 'দুধওয়ালা — Dudhwala Food Products', template: '%s · দুধওয়ালা' },
  description: 'সিলেটের নিজস্ব দুগ্ধজাত পণ্য — অনলাইনে অর্ডার করুন, ঘরে ডেলিভারি।',
  icons: { icon: '/logo.png' },
  robots: process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true' ? undefined : { index: false, follow: false },
};

/**
 * Render per request (data fetches are still cached ~30 s by Next's fetch cache).
 * Keeps builds independent of a running API and avoids serving stale prerendered pages after deploys.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#2d308f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <body className="min-h-screen font-sans">
        <Header />
        <MaintenanceBanner />
        <main id="main" className="mx-auto max-w-6xl px-4 pb-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
