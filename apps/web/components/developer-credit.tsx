/**
 * Plain developer attribution with the supplied PETRA logo (not a link). Shown only in the demo build
 * (NEXT_PUBLIC_DEMO_BRANDING=1); the logo file is used exactly as supplied.
 */
export const DEMO_BRANDING = process.env.NEXT_PUBLIC_DEMO_BRANDING === '1';

export function DeveloperCredit({ size = 'footer' }: { size?: 'footer' | 'about' }) {
  if (!DEMO_BRANDING) return null;
  return (
    <div className={`dev-credit dev-credit-${size}`}>
      {/* aspect ratio of the supplied file (2000 x 984) is preserved by width/height + auto sizing */}
      <img src="/petra-logo.webp" alt="PETRA Software Solutions" width={2000} height={984} loading="lazy" decoding="async" />
      <p>নির্মাণ ও সফটওয়্যার উন্নয়ন: PETRA Software Solutions</p>
    </div>
  );
}
