'use client';

import './globals.css';

/** Last-resort boundary (the root layout itself failed). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="bn">
      <body className="grid min-h-screen place-items-center p-6 font-sans">
        <div className="card max-w-md p-8 text-center" role="alert">
          <h1 className="mb-2 text-xl font-bold">কিছু একটা সমস্যা হয়েছে / Something went wrong</h1>
          <button type="button" className="btn btn-primary mt-3" onClick={reset}>
            আবার চেষ্টা করুন / Try again
          </button>
        </div>
      </body>
    </html>
  );
}
