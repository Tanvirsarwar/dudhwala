'use client';

import { useEffect } from 'react';

/** Route-level error boundary: a failed data load (for example the API being unreachable) shows this instead of a blank page. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md p-8 text-center" role="alert">
      <h1 className="mb-2 text-xl font-bold">কিছু একটা সমস্যা হয়েছে</h1>
      <p className="mb-4 text-muted">তথ্য লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn btn-primary" onClick={reset}>
          আবার চেষ্টা করুন
        </button>
        <a href="/" className="btn btn-ghost">
          প্রথম পাতায় যান
        </a>
      </div>
    </div>
  );
}
