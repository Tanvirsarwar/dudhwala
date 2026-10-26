'use client';

import { useRouter } from 'next/navigation';
import { OtpLogin } from '@/components/otp-login';

export default function LoginPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md pt-8">
      <OtpLogin onDone={() => router.push('/account')} />
    </div>
  );
}
