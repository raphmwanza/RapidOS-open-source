import { ADMIN_ONLY, JWT_ERRORS, ROLE_ERROR, type ApiGroup } from './types';

const ADMIN_ERRORS = [...JWT_ERRORS, ROLE_ERROR];

export const settingsGroup: ApiGroup = {
  id: 'settings',
  title: 'Settings, knowledge and integrations',
  description: `Company configuration. Every route here is limited to ${ADMIN_ONLY}. Secrets (WhatsApp access token, Meta app secret, verify token, LLM API key) are encrypted with ENCRYPTION_KEY (AES-256-GCM) and only ever returned masked (••••1234).`,
  endpoints: [
    {
      method: 'GET', path: '/api/integration-settings', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'WhatsApp and AI provider settings (masked)',
      response: `{
  "settings": {
    "id": "…", "companyId": "…",
    "whatsappDisplayNumber": "+243810000000", "whatsappPhoneNumberId": "123456789012345", "whatsappBusinessAccountId": "987654321098765",
    "publicBaseUrl": "https://demo.ngrok-free.app",
    "llmProvider": "gemini", "llmModel": "gemini-2.5-flash", "llmBaseUrl": null,
    "whatsappAccessTokenMasked": "••••a1B2", "metaAppSecretMasked": "••••9f3c", "webhookVerifyTokenMasked": "••••k8Zq", "llmApiKeyMasked": "••••XyZ0",
    "createdAt": "…", "updatedAt": "…"
  },
  "webhook": { "path": "/api/v1/whatsapp/webhook", "defaultBaseUrl": "<PUBLIC_API_URL or null>" }
}`,
      errors: ADMIN_ERRORS,
    },
    {
      method: 'PUT', path: '/api/integration-settings', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Save WhatsApp, AI provider and branding settings',
      description:
        'Send only what changes. Empty secret strings keep the saved value. The verify token and the phone number ID must be unique across companies (the webhook uses them to find your company).',
      params: [
        { name: 'whatsappDisplayNumber', in: 'body', type: 'string', description: 'The number customers write to, e.g. +243810000000.' },
        { name: 'whatsappPhoneNumberId', in: 'body', type: 'digits (5-32)', description: 'Meta "Phone number ID".' },
        { name: 'whatsappBusinessAccountId', in: 'body', type: 'digits (5-32)', description: 'Meta "WhatsApp Business Account ID" (WABA ID).' },
        { name: 'whatsappAccessToken', in: 'body', type: 'string (secret)', description: 'Permanent (system user) access token.' },
        { name: 'metaAppSecret', in: 'body', type: 'string (secret)', description: 'App secret used to verify X-Hub-Signature-256.' },
        { name: 'webhookVerifyToken', in: 'body', type: 'string 8-128, no spaces (secret)', description: 'The token you also paste in Meta > Webhooks.' },
        { name: 'publicBaseUrl', in: 'body', type: 'https URL', description: 'Public base URL of the Go API (ngrok or your domain). Empty clears it.' },
        { name: 'llmProvider', in: 'body', type: 'gemini | openai | deepseek | qwen | openai-compatible', description: 'AI provider.' },
        { name: 'llmModel / llmBaseUrl', in: 'body', type: 'string', description: 'Model name and, for openai-compatible, the base URL.' },
        { name: 'llmApiKey', in: 'body', type: 'string (secret)', description: 'Provider API key.' },
        { name: 'companyName, logoUrl, primaryColor (#RRGGBB), botLanguage', in: 'body', type: 'string', description: 'Branding and bot language.' },
      ],
      body: `{
  "whatsappDisplayNumber": "+243810000000",
  "whatsappPhoneNumberId": "123456789012345",
  "whatsappBusinessAccountId": "987654321098765",
  "whatsappAccessToken": "<EAAG… permanent token>",
  "metaAppSecret": "<app secret>",
  "webhookVerifyToken": "<random-verify-token>",
  "publicBaseUrl": "https://demo.ngrok-free.app",
  "llmProvider": "gemini",
  "llmModel": "gemini-2.5-flash",
  "llmApiKey": "<api key>"
}`,
      response: `{ "settings": { "…": "same shape as GET, secrets masked" }, "webhook": { "path": "/api/v1/whatsapp/webhook", "defaultBaseUrl": null } }`,
      errors: [
        ...ADMIN_ERRORS,
        { status: 400, error: 'invalid_body', when: 'Body is not a JSON object' },
        { status: 400, error: 'unsupported_llm_provider', when: 'Unknown provider' },
        { status: 400, error: 'invalid_whatsappPhoneNumberId / invalid_whatsappBusinessAccountId', when: 'Not 5-32 digits' },
        { status: 400, error: 'invalid_public_base_url', when: 'Not an http(s) URL' },
        { status: 400, error: 'invalid_verify_token', when: 'Not 8-128 printable characters without spaces' },
        { status: 400, error: 'invalid_primary_color / unsupported_bot_language', when: 'Bad branding value' },
        { status: 409, error: 'verify_token_in_use / phone_number_id_in_use', when: 'Already used by another company' },
        { status: 500, error: 'save_failed', when: 'Unexpected error' },
      ],
    },
    {
      method: 'GET', path: '/api/integration-settings/verify-token', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Reveal the webhook verify token',
      description: 'Used by the "Reveal" and "Copy" buttons of Settings > WhatsApp. Never cached.',
      response: `{ "token": "<your verify token>" }   // or { "token": null } when none is saved`,
      errors: [...ADMIN_ERRORS, { status: 500, error: 'decrypt_failed', when: 'ENCRYPTION_KEY changed since the token was saved' }],
    },
    {
      method: 'POST', path: '/api/integration-settings/test', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Test the WhatsApp connection, the webhook, or the AI provider',
      description:
        '{ "test": "connection" } checks that the WhatsApp fields are filled in. { "test": "webhook" } performs the Meta verification handshake against the Go API (and against publicBaseUrl when it is public HTTPS). Any other body runs the "Test bot": a sample claim extraction with your saved AI provider (POST /api/v1/internal/test-bot).',
      body: `{ "test": "webhook" }`,
      response: `// connection
{ "message": "connection_complete" }
// webhook (502 when a probe fails)
{ "backend": { "ok": true, "status": 200 }, "public": { "ok": true, "status": 200, "url": "https://demo.ngrok-free.app/api/v1/whatsapp/webhook" } }
// test bot
{ "success": true, "extracted": { "insuredFullName": "…", "incidentDate": "…", "…": "…" } }`,
      errors: [
        ...ADMIN_ERRORS,
        { status: 400, error: 'connection_incomplete', when: 'Display number, phone number ID, WABA ID or token missing' },
        { status: 400, error: 'verify_token_missing', when: 'No verify token saved' },
        { status: 502, error: 'Provider test failed: … / backend_unreachable', when: 'AI provider error or Go API down' },
        { status: 503, error: 'AI service is not available', when: 'The Go API started without an AI service' },
      ],
    },
    {
      method: 'GET', path: '/api/company-preferences', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Languages, behaviour toggles and coverage',
      response: `{
  "uiLanguage": "en", "botLanguage": "en",
  "toggles": { "bot_require_claim_photos": true, "bot_require_claim_documents": false, "bot_human_handoff": true, "bot_claim_status_lookup": true, "notify_customer_status_updates": true, "bot_reply_in_customer_language": true },
  "coverage": [ { "type": "AUTO", "displayName": "Motor", "isActive": true, "inCatalog": true, "configured": true, "fieldCount": 18 }, { "type": "HOME", "displayName": "Home", "isActive": false, "inCatalog": true, "configured": false, "fieldCount": 0 } ]
}`,
      errors: ADMIN_ERRORS,
    },
    {
      method: 'PUT', path: '/api/company-preferences', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Change languages, toggles or coverage',
      description: 'Activating a coverage that is not configured yet seeds its claim type and fields. At least one coverage must stay active. Changing botLanguage swaps the default welcome message and system prompt if you never edited them.',
      body: `{ "botLanguage": "fr", "toggles": { "bot_require_claim_photos": false }, "coverage": { "HOME": true } }`,
      response: `{ "…": "same shape as GET" }`,
      errors: [
        ...ADMIN_ERRORS,
        { status: 400, error: 'Invalid body / Invalid toggles / Invalid toggle <key> / Invalid coverage <type>', when: 'Bad shape or unknown key' },
        { status: 400, error: 'Language must be "en" or "fr"', when: 'Unsupported language' },
        { status: 400, error: 'coverage_required', when: 'Would disable every coverage' },
      ],
    },
    {
      method: 'GET', path: '/api/settings', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Knowledge settings the bot can use',
      description: 'Text entries (opening hours, contacts, FAQ answers…), uploaded documents and boolean settings of your company, newest first.',
      response: `{ "settings": [ { "id": "…", "name": "Business hours", "description": "When the office is open", "type": "text", "value": "Mon-Fri 8:00-17:00", "textValue": "Mon-Fri 8:00-17:00", "documentUrl": null, "documentContent": null, "boolValue": null, "isActive": true, "createdAt": "…", "updatedAt": "…" } ] }`,
      errors: ADMIN_ERRORS,
    },
    {
      method: 'POST', path: '/api/settings', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Create a knowledge entry',
      description: 'type is text, document or boolean. For a document, first upload the file with /api/settings/upload and pass its url and documentContent.',
      body: `{ "name": "Roadside assistance", "description": "Who to call after a breakdown", "type": "text", "value": "Call +243 810 000 099, 24/7." }`,
      response: `{ "setting": { "id": "…", "name": "Roadside assistance", "type": "text", "value": "Call +243 810 000 099, 24/7.", "…": "…" }, "message": "Setting created successfully" }`,
      errors: [...ADMIN_ERRORS, { status: 400, error: 'Missing required fields', when: 'name, description or type missing' }],
    },
    {
      method: 'PUT', path: '/api/settings', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Update a knowledge entry',
      body: `{ "id": "…", "name": "Roadside assistance", "description": "…", "value": "Call +243 810 000 099.", "isActive": true }`,
      response: `{ "setting": { "…": "…" }, "message": "Setting updated successfully" }`,
      errors: [...ADMIN_ERRORS, { status: 400, error: 'Setting ID is required', when: 'Missing id' }, { status: 500, error: 'Failed to update setting', when: 'Unknown id or another company' }],
    },
    {
      method: 'DELETE', path: '/api/settings?id={id}', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Delete a knowledge entry (and its stored file)',
      response: `{ "message": "Setting deleted successfully" }`,
      errors: [...ADMIN_ERRORS, { status: 400, error: 'Setting ID is required', when: 'Missing id' }, { status: 500, error: 'Failed to delete setting', when: 'Unknown id or another company' }],
      curl: `curl -X DELETE "$BASE/api/settings?id=<setting id>" -H "Authorization: Bearer $TOKEN"`,
    },
    {
      method: 'POST', path: '/api/settings/upload', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Upload a knowledge document',
      description: 'PDF, TXT, Markdown, CSV, JSON or XML up to 10 MB, stored in the dashboard_files volume (companies/<companyId>/knowledge/). Text is extracted (PDF text needs at least 50 characters; scanned PDFs return null).',
      form: { file: '@claims-guide.pdf' },
      response: `{ "url": "/api/settings/file?key=companies%2F<companyId>%2Fknowledge%2F<uuid>-claims-guide.pdf", "filename": "<uuid>-claims-guide.pdf", "contentType": "application/pdf", "documentContent": "Extracted text…" }`,
      errors: [...ADMIN_ERRORS, { status: 400, error: 'No file provided / Unsupported document type / File size exceeds maximum allowed (10MB)', when: 'Bad upload' }],
    },
    {
      method: 'GET', path: '/api/settings/file?key={key}', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Open a stored knowledge document',
      description: 'Only keys of your own company are served (companies/<your id>/knowledge/<file>). Text types are served as text/plain with a sandbox CSP.',
      response: 'The file bytes (application/pdf or text/plain)',
      errors: [...ADMIN_ERRORS, { status: 400, error: 'Invalid document', when: 'Key outside companies/<id>/knowledge/' }, { status: 404, error: 'Document not found', when: 'Missing file or another company' }],
      curl: `curl -OJ "$BASE/api/settings/file?key=companies%2F$COMPANY_ID%2Fknowledge%2F<file>" -H "Authorization: Bearer $TOKEN"`,
    },
  ],
};

