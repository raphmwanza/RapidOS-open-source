// Public site settings for the marketing pages (landing, docs, pricing).

import { runtimeEnv } from '@/lib/runtimeEnv';

// Read at runtime on the server (see lib/runtimeEnv.ts), so the NEXT_PUBLIC_BASE_URL
// set on the container is used for canonical and OG URLs.

export const SITE = {
  name: 'RapidOS',
  tagline: 'WhatsApp claims assistant for insurers',
  description:
    'RapidOS is an open-source WhatsApp assistant and dashboard that lets insurers in emerging markets receive, document and track claims where their customers already are.',
  /** Public URL of this dashboard (canonical links, OG image). */
  url: runtimeEnv('NEXT_PUBLIC_BASE_URL') || 'http://localhost:3000',
  /** Sales and contact address (pricing, /contact, mailto links). */
  contactEmail: 'raphmwanza5@gmail.com',
  /** Public source repository (AGPL-3.0 section 13 source link, clone commands). */
  githubUrl: 'https://github.com/raphmwanza/RapidOS-open-source',
  ogImage: '/og-image.png',
  /** License of the source code (AGPL-3.0-only, see LICENSE at the repository root). */
  license: 'AGPL-3.0',
  copyright: 'Copyright (C) 2026 Raph Mwanza',
} as const;
