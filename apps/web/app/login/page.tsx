'use client';

import { useRouter } from 'next/navigation';
import { OtpLogin } from '@/components/otp-login';
import { DEMO_BRANDING } from '@/components/developer-credit';
import { DemoLoginInfo } from '@/components/demo-login-info';

function RealLogin() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md pt-8">
      <OtpLogin onDone={() => router.push('/account')} />
    </div>
  );
}

export default function LoginPage() {
  return DEMO_BRANDING ? <DemoLoginInfo /> : <RealLogin />;
}
