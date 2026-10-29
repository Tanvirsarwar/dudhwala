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
import { LANG_BOOT_SCRIPT, THEME_BOOT_SCRIPT } from '@dudhwala/ui/boot';
import { LangRuntime } from '@dudhwala/ui/lang';

export const metadata: Metadata = {
  title: { default: 'দুধওয়ালা অ্যাডমিন', template: '%s · দুধওয়ালা অ্যাডমিন' },
  icons: { icon: '/logo.png' },
  robots: { index: false, follow: false },
};

/** Everything is per-user and client-rendered; never prerender. */
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
        <PreviewBanner />
        {children}
      </body>
    </html>
  );
}