export const analyticsGroup: ApiGroup = {
  id: 'analytics',
  title: 'Analytics and health',
  description: 'Dashboard numbers and liveness checks.',
  endpoints: [
    {
      method: 'GET', path: '/api/analytics', service: 'dashboard', auth: 'jwt',
      summary: 'Claim and conversation counters of your company',
      description: 'resolutionRate = (approved + completed) / total claims × 100. escalationRate counts conversations with a message mentioning "agent". avgResponseTime is a fixed placeholder (2.5 s).',
      response: `{ "analytics": { "totalClaims": 12, "newClaims": 4, "ongoingClaims": 3, "approvedClaims": 2, "rejectedClaims": 1, "completedClaims": 2, "resolutionRate": 33.3, "avgResponseTime": 2.5, "escalationRate": 8.3, "avgSatisfactionRating": 0, "totalConversations": 12, "totalFeedbacks": 0 } }`,
      errors: JWT_ERRORS,
    },
    {
      method: 'GET', path: '/api/health', service: 'dashboard', auth: 'none',
      summary: 'Dashboard health',
      response: `{ "status": "healthy", "timestamp": "…", "uptime": 3600.5, "memory": { "rss": 123456789, "…": "…" }, "environment": "production", "version": "1.0.0" }`,
      curl: `curl "$BASE/api/health"`,
    },
    {
      method: 'GET', path: '/health', service: 'api', auth: 'none',
      summary: 'Go API health (used by the docker healthcheck)',
      response: `{ "status": "ok" }`,
    },
    {
      method: 'GET', path: '/version', service: 'api', auth: 'none',
      summary: 'Go API version',
      response: `{ "version": "…" }`,
    },
    {
      method: 'GET', path: '/api/v1/ping', service: 'api', auth: 'none',
      summary: 'Ping',
      response: `{ "message": "pong" }`,
    },
  ],
};
