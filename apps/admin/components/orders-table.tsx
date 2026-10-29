'use client';

import Link from 'next/link';
import type { FulfilmentMethod } from '@dudhwala/shared';
import { METHOD_BN, dateTime, taka } from '@/lib/format';
import { OrderBadge, TableWrap } from './ui';

export interface OrderRow {
  id: string;
  orderNumber?: string;
  createdAt: string;
  method: FulfilmentMethod;
  zone: string | null;
  status: string;
  paymentStatus?: string;
  totalPoisha: number | null;
  itemCount: number;
  customer: string | null;
  outletNameBn: string | null;
}
export function OrdersTable({ rows }: { rows: OrderRow[] }) {
  return (
    <TableWrap label="অর্ডারের তালিকা">
      <table className="tbl">
        <thead>
          <tr>
            <th>অর্ডার</th>
            <th>সময়</th>
            <th>ধরন</th>
            <th>গ্রাহক</th>
            <th>পণ্য</th>
            <th>মোট</th>
            <th>অবস্থা</th>
            <th>পেমেন্ট</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/orders/${r.id}`} className="font-latin font-semibold text-link underline">
                  {r.orderNumber ?? r.id}
                </Link>
              </td>
              <td className="font-latin whitespace-nowrap">{dateTime(r.createdAt)}</td>
              <td>{METHOD_BN[r.method]}</td>
              <td>{r.customer ?? '—'}</td>
              <td>{r.itemCount}</td>
              <td className="whitespace-nowrap">{taka(r.totalPoisha)}</td>
              <td>
                <OrderBadge status={r.status} />
              </td>
              <td>{r.paymentStatus === 'PAID' ? 'টাকা পাওয়া গেছে' : r.paymentStatus === 'UNPAID' ? 'বাকি' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
