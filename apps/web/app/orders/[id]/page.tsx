'use client';

import { useParams } from 'next/navigation';
import { DemoOrderDetail } from '@/components/demo-order-detail';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return <DemoOrderDetail id={id} />;
}
