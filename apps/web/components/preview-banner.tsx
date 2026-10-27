/** Shown only when NEXT_PUBLIC_PREVIEW_LABEL is set at build time (staging/demo deployments). */
export function PreviewBanner() {
  const label = process.env.NEXT_PUBLIC_PREVIEW_LABEL;
  if (!label) return null;
  return (
    <p role="note" className="bg-[#fff4cc] px-4 py-1.5 text-center text-sm font-semibold text-ink">
      {label}
    </p>
  );
}
