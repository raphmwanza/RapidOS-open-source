import type { ApiError, ApiGroup } from './types';

const INTERNAL_ERRORS: ApiError[] = [
  { status: 401, error: 'Missing internal API key', when: 'No X-Internal-API-Key header' },
  { status: 401, error: 'Invalid internal API key', when: 'Wrong key (constant-time comparison)' },
  { status: 429, error: 'rate limit exceeded', when: 'More than RATE_LIMIT_REQUESTS per RATE_LIMIT_WINDOW seconds' },
];

export const WEBHOOK_PAYLOAD = `{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "987654321098765",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "243810000000", "phone_number_id": "123456789012345" },
            "contacts": [ { "profile": { "name": "Grace Mutombo" }, "wa_id": "243810000001" } ],
            "messages": [
              {
                "from": "243810000001",
                "id": "wamid.HBgMMjQzODEwMDAwMDAxFQIAEhgg…",
                "timestamp": "1759330800",
                "type": "text",
                "text": { "body": "Hello, I had an accident this morning" }
              }
            ]
          }
        }
      ]
    }
  ]
}`;

export const WEBHOOK_IMAGE_MESSAGE = `{
  "from": "243810000001",
  "id": "wamid.…",
  "timestamp": "1759330860",
  "type": "image",
  "image": { "id": "1234567890", "mime_type": "image/jpeg", "sha256": "…", "caption": "Rear bumper" }
}`;

export const SIGNATURE_NODE = `// X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(app secret, raw request body))
import crypto from 'node:crypto';

const body = JSON.stringify(payload);            // sign the exact bytes you send
const signature = 'sha256=' + crypto
  .createHmac('sha256', process.env.META_APP_SECRET)
  .update(body)
  .digest('hex');`;

export const SIGNATURE_BASH = `BODY='{"object":"whatsapp_business_account","entry":[…]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')

curl -X POST "$API/api/v1/whatsapp/webhook" \\
  -H "Content-Type: application/json" \\
  -H "X-Hub-Signature-256: sha256=$SIG" \\
  --data-raw "$BODY"`;

export const SIGNATURE_GO = `// backend/internal/handlers/whatsapp.go
func verifyWebhookSignature(body []byte, header, secret string) bool {
	if secret == "" || len(header) < 7 || header[:7] != "sha256=" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hmac.Equal([]byte(header[7:]), []byte(fmt.Sprintf("%x", mac.Sum(nil))))
}`;

export const webhookGroup: ApiGroup = {
  id: 'webhook',
  title: 'WhatsApp webhook (Go API)',
  description:
    'The URL you register in Meta > WhatsApp > Configuration: https://<your public API host>/api/v1/whatsapp/webhook. One URL serves every company: the GET handshake finds the company by its verify token and each POST by metadata.phone_number_id, then checks the signature with that company\'s app secret.',
  endpoints: [
    {
      method: 'GET', path: '/api/v1/whatsapp/webhook', service: 'api', auth: 'verify-token',
      summary: 'Meta verification handshake',
      description: 'Meta calls this once when you click "Verify and save". The token is matched against the verify tokens saved in Settings > WhatsApp (read from the database on every request, so a new token works immediately). The challenge is echoed back as plain text.',
      params: [
        { name: 'hub.mode', in: 'query', type: '"subscribe"', required: true, description: 'Always subscribe.' },
        { name: 'hub.verify_token', in: 'query', type: 'string', required: true, description: 'Your verify token.' },
        { name: 'hub.challenge', in: 'query', type: 'string', required: true, description: 'Random value to echo.' },
      ],
      response: '1158201444   (the hub.challenge value, text/plain)',
      errors: [{ status: 403, error: 'Forbidden', when: 'Wrong mode, missing token or no company has this verify token' }],
      curl: `curl "$API/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=1158201444"`,
    },
    {
      method: 'POST', path: '/api/v1/whatsapp/webhook', service: 'api', auth: 'webhook-signature',
      summary: 'Incoming WhatsApp messages',
      description:
        'Answers 200 right away and processes messages in the background, one queue per customer, so slow AI calls never trigger Meta retries. Retries of an already-seen message id are ignored. Handled message types: text, image, document and video (media are downloaded from the Graph API with the company access token); other types such as audio are not processed. Status callbacks (sent/delivered/read) have no messages and are acknowledged with queued: 0.',
      params: [
        { name: 'X-Hub-Signature-256', in: 'header', type: 'sha256=<hex>', required: true, description: 'HMAC-SHA256 of the raw body with the Meta app secret.' },
        { name: 'entry[].changes[].value.metadata.phone_number_id', in: 'body', type: 'string', required: true, description: 'Selects the company.' },
        { name: 'entry[].changes[].value.messages[]', in: 'body', type: 'array', description: 'from, id, timestamp, type and text / image / document / video.' },
      ],
      body: WEBHOOK_PAYLOAD,
      response: `{ "status": "accepted", "queued": 1 }`,
      errors: [
        { status: 400, error: 'Invalid payload', when: 'Body is not valid JSON' },
        { status: 400, error: 'Missing webhook phone_number_id', when: 'No metadata.phone_number_id' },
        { status: 401, error: 'Unknown WhatsApp phone number', when: 'No company has this phone number ID' },
        { status: 401, error: 'Invalid webhook signature', when: 'Missing or wrong X-Hub-Signature-256, or no app secret saved' },
        { status: 429, error: 'rate limit exceeded', when: 'Per-IP rate limit of the Go API' },
      ],
      curl: SIGNATURE_BASH,
    },
  ],
};

