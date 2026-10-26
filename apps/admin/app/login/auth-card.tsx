export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-brand-600 p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-3">
          <img src="/logo.png" alt="দুধওয়ালা" width={44} height={44} className="h-11 w-11 rounded" />
          <div>
            <p className="font-bold text-brand-700">দুধওয়ালা অ্যাডমিন</p>
            <h1 className="text-sm text-muted">{title}</h1>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
