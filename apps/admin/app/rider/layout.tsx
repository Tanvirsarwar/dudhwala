'use client';

import { SessionProvider } from '@/lib/session';

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider area="rider">{children}</SessionProvider>;
}
