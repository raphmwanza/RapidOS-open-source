// Real screenshots of the dashboard, taken from a local stack with the
// fictional company "Demo Assurance". Files live in public/screenshots/.
// Width/height are the real pixel sizes of the files (used by next/image).

export interface ScreenshotInfo {
  src: string;
  width: number;
  height: number;
  alt: string;
}

const s = (file: string, width: number, height: number, alt: string): ScreenshotInfo => ({
  src: `/screenshots/${file}`,
  width,
  height,
  alt,
});

export const SCREENSHOTS = {
  signupCompany: s('signup-1-company.webp', 1440, 900, 'Signup wizard, step 1: company name, country and city'),
  signupContact: s('signup-2-contact.webp', 1440, 900, 'Signup wizard, step 2: contact email, phone and brand'),
  signupAdmin: s('signup-3-admin.webp', 1440, 900, 'Signup wizard, step 3: the first super admin'),
  signupCoverage: s('signup-4-coverage.webp', 1440, 900, 'Signup wizard, step 4: coverage types the company handles'),
  signupAssistant: s('signup-5-assistant.webp', 1440, 900, 'Signup wizard, step 5: assistant language and behaviour'),
  signupReview: s('signup-6-review.webp', 1440, 900, 'Signup wizard, step 6: review before creating the company'),
  signupDone: s('signup-7-password.webp', 1440, 900, 'Signup success screen with the generated password (hidden here)'),
  login: s('login.webp', 1440, 900, 'Sign-in page'),
  home: s('dashboard-home.webp', 1440, 900, 'Dashboard home with claim and conversation statistics'),
  claims: s('claims-list.webp', 1440, 900, 'Claims list with the status of each claim'),
  claimDetail: s('claim-detail.webp', 1440, 900, 'Claim detail page with the data collected on WhatsApp'),
  conversation: s('conversation.webp', 1440, 900, 'A WhatsApp conversation between a customer and the assistant'),
  client: s('client-detail.webp', 1440, 900, 'Client page showing two claims from the same customer'),
  settingsWhatsapp: s('settings-whatsapp.webp', 1440, 900, 'Settings: WhatsApp integration card with masked secrets'),
  settingsAi: s('settings-ai.webp', 1440, 900, 'Settings: AI provider card and the Test bot result'),
  users: s('users.webp', 1440, 900, 'Users page with roles'),
} satisfies Record<string, ScreenshotInfo>;

export type ScreenshotId = keyof typeof SCREENSHOTS;
