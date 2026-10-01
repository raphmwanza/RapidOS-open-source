// Plans shown on /pricing: the free self-hosted edition, and "Contact us" for
// everything we run or set up for you. There are no published prices and no
// payment on the site; "Contact us" opens the /contact form.

import { SITE } from './site';

export const CONTACT_EMAIL = SITE.contactEmail;

export interface PricingPlan {
  id: 'free' | 'contact';
  name: string;
  /** Large label where a price would be. */
  headline: string;
  note: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    headline: 'Free',
    note: 'Self-hosted, open source',
    description: 'Run RapidOS on your own server with Docker. Every feature, and you keep full control of your data.',
    features: [
      'Every feature of the product',
      'Unlimited companies, users and claims',
      'Bring your own WhatsApp Business number',
      'Bring your own AI provider (Gemini, OpenAI, DeepSeek, Qwen, Ollama)',
      'Community support',
    ],
    cta: { label: 'Read the self-hosting guide', href: '/docs/self-hosting' },
  },
  {
    id: 'contact',
    name: 'Contact us',
    headline: "Let's talk",
    note: 'Hosted, enterprise, setup and support',
    description: 'We run RapidOS for you, or help your team install it, connect WhatsApp and train your staff.',
    features: [
      'Hosted by us: updates, backups and monitoring',
      'Enterprise needs: SSO, SLA, on-premises installation',
      'Setup of your WhatsApp Business number and AI provider',
      'Integrations with your core insurance system or CRM',
      'Training and ongoing support for your claims team',
    ],
    cta: { label: 'Contact us', href: '/contact' },
    highlighted: true,
  },
];

export const PRICING_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is the self-hosted version really free?',
    a: 'Yes. The full product is open source. You pay only for your own server, your WhatsApp Business conversations (billed by Meta) and your AI provider usage.',
  },
  {
    q: 'How much does hosting or support cost?',
    a: 'It depends on your number of users, claims and the help you need. Tell us about your company with the contact form and we reply with a proposal.',
  },
  {
    q: 'Who pays for WhatsApp messages?',
    a: 'WhatsApp Business conversations are billed by Meta to the WhatsApp Business Account you connect, whether you self-host or we host for you. RapidOS never resells messages.',
  },
  {
    q: 'Which AI model do I need?',
    a: 'Any supported provider works: Google Gemini, OpenAI, DeepSeek, Qwen, or a model you run yourself with Ollama or another OpenAI-compatible server. You choose it per company in Settings.',
  },
  {
    q: 'Can I move from hosted to self-hosted later?',
    a: 'Yes. Hosting runs the same open-source code. We hand over a database export and your stored files, which you restore in your own installation (see Self-hosting > Backups).',
  },
  {
    q: 'Can I pay online?',
    a: 'No. Nothing is sold on this site; hosting and support are agreed and invoiced directly.',
  },
];
