import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold">পাতাটি পাওয়া যায়নি</h1>
      <p className="mt-2 text-muted">লিংকটি ভুল অথবা পণ্যটি আর পাওয়া যাচ্ছে না।</p>
      <Link href="/" className="btn btn-primary mt-4">
        প্রথম পাতায় যান
      </Link>
    </div>
  );
}
