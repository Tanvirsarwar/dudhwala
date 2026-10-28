import type { Metadata, Viewport } from 'next';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-bengali/600.css';
import '@fontsource/noto-sans-bengali/700.css';
import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/500.css';
import '@fontsource/hind-siliguri/600.css';
import '@fontsource/hind-siliguri/700.css';
import '@fontsource-variable/inter';
import './globals.css';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { MaintenanceBanner } from '@/components/maintenance-banner';
import { PreviewBanner } from '@/components/preview-banner';
import { LANG_BOOT_SCRIPT, THEME_BOOT_SCRIPT } from '@dudhwala/ui/boot';
import { LangRuntime } from '@dudhwala/ui/lang';
import { ZoneProvider } from '@/lib/demo/zone';
import { ConfigProvider } from '@/lib/demo/config';

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

export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#2a2fae' }, { media: '(prefers-color-scheme: dark)', color: '#0b0f3a' }], width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT + LANG_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <LangRuntime />
        <ConfigProvider>
        <ZoneProvider>
          <PreviewBanner />
          <Header />
          <MaintenanceBanner />
          <main id="main" className="page-w pb-8">
            {children}
          </main>
          <Footer />
        </ZoneProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
