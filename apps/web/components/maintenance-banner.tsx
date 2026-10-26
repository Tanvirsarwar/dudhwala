import { serverGet } from '@/lib/api';

/** Shown while the Super Admin has switched on maintenance mode: browsing works, ordering is paused. */
export async function MaintenanceBanner() {
  const home = await serverGet<{ maintenance?: boolean }>('/content/home', 15).catch(() => null);
  if (!home?.maintenance) return null;
  return (
    <p role="status" className="bg-[#fff4cc] px-4 py-2 text-center text-sm text-ink">
      রক্ষণাবেক্ষণের জন্য সাময়িকভাবে অর্ডার নেওয়া বন্ধ আছে। পণ্য দেখা যাবে; একটু পরে আবার অর্ডার করুন।
    </p>
  );
}
