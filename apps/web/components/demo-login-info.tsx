import Link from 'next/link';

/** /login in the demo build: there is no customer sign-in (it needs the SMS/OTP backend), so say so and offer the real next steps. */
export function DemoLoginInfo() {
  return (
    <div className="card mx-auto mt-8 max-w-md p-6 text-center">
      <h1 className="text-xl font-bold">লগইন</h1>
      <p className="notice notice-info mt-3">
        <span>ডেমোতে গ্রাহক লগইন নেই (এর জন্য এসএমএস/ওটিপি ব্যাকএন্ড লাগে)।</span> <span>অর্ডার দিতে লগইন লাগে না।</span>
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn btn-primary">
          কেনাকাটা করুন
        </Link>
        <Link href="/account" className="btn btn-ghost">
          আমার অর্ডার
        </Link>
      </div>
    </div>
  );
}
