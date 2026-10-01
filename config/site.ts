// Public site settings for the marketing pages (landing, docs, pricing).

// Read at runtime on the server (a computed key is not inlined at build time),
// so the docker-compose NEXT_PUBLIC_BASE_URL is used for canonical and OG URLs.
const BASE_URL_KEY = 'NEXT_PUBLIC_BASE_URL';

export const SITE = {
  name: 'RapidOS',
  tagline: 'WhatsApp claims assistant for insurers',
  description:
    'RapidOS is an open-source WhatsApp assistant and dashboard that lets insurers in emerging markets receive, document and track claims where their customers already are.',
  /** Public URL of this dashboard (canonical links, OG image). */
  url: (typeof process !== 'undefined' && process.env[BASE_URL_KEY]) || 'http://localhost:3000',
  /** Sales and contact address (pricing, /contact, mailto links). */
  contactEmail: 'raphmwanza5@gmail.com',
  /** Public source repository (AGPL-3.0 section 13 source link, clone commands). */
  githubUrl: 'https://github.com/raphmwanza/RapidOS-open-source',
  ogImage: '/og-image.png',
  /** License of the source code (AGPL-3.0-only, see LICENSE at the repository root). */
  license: 'AGPL-3.0',
  copyright: 'Copyright (C) 2026 Raph Mwanza',
} as const;
