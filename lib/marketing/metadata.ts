import type { Metadata } from 'next';
import { SITE } from '@/config/site';

/** Per-page metadata for the marketing site (title, description, canonical, Open Graph, Twitter). */
export function pageMetadata({ title, description, path }: { title?: string; description: string; path: string }): Metadata {
  const fullTitle = title ? `${title} | ${SITE.name}` : `${SITE.name}: ${SITE.tagline}`;
  return {
    title: title ? title : { absolute: fullTitle },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE.name,
      locale: 'en_US',
      url: path,
      title: fullTitle,
      description,
      images: [{ url: SITE.ogImage, width: 1200, height: 630, alt: `${SITE.name}: ${SITE.tagline}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [SITE.ogImage],
    },
  };
}
