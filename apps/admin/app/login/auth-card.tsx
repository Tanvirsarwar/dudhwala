import { LangToggle } from '@dudhwala/ui/lang';
import { ThemeToggle } from '@dudhwala/ui/theme';

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="main" className="auth-bg relative flex min-h-screen items-center justify-center p-4 text-on-brand">
      <div className="absolute right-4 top-4 flex gap-2">
        <LangToggle onBar />
        <ThemeToggle onBar />
      </div>
      <div className="card w-full max-w-sm p-6 text-ink">
        <div className="mb-4 flex items-center gap-3">
          <img src="/logo.png" alt="দুধওয়ালা" width={44} height={44} className="h-11 w-11 rounded" />
          <div>
            <p className="font-bold text-brand-700">দুধওয়ালা</p>
            <h1 className="text-sm text-muted">{title}</h1>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
