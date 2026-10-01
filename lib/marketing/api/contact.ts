import type { ApiGroup } from './types';

export const contactGroup: ApiGroup = {
  id: 'contact',
  title: 'Contact form',
  description: 'The public /contact form of the website. Requests are stored in the contact_requests table; no e-mail is sent.',
  endpoints: [
    {
      method: 'POST', path: '/api/contact', service: 'dashboard', auth: 'none',
      summary: 'Send a sales or contact request',
      description:
        'Validates and stores the request. Rate limited per client IP (CONTACT_RATE_LIMIT_PER_HOUR, default 5) and to 200 per hour in total. Anti-spam: a request with the hidden "website" field filled, or sent less than 3 seconds after the form loaded (startedAt), gets the same 201 answer but is not stored.',
      params: [
        { name: 'fullName / workEmail / phone', in: 'body', type: 'string', required: true, description: 'Contact person. phone takes the country code (WhatsApp number).' },
        { name: 'companyName / country', in: 'body', type: 'string', required: true, description: 'Company details.' },
        { name: 'companyType', in: 'body', type: '"insurer" | "broker" | "mutual" | "other"', required: true, description: 'Kind of company.' },
        { name: 'employees', in: 'body', type: 'string', required: true, description: '1-10, 11-50, 51-200, 201-1000 or 1000+.' },
        { name: 'insuredCustomers', in: 'body', type: 'string', required: true, description: 'Under 1,000, 1,000-10,000, 10,000-100,000, 100,000-1,000,000 or Over 1,000,000.' },
        { name: 'claimsPerMonth', in: 'body', type: 'string', required: true, description: 'Under 50, 50-200, 200-1,000, 1,000-5,000 or Over 5,000.' },
        { name: 'coverages', in: 'body', type: 'string[]', required: true, description: 'One or more of Auto, Health, Home, Fire, Life, Travel, Business.' },
        { name: 'deployment', in: 'body', type: '"hosted" | "self_hosted_support" | "not_sure"', required: true, description: 'Hosted by us, self-hosted with support, or not sure.' },
        { name: 'desiredStart', in: 'body', type: 'YYYY-MM-DD', description: 'Desired start date.' },
        { name: 'heardFrom', in: 'body', type: 'string', description: 'How they heard about RapidOS.' },
        { name: 'message', in: 'body', type: 'string (10-4000)', required: true, description: 'Free text.' },
        { name: 'startedAt', in: 'body', type: 'number', required: true, description: 'Time the form was displayed (ms since epoch), for the anti-spam check.' },
        { name: 'website', in: 'body', type: 'string', description: 'Honeypot: must be empty.' },
      ],
      body: `{
  "fullName": "Amina Diallo",
  "workEmail": "amina@demo-assurance.example.com",
  "phone": "+243 81 000 0000",
  "companyName": "Demo Assurance",
  "country": "DR Congo",
  "companyType": "insurer",
  "employees": "51-200",
  "insuredCustomers": "10,000-100,000",
  "claimsPerMonth": "200-1,000",
  "coverages": ["Auto", "Health"],
  "deployment": "hosted",
  "desiredStart": "2026-11-01",
  "heardFrom": "LinkedIn",
  "message": "We would like a hosted RapidOS for our auto claims.",
  "startedAt": 1790000000000,
  "website": ""
}`,
      successStatus: 201,
      response: `{ "ok": true }`,
      errors: [
        { status: 400, error: 'invalid_json', when: 'Body is not a JSON object' },
        { status: 400, error: 'validation_failed', when: 'fields: { field: required | too_long | too_short | invalid_email | invalid_phone | invalid_choice | invalid_date }' },
        { status: 413, error: 'too_large', when: 'Body larger than 32 KB' },
        { status: 429, error: 'rate_limited', when: 'Too many requests from this IP in the last hour' },
        { status: 500, error: 'save_failed', when: 'Database error' },
      ],
    },
  ],
};
