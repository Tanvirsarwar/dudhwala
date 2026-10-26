'use client';

import { SessionProvider } from '@/lib/session';
import { Shell } from '@/components/shell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider area="admin">
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
