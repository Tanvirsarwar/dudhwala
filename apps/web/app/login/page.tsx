'use client';

import { useRouter } from 'next/navigation';
import { OtpLogin } from '@/components/otp-login';
import { DEMO_BRANDING } from '@/components/developer-credit';
import { DemoLoginInfo } from '@/components/demo-login-info';

export default function LoginPage() {
  const router = useRouter();
  if (DEMO_BRANDING) return <DemoLoginInfo />;
  return (
    <div className="mx-auto max-w-md pt-8">
      <OtpLogin onDone={() => router.push('/account')} />
    </div>
  );
}
