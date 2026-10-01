import { JWT_ERRORS, MODERATION, READ_ONLY_ERROR, ROLE_ERROR, type ApiError, type ApiGroup } from './types';

const CONV_404: ApiError = { status: 404, error: 'Conversation not found', when: 'Unknown id or another company' };
const BAD_ID: ApiError = { status: 400, error: 'Invalid conversation ID format', when: 'id is not a UUID' };

export const customersGroup: ApiGroup = {
  id: 'customers',
  title: 'Clients (customers)',
  description:
    'A client is one WhatsApp phone number in your company; every claim of that number is attached to the same client. Phone numbers are stored in E.164 (+243…); local numbers are completed with the company calling code.',
  endpoints: [
    {
      method: 'GET', path: '/api/clients', service: 'dashboard', auth: 'jwt',
      summary: 'List clients with their claims and notes',
      response: `{
  "success": true,
  "clients": [
    { "id": "…", "phoneNumber": "+243810000001", "firstName": "Grace", "lastName": "Mutombo", "email": "", "isActive": true,
      "createdAt": "…", "updatedAt": "…",
      "claims": [ { "id": "…", "claimNumber": "DEMO-MG1Z2K-7QX4", "status": "NEW", "type": "AUTO", "description": "…", "amount": null,
                    "createdAt": "…", "updatedAt": "…", "notes": [ { "id": "…", "content": "…", "createdAt": "…", "author": { "firstName": "…", "lastName": "…", "email": "…" } } ] } ] }
  ]
}`,
      errors: JWT_ERRORS,
    },
    {
      method: 'GET', path: '/api/clients/{id}', service: 'dashboard', auth: 'jwt',
      summary: 'One client with claims and notes',
      response: `{ "success": true, "client": { "id": "…", "phoneNumber": "+243810000001", "firstName": "Grace", "lastName": "Mutombo", "email": "", "isActive": true, "claims": [ "…same shape as the list…" ] } }`,
      errors: [...JWT_ERRORS, { status: 404, error: 'Client not found', when: 'Unknown id or another company' }],
    },
    {
      method: 'POST', path: '/api/clients/{id}', service: 'dashboard', auth: 'jwt',
      summary: 'Add a note to one of the client\'s claims',
      body: `{ "claimId": "c4b1…", "content": "Customer sent the garage quote." }`,
      response: `{ "success": true, "note": { "id": "…", "content": "Customer sent the garage quote.", "createdAt": "…", "author": { "firstName": "Amina", "lastName": "Diallo", "email": "…" } } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: 'claimId and content are required', when: 'Missing field' }, { status: 404, error: 'Client not found / Claim not found', when: 'Unknown client, or the claim is not this client\'s' }],
    },
    {
      method: 'POST', path: '/api/clients', service: 'dashboard', auth: 'jwt',
      summary: 'Add a note to a claim (by claim id)',
      body: `{ "claimId": "c4b1…", "content": "Assessor visit booked." }`,
      response: `{ "success": true, "note": { "id": "…", "content": "Assessor visit booked.", "createdAt": "…", "author": { "firstName": "…", "lastName": "…", "email": "…" } } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: 'claimId and content are required', when: 'Missing field' }, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'GET', path: '/api/agents/customers', service: 'dashboard', auth: 'jwt',
      summary: 'List customers with their 5 latest claims',
      response: `{ "success": true, "customers": [ { "id": "…", "firstName": "Grace", "lastName": "Mutombo", "phoneNumber": "+243810000001", "email": null, "isActive": true, "createdAt": "…", "claims": [ { "id": "…", "claimNumber": "…", "status": "NEW", "type": "AUTO", "description": "…", "incidentDate": "…", "createdAt": "…" } ] } ] }`,
      errors: JWT_ERRORS,
    },
    {
      method: 'POST', path: '/api/agents/customers', service: 'dashboard', auth: 'jwt',
      summary: 'Create a customer (or return the existing one for that phone)',
      body: `{ "firstName": "Grace", "lastName": "Mutombo", "phoneNumber": "+243810000001", "email": "grace@example.com" }`,
      response: `{ "success": true, "existing": false, "customer": { "id": "…", "firstName": "Grace", "lastName": "Mutombo", "phoneNumber": "+243810000001", "email": "grace@example.com", "isActive": true, "createdAt": "…" } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: '(French message) first name, last name and phone are required / invalid phone number', when: 'Missing field or phone not in international format' }],
    },
    {
      method: 'PUT', path: '/api/agents/customers/{id}', service: 'dashboard', auth: 'jwt',
      summary: 'Update a customer',
      body: `{ "firstName": "Grace", "lastName": "Mutombo", "phoneNumber": "+243810000001", "email": "", "isActive": true }`,
      response: `{ "success": true, "customer": { "id": "…", "firstName": "Grace", "lastName": "Mutombo", "phoneNumber": "+243810000001", "email": null, "isActive": true, "createdAt": "…", "updatedAt": "…" } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: '(French message)', when: 'Missing name/phone, invalid phone or email' }, { status: 404, error: 'Client non trouvé', when: 'Unknown customer' }, { status: 409, error: '(French message) phone already used', when: 'Another customer has this phone' }],
    },
    {
      method: 'DELETE', path: '/api/agents/customers/{id}', service: 'dashboard', auth: 'jwt', roles: MODERATION,
      summary: 'Delete a customer without claims',
      response: `{ "success": true, "message": "Client supprimé avec succès" }`,
      errors: [...JWT_ERRORS, ROLE_ERROR, { status: 400, error: '(French message) customer has claims', when: 'Customers with claims cannot be deleted' }, { status: 404, error: 'Client non trouvé', when: 'Unknown customer' }],
    },
    {
      method: 'GET', path: '/api/agents/claims', service: 'dashboard', auth: 'jwt',
      summary: 'Compact list of claims with customer name and phone',
      response: `{ "success": true, "claims": [ { "id": "…", "claimNumber": "…", "status": "NEW", "type": "AUTO", "description": "…", "incidentDate": "…", "createdAt": "…", "customer": { "firstName": "Grace", "lastName": "Mutombo", "phoneNumber": "+243810000001" } } ] }`,
      errors: JWT_ERRORS,
    },
    {
      method: 'POST', path: '/api/agents/claims', service: 'dashboard', auth: 'jwt',
      summary: 'Create a simple AUTO claim for an existing customer (legacy)',
      description: 'Prefer POST /api/claims, which supports every coverage and the full claim data.',
      body: `{ "customerId": "…", "type": "Auto", "description": "Windscreen cracked by a stone", "incidentDate": "2026-09-30" }`,
      response: `{ "success": true, "claim": { "id": "…", "claimNumber": "ACT-2026-0007", "status": "NEW", "type": "AUTO", "description": "…", "incidentDate": "…", "createdAt": "…", "customer": { "…": "…" } } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: '(French message)', when: 'Missing customerId/type/description or type other than "Auto"' }, { status: 404, error: 'Client non trouvé', when: 'Unknown customer' }],
    },
  ],
};

export const conversationsGroup: ApiGroup = {
  id: 'conversations',
  title: 'Conversations and messages',
  description:
    'WhatsApp conversations between your customers and the bot or your staff. Message roles: user (customer), assistant (bot), agent (staff), system. While the bot is paused on a conversation it neither answers nor sends automated status messages.',
  endpoints: [
    {
      method: 'GET', path: '/api/conversations', service: 'dashboard', auth: 'jwt',
      summary: 'Latest active conversation of up to 50 customers',
      response: `{
  "customers": [
    { "id": "…", "phoneNumber": "+243810000001", "firstName": "Grace", "lastName": "Mutombo", "conversations": [ { "id": "…", "messages": [ "…5 latest…" ] } ],
      "lastMessage": { "id": "…", "content": "Thank you!", "role": "user", "createdAt": "…" },
      "needsAttention": false,
      "conversationMeta": { "id": "…", "isEscalated": false, "isBotPaused": false, "pausedBy": null, "pausedAt": null } }
  ],
  "total": 1
}`,
      errors: [...JWT_ERRORS, { status: 503, error: 'Database connection failed', when: 'Database unreachable' }],
    },
    {
      method: 'POST', path: '/api/conversations', service: 'dashboard', auth: 'jwt',
      summary: 'Start a conversation with a customer',
      body: `{ "customerId": "…", "title": "Follow-up on claim DEMO-MG1Z2K-7QX4" }`,
      response: `{ "message": "Conversation created successfully", "conversation": { "id": "…", "title": "…", "customer": { "id": "…", "firstName": "…", "lastName": "…", "phoneNumber": "…" }, "messages": [] } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR],
    },
    {
      method: 'GET', path: '/api/conversations/{id}', service: 'dashboard', auth: 'jwt',
      summary: 'A conversation with its messages',
      params: [
        { name: 'page', in: 'query', type: 'number', description: 'Default 1.' },
        { name: 'limit', in: 'query', type: 'number (max 200)', description: 'Default 200.' },
        { name: 'sortOrder', in: 'query', type: 'asc | desc', description: 'Default asc (chronological).' },
      ],
      response: `{
  "conversation": {
    "id": "…", "title": "Conversation with Grace Mutombo", "isActive": true, "isEscalated": false, "isBotPaused": false, "pausedBy": null, "pausedAt": null,
    "createdAt": "…", "updatedAt": "…",
    "customer": { "id": "…", "phoneNumber": "+243810000001", "firstName": "Grace", "lastName": "Mutombo", "email": null },
    "messages": [ { "id": "…", "content": "Hello, I had an accident this morning", "role": "user", "metadata": { "…": "…" }, "createdAt": "…" } ]
  },
  "pagination": { "currentPage": 1, "totalPages": 1, "totalCount": 12, "hasNextPage": false, "hasPreviousPage": false }
}`,
      errors: [...JWT_ERRORS, BAD_ID, { status: 400, error: 'Invalid pagination parameters', when: 'page/limit out of range' }, CONV_404],
    },
    {
      method: 'PUT', path: '/api/conversations/{id}', service: 'dashboard', auth: 'jwt',
      summary: 'Rename or (re)activate a conversation',
      body: `{ "title": "Windscreen claim", "isActive": true }`,
      response: `{ "message": "Conversation updated successfully", "conversation": { "id": "…", "title": "Windscreen claim", "isActive": true, "createdAt": "…", "updatedAt": "…", "customer": { "…": "…" } } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, BAD_ID, { status: 400, error: 'No valid fields to update', when: 'Only title and isActive can change' }, CONV_404],
    },
    {
      method: 'DELETE', path: '/api/conversations/{id}', service: 'dashboard', auth: 'jwt', roles: MODERATION,
      summary: 'Archive a conversation',
      description: 'Sets isActive to false; messages are kept.',
      response: `{ "message": "Conversation archived successfully" }`,
      errors: [...JWT_ERRORS, ROLE_ERROR, BAD_ID, CONV_404],
    },
    {
      method: 'POST', path: '/api/conversations/{id}/pause-bot', service: 'dashboard', auth: 'jwt',
      summary: 'Pause or resume the bot on a conversation',
      body: `{ "paused": true }`,
      response: `{ "message": "Bot paused successfully", "conversation": { "id": "…", "isBotPaused": true, "pausedBy": "<your user id>", "pausedAt": "…", "customer": { "…": "…" }, "messages": [ "…latest…" ] } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: '"paused" must be true or false', when: 'Missing or non-boolean paused' }, CONV_404],
    },
    {
      method: 'POST', path: '/api/conversations/{id}/unpause-bot', service: 'dashboard', auth: 'jwt',
      summary: 'Resume the bot',
      response: `{ "success": true }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, CONV_404],
    },
    {
      method: 'POST', path: '/api/conversations/{id}/remove-urgent', service: 'dashboard', auth: 'jwt',
      summary: 'Take an escalated (urgent) conversation',
      description: 'Clears isEscalated and adds a system message saying who took it.',
      response: `{ "message": "Conversation removed from urgent queue and moved to current conversations", "conversation": { "…": "…" }, "dismissedBy": "amina@demo-assurance.example.com", "dismissedAt": "…", "escalationStatus": false }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, CONV_404],
    },
    {
      method: 'POST', path: '/api/send-message', service: 'dashboard', auth: 'jwt',
      summary: 'Send a WhatsApp message to a customer as staff',
      description:
        'Stores the message, then asks the Go API (POST /api/v1/internal/send-message) to deliver it with your company WhatsApp credentials. Give customerId (optionally with conversationId) or phoneNumber; the latest active conversation is used or a new one is created. Unknown body fields are rejected.',
      params: [
        { name: 'customerId', in: 'body', type: 'uuid', description: 'Customer id (or phoneNumber).' },
        { name: 'phoneNumber', in: 'body', type: 'string', description: 'Customer phone (or customerId).' },
        { name: 'conversationId', in: 'body', type: 'uuid', description: 'Optional, with customerId.' },
        { name: 'content (or message)', in: 'body', type: 'string (1-4000)', required: true, description: 'Text to send.' },
        { name: 'role', in: 'body', type: 'agent | assistant | user | system', description: 'Stored role; the dashboard sends agent. Default assistant.' },
      ],
      body: `{ "customerId": "…", "content": "Hello Grace, an assessor will call you today.", "role": "agent" }`,
      successStatus: 201,
      response: `{ "message": "Message sent successfully", "data": { "messageId": "…", "conversationId": "…", "message": { "id": "…", "content": "Hello Grace, …", "role": "agent", "createdAt": "…", "metadata": { "sentBy": "admin", "adminId": "…", "timestamp": "…" } }, "conversation": { "id": "…", "title": "…", "customerId": "…" } } }`,
      errors: [
        ...JWT_ERRORS, READ_ONLY_ERROR,
        { status: 400, error: 'Validation failed', when: 'Bad ids, phone, length or unknown fields (details)' },
        { status: 400, error: 'Either phoneNumber or customerId is required', when: 'No recipient' },
        { status: 404, error: 'Customer not found… / Conversation not found or not accessible', when: 'Unknown recipient in your company' },
        { status: 500, error: 'Failed to send WhatsApp message: … / Failed to communicate with WhatsApp backend', when: 'WhatsApp or Go API error (the message is already stored)' },
      ],
    },
  ],
};

