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
import { PreviewBanner } from '@/components/preview-banner';
import { LANG_BOOT_SCRIPT, LangRuntime } from '@/components/lang';

export const metadata: Metadata = {
  title: { default: 'দুধওয়ালা অ্যাডমিন', template: '%s · দুধওয়ালা অ্যাডমিন' },
  icons: { icon: '/logo.png' },
  robots: { index: false, follow: false },
};

/** Everything is per-user and client-rendered; never prerender. */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#2d308f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <LangRuntime />
        <PreviewBanner />
        {children}
      </body>
    </html>
  );
}
