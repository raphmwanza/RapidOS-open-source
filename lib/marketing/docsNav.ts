export interface DocsNavItem {
  href: string;
  title: string;
  description: string;
}

export const DOCS_NAV: DocsNavItem[] = [
  { href: '/docs', title: 'Overview', description: 'What RapidOS is and how the pieces fit together.' },
  { href: '/docs/getting-started', title: 'Getting started', description: 'Create your company and sign in for the first time.' },
  { href: '/docs/whatsapp', title: 'WhatsApp / Meta setup', description: 'Connect a WhatsApp Business number and the webhook.' },
  { href: '/docs/ai-providers', title: 'AI providers', description: 'Gemini, OpenAI, DeepSeek, Qwen or a local model.' },
  { href: '/docs/dashboard', title: 'Using the dashboard', description: 'Claims, conversations, clients, users and settings.' },
  { href: '/docs/self-hosting', title: 'Self-hosting with Docker', description: 'Environment variables, commands, backups and resets.' },
  { href: '/docs/api', title: 'API reference', description: 'Every HTTP endpoint of the dashboard and the Go API.' },
];