export const mediaGroup: ApiGroup = {
  id: 'media',
  title: 'WhatsApp media (service routes)',
  description:
    'Called by the Go API while the bot handles a conversation, with X-Internal-API-Key and X-Company-ID. Photos sent before a claim exists are kept as pending media of the customer and attached when the claim is created.',
  endpoints: [
    {
      method: 'POST', path: '/api/media/upload', service: 'dashboard', auth: 'jwt-or-internal',
      summary: 'Store a photo or document for a claim (or as pending media)',
      description:
        'Dashboard callers must give claimNumber. Service callers give customerId (and optionally claimNumber); without a claim number the file goes to the customer\'s open claim (NEW/ONGOING) or, with pending=true or when there is none, to pending media. X-WhatsApp-Phone, when sent, must match the customer.',
      params: [
        { name: 'file', in: 'form', type: 'file', required: true, description: 'Image, PDF or Word document, max 10 MB.' },
        { name: 'claimNumber', in: 'form', type: 'string', description: 'Target claim (required for dashboard callers). "temp_<customerId>" means pending.' },
        { name: 'customerId', in: 'form', type: 'uuid', description: 'Service callers: the customer the media belongs to.' },
        { name: 'pending', in: 'form', type: '"true"', description: 'Service callers: store as pending even if a claim is open.' },
        { name: 'X-Company-ID / X-WhatsApp-Phone', in: 'header', type: 'string', description: 'Service callers only.' },
      ],
      form: { file: '@photo.jpg', customerId: '<customer uuid>', pending: 'true' },
      response: `{ "success": true, "pending": false, "url": "/api/documents/<claimId>/<documentId>", "documentId": "…", "claimNumber": "DEMO-MG1Z2K-7QX4", "fileName": "photo.jpg", "size": 182344, "mimeType": "image/jpeg" }
// pending media:
{ "success": true, "pending": true, "url": null, "documentId": null, "claimNumber": null, "fileName": "photo.jpg", "size": 182344, "mimeType": "image/jpeg" }`,
      errors: [
        { status: 400, error: 'X-Company-ID is required / customerId is required / claimNumber is required / No file provided', when: 'Missing input' },
        { status: 403, error: 'Company not found or inactive / Customer not found in this company / Customer does not match the WhatsApp number', when: 'Service caller tenant checks' },
        { status: 404, error: 'Claim not found', when: 'Unknown claim number or a claim of another company' },
        { status: 413, error: 'File exceeds 10 MB', when: 'Too large' },
        { status: 415, error: 'File type not allowed (images, PDF and Word documents only)', when: 'Bad type' },
      ],
      curl: `curl -X POST "$BASE/api/media/upload" \\
  -H "X-Internal-API-Key: $INTERNAL_API_KEY" \\
  -H "X-Company-ID: $COMPANY_ID" \\
  -F "file=@photo.jpg" -F "customerId=<customer uuid>" -F "pending=true"`,
    },
    {
      method: 'POST', path: '/api/media/discard-pending', service: 'dashboard', auth: 'internal',
      summary: 'Delete the pending media of a customer',
      description: 'Used when the customer cancels a claim before it is created.',
      body: `{ "customerId": "<customer uuid>" }`,
      response: `{ "success": true, "discarded": 2 }`,
      errors: [
        { status: 401, error: 'Unauthorized', when: 'Missing or wrong internal key' },
        { status: 400, error: 'X-Company-ID is required / customerId is required / Invalid JSON body', when: 'Bad input' },
        { status: 404, error: 'Customer not found in this company', when: 'Unknown customer' },
      ],
    },
    {
      method: 'GET', path: '/api/claims/{claimNumber}/whatsapp-media', service: 'dashboard', auth: 'none',
      summary: 'Placeholder (always ok)',
      response: `{ "ok": true }`,
    },
    {
      method: 'POST', path: '/api/claims/{claimNumber}/whatsapp-media', service: 'dashboard', auth: 'none',
      summary: 'Placeholder (echo)',
      description: 'Not used by the bot: it stores nothing and echoes the body. Kept for compatibility; use /api/media/upload.',
      body: `{ "any": "json" }`,
      response: `{ "success": true, "claimNumber": "…", "received": { "any": "json" } }`,
    },
  ],
};
