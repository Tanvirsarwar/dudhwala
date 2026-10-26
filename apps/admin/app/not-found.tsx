import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="p-8 text-center">
      <h1 className="mb-2 text-xl font-bold text-brand-700">পাতাটি পাওয়া যায়নি</h1>
      <p className="mb-4 text-muted">এটি নেই, অথবা আপনার এটি দেখার অনুমতি নেই।</p>
      <Link className="btn btn-primary" href="/">
        ড্যাশবোর্ডে ফিরুন
      </Link>
    </main>
  );
}
