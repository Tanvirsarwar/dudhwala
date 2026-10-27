import Link from 'next/link';
import { BULK_CONFIG } from '@dudhwala/shared';
import { bnDigits } from '@/lib/format';

/** Home-page entry to the bulk order page (demo build). */
export function BulkPromo() {
  return (
    <section className="card reveal mt-8 flex flex-wrap items-center justify-between gap-4 p-5" aria-labelledby="bulk-promo-title">
      <div className="min-w-0 flex-1">
        <h2 id="bulk-promo-title" className="text-lg font-bold">
          বাল্ক অর্ডার
        </h2>
        <p className="text-sm text-muted">
          <span>অনুষ্ঠান বা বড় চাহিদার জন্য একসাথে অনেক পণ্য অর্ডার করুন। ন্যূনতম (ডেমো, চূড়ান্ত নয়):</span> <b>{bnDigits(BULK_CONFIG.minTotalQuantity)}</b> <span>টি।</span> <span>সংগ্রহ শুধু মদিনা মার্কেট শাখা থেকে।</span>
        </p>
      </div>
      <Link href="/bulk" className="btn btn-primary">
        বাল্ক অর্ডার করুন
      </Link>
    </section>
  );
}
