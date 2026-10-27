import Link from 'next/link';
import { DeveloperCredit } from './developer-credit';

/**
 * Editorial About page for the local demo (NEXT_PUBLIC_DEMO_BRANDING=1). Story facts are limited to what the
 * 2021 Business Standard report states; nothing about present-day operations is claimed. Illustrations are the
 * demo's own generated artwork served by the mock API.
 */
const ART = (slug: string) => `/v1/media/demo/${slug}.svg`;

const PRODUCTS = [
  { name: 'দুধ', note: 'তাজা তরল দুধ', slug: 'fresh-milk', href: '/c/milk' },
  { name: 'দই', note: 'মিষ্টি ও টক দই', slug: 'sweet-curd', href: '/c/curd' },
  { name: 'ঘি ও মাখন', note: 'ঘি ও বাটার', slug: 'pure-ghee', href: '/c/ghee-butter' },
  { name: 'পনির', note: 'পনির ও চিজ', slug: 'paneer', href: '/c/cheese' },
  { name: 'মিষ্টি', note: 'ঐতিহ্যবাহী মিষ্টি', slug: 'rasgulla', href: '/c/sweets' },
];
const STEPS = [
  { n: '১', t: 'কাঁচা দুধ', d: 'শুরুটা ছিল দুগ্ধ খামার থেকে কাঁচা দুধ সরবরাহ দিয়ে।' },
  { n: '২', t: 'দুগ্ধজাত পণ্য', d: 'দই, ঘি ও পনিরের মতো পণ্য তৈরির পথে এগিয়ে যাওয়া।' },
  { n: '৩', t: 'ঐতিহ্যবাহী মিষ্টি', d: 'মৌসুমি মিষ্টি, যার মধ্যে খেজুরের গুড়ের মিষ্টিও রয়েছে।' },
];
const VALUES = [
  { t: 'সংগ্রহ ও প্রস্তুতিতে যত্ন', d: 'খামার থেকে রান্নাঘর পর্যন্ত প্রতিটি ধাপে যত্ন।' },
  { t: 'দুগ্ধ ঐতিহ্যের প্রতি শ্রদ্ধা', d: 'পুরোনো দিনের দুধ-মিষ্টির স্বাদ ও কারিগরির প্রতি সম্মান।' },
  { t: 'পরিচ্ছন্নতা ও মানে মনোযোগ', d: 'পরিচ্ছন্ন প্রস্তুতি ও স্থিতিশীল মান বজায় রাখার চেষ্টা।' },
  { t: 'গ্রাহকই আগে', d: 'সহজ অর্ডার, স্পষ্ট তথ্য, ভরসাযোগ্য সেবা।' },
];

export function AboutStory() {
  return (
    <article className="about mt-6">
      <section className="about-hero reveal" aria-labelledby="about-title">
        <div className="about-hero-text">
          <p className="about-eyebrow">আমাদের গল্প</p>
          <h1 id="about-title" className="text-3xl font-bold leading-tight md:text-5xl">
            সিলেটের খামার থেকে, আপনার টেবিলে
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">দুধওয়ালার যাত্রা দুগ্ধ খামারিদের হাত ধরে — খাঁটি দুধ থেকে দই, ঘি আর ঐতিহ্যবাহী মিষ্টি পর্যন্ত। তাজা স্বাদ আর ভরসাই আমাদের পথ।</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/" className="btn btn-primary">
              পণ্য দেখুন
            </Link>
          </div>
        </div>
        <div className="about-art" aria-hidden>
          {['fresh-milk', 'sweet-curd', 'pure-ghee'].map((s, i) => (
            <img key={s} src={ART(s)} alt="" width={800} height={800} className={`about-tile about-tile-${i}`} />
          ))}
        </div>
      </section>

      <section className="about-section reveal" aria-labelledby="story-title">
        <h2 id="story-title" className="about-h2">
          আমাদের গল্প
        </h2>
        <div className="card p-6 md:p-8">
          <p className="leading-8">দ্য বিজনেস স্ট্যান্ডার্ডের ২০২১ সালের একটি প্রতিবেদন অনুযায়ী, সিলেটের দুধওয়ালার যাত্রা শুরু হয়েছিল চারজন দুগ্ধ খামারির উদ্যোগে।</p>
          <p className="mt-3 leading-8">প্রথমে তাঁরা কাঁচা দুধ সরবরাহ করতেন। পরে শুধু কাঁচা দুধের বাইরে গিয়ে দই, ঘি, পনির ও ঐতিহ্যবাহী মিষ্টির মতো দুগ্ধজাত পণ্য তৈরির পথে এগিয়েছেন।</p>
          <p className="mt-3 leading-8">প্রতিবেদনে খেজুরের গুড় দিয়ে তৈরি মৌসুমি মিষ্টির কথাও এসেছে, এবং খামার থেকে দুধ সংগ্রহ ও পণ্য তৈরিতে পরিচ্ছন্নতা ও মানের দিকে নজর দেওয়ার কথা বলা হয়েছে।</p>
        </div>
        <ol className="about-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="glass about-step">
              <span className="area-pin" aria-hidden>
                {s.n}
              </span>
              <div>
                <h3 className="font-bold">{s.t}</h3>
                <p className="text-sm text-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">সূত্র: The Business Standard, ২৮ মে ২০২১। এটি ঐতিহাসিক পটভূমি; বর্তমান কার্যক্রম বা পণ্যের প্রাপ্যতার নিশ্চয়তা নয়।</p>
      </section>

      <section className="about-section reveal" aria-labelledby="prod-title">
        <h2 id="prod-title" className="about-h2">
          আমাদের পণ্যের ধরন
        </h2>
        <p className="mb-4 text-sm text-muted">ডেমো ক্যাটালগে থাকা ধরন — প্রাপ্যতা পরিবর্তিত হতে পারে।</p>
        <ul className="about-products">
          {PRODUCTS.map((p) => (
            <li key={p.slug}>
              <Link href={p.href} className="card card-lift about-product">
                <img src={ART(p.slug)} alt="" width={800} height={800} loading="lazy" />
                <span className="block p-3">
                  <span className="block font-bold">{p.name}</span>
                  <span className="block text-sm text-muted">{p.note}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="about-section reveal" aria-labelledby="val-title">
        <h2 id="val-title" className="about-h2">
          আমাদের মূল্যবোধ
        </h2>
        <p className="mb-4 text-sm text-muted">ব্র্যান্ডের উদ্দেশ্য, স্বতন্ত্রভাবে প্রত্যয়িত দাবি নয়।</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {VALUES.map((v) => (
            <li key={v.t} className="card p-5">
              <h3 className="font-bold">{v.t}</h3>
              <p className="mt-1 text-sm text-muted">{v.d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="about-close reveal" aria-labelledby="close-title">
        <h2 id="close-title" className="text-2xl font-bold md:text-3xl">
          পছন্দের পণ্য খুঁজে নিন
        </h2>
        <p className="mt-2 text-muted">দুধ, দই, ঘি, পনির আর মিষ্টি — স্টোরে ঘুরে দেখুন।</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn btn-primary">
            পণ্য দেখুন
          </Link>
          <Link href="/search" className="btn btn-ghost">
            খুঁজুন
          </Link>
        </div>
      </section>

      <section className="about-section" aria-label="ডেভেলপার">
        <DeveloperCredit size="about" />
      </section>
    </article>
  );
}
