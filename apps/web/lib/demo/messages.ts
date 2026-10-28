import type { EligibilityReason, IssueCode } from '@dudhwala/shared';

/** Customer-facing demo messages (Bangla source; English comes from the shared dictionary). One place, so Phase 2 can reuse the codes. */
export const ISSUE_MESSAGES: Record<IssueCode, string> = {
  ordering_closed: 'এখন অর্ডার নেওয়া বন্ধ আছে।',
  cart_empty: 'কার্ট খালি। আগে পণ্য যোগ করুন।',
  bulk_requires_collection: 'এই কার্টটি বাল্ক অর্ডারের আওতায় পড়ে। বাল্ক অর্ডার নিতে হবে।',
  not_bulk: 'কার্টে বাল্ক অর্ডারের ন্যূনতম পরিমাণ নেই।',
  zone_required: 'ডেলিভারি জোন বেছে নিন।',
  item_not_deliverable: 'এই পণ্য এই জোনে ডেলিভারি করা যায় না।',
  address_name_required: 'নাম লিখুন।',
  address_phone_invalid: 'সঠিক মোবাইল নম্বর লিখুন (যেমন ০১৭১২৩৪৫৬৭৮)।',
  address_line_required: 'ঠিকানা লিখুন।',
  outlet_required: 'পিকআপের আউটলেট বেছে নিন।',
  pickup_invalid: 'পিকআপের সময় বেছে নিন।',
  pickup_too_soon: 'পিকআপের সময় অন্তত ১ ঘণ্টা পরে হতে হবে।',
  pickup_outside_hours: 'পিকআপের সময় অর্ডারের সময়সীমার মধ্যে হতে হবে।',
  bulk_prepayment_required: 'বাল্ক অর্ডারে আগে পেমেন্ট (ডেমো/সিমুলেটেড) করতে হবে।',
};

export const REASON_MESSAGES: Record<EligibilityReason, string> = {
  in_city_all: 'ইন সিটিতে সব পণ্য ডেলিভারি হয়।',
  category_rule: 'আউটার সিটিতে ডেলিভারি হয়।',
  approved_item: 'আউটার সিটিতে ডেলিভারি হয়।',
  pending_verification: 'আউটার সিটির জন্য এখনো যাচাই হয়নি।',
  pending_confirmation: 'আউটার সিটির জন্য এখনো নিশ্চিত হয়নি।',
  disabled: 'আউটার সিটিতে এই পণ্য বন্ধ আছে।',
  item_not_approved: 'আউটার সিটিতে এই পণ্য ডেলিভারি হয় না।',
};

import type { DemoPaymentState } from '@dudhwala/shared';

export { METHOD_BN as METHOD_LABEL, ORDER_STATUS_BN as STATUS_LABEL } from '@dudhwala/shared';

export const PAYMENT_LABEL: Record<DemoPaymentState, string> = {
  NOT_REQUIRED_DEMO: 'ডেমো — ক্যাশ অন ডেলিভারি (কোনো আসল পেমেন্ট নেই)',
  DEMO_UNPAID: 'ডেমো/সিমুলেটেড পেমেন্ট — বাকি',
  DEMO_PAID_SIMULATED: 'ডেমো/সিমুলেটেড পেমেন্ট — সম্পন্ন (আসল টাকা কাটা হয়নি)',
};
