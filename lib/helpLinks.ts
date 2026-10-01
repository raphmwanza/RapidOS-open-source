// Documentation targets used by the dashboard (sidebar, user card and contextual
// "Help" links). Every anchor must exist in the docs: __tests__/unit/helpLinks.test.ts
// checks them against the docs pages and the API reference groups.
export const HELP_LINKS = {
  docs: '/docs',
  whatsapp: '/docs/whatsapp#values',
  aiProvider: '/docs/ai-providers#configure',
  roles: '/docs/dashboard#users',
  knowledge: '/docs/dashboard#knowledge',
  apiSettings: '/docs/api#settings',
  apiUsers: '/docs/api#users',
} as const;

export type HelpLinkKey = keyof typeof HELP_LINKS;
