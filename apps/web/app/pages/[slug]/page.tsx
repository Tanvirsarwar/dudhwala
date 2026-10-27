import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverGet } from '@/lib/api';
import { AboutStory } from '@/components/about-story';
import { DEMO_BRANDING } from '@/components/developer-credit';

interface Page {
  slug: string;
  titleBn: string;
  bodyBn: string;
  updatedAt: string;
}
type Props = { params: Promise<{ slug: string }> };

const get = (slug: string) => (/^[a-z-]{2,40}$/.test(slug) ? serverGet<Page>(`/content/pages/${slug}`, 60) : Promise.resolve(null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await get((await params).slug);
  return { title: p?.titleBn ?? 'তথ্য' };
}

/** Business-approved text pages. Body is plain text (rendered as text — no HTML injection possible). */
export default async function ContentPage({ params }: Props) {
  const slug = (await params).slug;
  const p = await get(slug);
  if (!p) notFound();
  if (DEMO_BRANDING && slug === 'about') return <AboutStory />; // demo build only: editorial About page
  return (
    <article className="card mx-auto mt-6 max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{p.titleBn}</h1>
      <div className="whitespace-pre-line leading-8">{p.bodyBn}</div>
    </article>
  );
}