export const internalGroup: ApiGroup = {
  id: 'internal',
  title: 'Internal service API (Go API)',
  description:
    'Service-to-service routes between the dashboard and the Go API. They require X-Internal-API-Key: $INTERNAL_API_KEY (when INTERNAL_API_KEY is empty they require a dashboard JWT instead) and X-Company-ID to pick the company whose WhatsApp credentials are used. Keep port 8080 private: in the provided docker-compose.yml it is bound to 127.0.0.1 and only /api/v1/whatsapp/webhook needs to be public.',
  endpoints: [
    {
      method: 'POST', path: '/api/v1/internal/send-message', service: 'api', auth: 'internal',
      summary: 'Send a WhatsApp text message',
      description: 'Called by POST /api/send-message after the dashboard stored the message.',
      params: [
        { name: 'X-Company-ID', in: 'header', type: 'uuid', required: true, description: 'Company whose WhatsApp number sends.' },
        { name: 'customerPhone', in: 'body', type: 'string', required: true, description: 'Recipient (E.164 or digits).' },
        { name: 'message', in: 'body', type: 'string', required: true, description: 'Text.' },
        { name: 'conversationId, customerId, companyId, companySlug, role, source, adminId', in: 'body', type: 'string', description: 'Informational, echoed or logged.' },
      ],
      body: `{ "customerPhone": "+243810000001", "message": "An assessor will call you today.", "conversationId": "…" }`,
      response: `{ "status": "success", "message": "Message sent successfully to WhatsApp", "data": { "customerPhone": "+243810000001", "messageLength": 33, "conversationId": "…" } }`,
      errors: [
        ...INTERNAL_ERRORS,
        { status: 400, error: 'Invalid request payload / CustomerPhone and Message are required', when: 'Bad body' },
        { status: 500, error: 'Failed to send WhatsApp message', when: 'Missing X-Company-ID, no WhatsApp settings, or Graph API error' },
      ],
    },
    {
      method: 'POST', path: '/api/v1/internal/send-document', service: 'api', auth: 'internal',
      summary: 'Send a document (e.g. the claim PDF) over WhatsApp',
      description: 'documentUrl must be reachable by Meta (the dashboard sends a signed 24-hour PDF link built from NEXT_PUBLIC_BASE_URL).',
      body: `{ "customerPhone": "+243810000001", "documentUrl": "https://dash.example.com/api/claims/DEMO-MG1Z2K-7QX4/pdf?accessToken=…", "filename": "claim-DEMO-MG1Z2K-7QX4.pdf", "caption": "Your claim report" }`,
      response: `{ "status": "success", "message": "Document sent successfully to WhatsApp", "data": { "customerPhone": "+243810000001", "filename": "claim-DEMO-MG1Z2K-7QX4.pdf", "documentUrl": "…" } }`,
      errors: [
        ...INTERNAL_ERRORS,
        { status: 400, error: 'Invalid request payload / CustomerPhone, DocumentURL, and Filename are required', when: 'Bad body' },
        { status: 500, error: 'Failed to send WhatsApp document', when: 'Missing X-Company-ID, no settings or Graph API error' },
      ],
    },
    {
      method: 'POST', path: '/api/v1/internal/notifications/send', service: 'api', auth: 'internal',
      summary: 'Send a notification text',
      body: `{ "to": "+243810000001", "message": "Your claim document is ready.", "type": "pdf_notification" }`,
      response: `{ "success": true, "message": "Notification sent successfully", "type": "pdf_notification", "to": "+243810000001" }`,
      errors: [
        ...INTERNAL_ERRORS,
        { status: 400, error: 'Invalid request body / Phone number and message are required', when: 'Bad body' },
        { status: 400, error: 'company id is required (companyId or X-Company-ID) / WhatsApp is not configured for company …', when: 'No company or no WhatsApp credentials' },
        { status: 500, error: 'Failed to send notification', when: 'Graph API error' },
      ],
    },
    {
      method: 'POST', path: '/api/v1/internal/notifications/status-update', service: 'api', auth: 'internal',
      summary: 'Send the claim status message (and PDF)',
      description:
        'The text comes from the bot language templates of the company. Skipped (200, status "skipped") while the bot is paused on the customer conversation. With autoSendPdf the status PDF is sent afterwards. The company comes from companyId, X-Company-ID or the claim.',
      body: `{ "companyId": "…", "customerId": "…", "claimNumber": "DEMO-MG1Z2K-7QX4", "status": "APPROVED", "customerPhone": "+243810000001", "customerName": "Grace Mutombo", "autoGeneratePdf": true, "autoSendPdf": true }`,
      response: `{ "status": "success", "message": "Status update notification sent successfully", "data": { "claimNumber": "DEMO-MG1Z2K-7QX4", "status": "APPROVED", "language": "en", "customerPhone": "+243810000001", "pdfAutoTriggered": true } }
// bot paused:
{ "status": "skipped", "reason": "bot_paused", "message": "The bot is paused on this conversation; the status update was not sent", "data": { "claimNumber": "…", "language": "en" } }`,
      errors: [
        ...INTERNAL_ERRORS,
        { status: 400, error: 'Invalid request payload / CustomerPhone, ClaimNumber, and Status are required', when: 'Bad body' },
        { status: 400, error: 'WhatsApp is not configured for company …', when: 'No WhatsApp credentials (language included)' },
        { status: 500, error: 'Failed to send WhatsApp message', when: 'Graph API error' },
      ],
    },
    {
      method: 'POST', path: '/api/v1/internal/test-bot', service: 'api', auth: 'internal',
      summary: 'Run a sample claim extraction with the company AI provider',
      description: 'Sends a fixed sample conversation to the provider saved for the company and returns the extracted fields. Nothing is stored and no WhatsApp message is sent.',
      body: `{ "companyId": "…" }`,
      response: `{ "success": true, "extracted": { "insuredFullName": "Jean Dupont", "phoneNumber": "+243123456789", "incidentLocation": "Kinshasa", "vehicleMakeModel": "Toyota Corolla", "vehicleYear": 2020, "…": "…" } }`,
      errors: [
        ...INTERNAL_ERRORS,
        { status: 400, error: 'companyId is required', when: 'Missing companyId' },
        { status: 502, error: 'Provider test failed: …', when: 'Wrong key, model or base URL, quota exceeded…' },
        { status: 503, error: 'AI service is not available', when: 'AI service not initialised' },
      ],
    },
    {
      method: 'POST', path: '/api/v1/internal/test-policy-extraction', service: 'api', auth: 'internal',
      summary: 'Debug: extract a policy number from a message',
      body: `{ "message": "My policy is POL-2026-0042" }`,
      response: `{ "status": "success", "message": "Policy extraction test completed", "data": { "testMessage": "My policy is POL-2026-0042", "extractedPolicy": "POL-2026-0042", "found": true } }`,
      errors: INTERNAL_ERRORS,
    },
    {
      method: 'POST', path: '/api/v1/protected/notifications/send', service: 'api', auth: 'jwt',
      summary: 'Same as internal/notifications/send, with a dashboard JWT',
      description: 'Send X-Company-ID as well.',
      body: `{ "to": "+243810000001", "message": "Hello from the dashboard", "type": "manual" }`,
      response: `{ "success": true, "message": "Notification sent successfully", "type": "manual", "to": "+243810000001" }`,
      errors: [{ status: 401, error: 'Authorization header required / Invalid or expired token', when: 'Missing or invalid JWT (signed with JWT_ACCESS_SECRET)' }],
    },
    {
      method: 'POST', path: '/api/v1/protected/notifications/status-update', service: 'api', auth: 'jwt',
      summary: 'Same as internal/notifications/status-update, with a dashboard JWT',
      body: `{ "companyId": "…", "claimNumber": "DEMO-MG1Z2K-7QX4", "status": "ONGOING", "customerPhone": "+243810000001", "customerName": "Grace Mutombo" }`,
      response: `{ "status": "success", "message": "Status update notification sent successfully", "data": { "claimNumber": "DEMO-MG1Z2K-7QX4", "status": "ONGOING", "language": "en", "customerPhone": "+243810000001", "pdfAutoTriggered": false } }`,
      errors: [{ status: 401, error: 'Authorization header required / Invalid or expired token', when: 'Missing or invalid JWT' }],
    },
  ],
};
