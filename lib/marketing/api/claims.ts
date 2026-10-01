import { JWT_ERRORS, READ_ONLY_ERROR, type ApiError, type ApiGroup } from './types';

const CLAIM_ERRORS: ApiError[] = [
  ...JWT_ERRORS,
  { status: 404, error: 'Claim not found', when: 'Unknown claim number or a claim of another company' },
];
const UPLOAD_ERRORS: ApiError[] = [
  { status: 400, error: 'No file provided / Empty file', when: 'Missing or empty file field' },
  { status: 413, error: 'File exceeds 10 MB', when: 'File larger than 10 MB' },
  { status: 415, error: 'File type not allowed (images, PDF and Word documents only)', when: 'Type detected from the bytes is not allowed' },
];

const CLAIM_DETAIL = `{
  "success": true,
  "claim": {
    "id": "c4b1…", "claimNumber": "DEMO-MG1Z2K-7QX4", "type": "AUTO", "status": "ONGOING",
    "description": "Rear-ended at a traffic light on Boulevard du 30 Juin.",
    "estimatedAmount": 850, "approvedAmount": null,
    "incidentDate": "2026-09-28T00:00:00.000Z", "incidentTime": "08:30",
    "createdAt": "…", "updatedAt": "…", "approvedAt": null, "rejectedAt": null, "completedAt": null,
    "customer": { "id": "…", "firstName": "Grace", "lastName": "Mutombo", "phoneNumber": "+243810000001", "email": null },
    "assignedAdmin": null,
    "autoClaimData": { "insuredFullName": "Grace Mutombo", "policyNumber": "POL-2026-0042", "vehicleMakeModel": "Toyota Corolla", "incidentLocation": "Boulevard du 30 Juin, Kinshasa", "policeContacted": "false", "injuriesOccurred": "false", "…": "…" },
    "documents": [ { "id": "…", "fileName": "photo-1.jpg", "fileType": "image/jpeg", "fileSize": 182344, "uploadedBy": "whatsapp", "filePath": "/api/documents/c4b1…/…", "createdAt": "…" } ],
    "claimNotes": [ { "id": "…", "content": "Status changed from New to Ongoing", "isInternal": false, "author": { "id": "…", "firstName": "Amina", "lastName": "Diallo" }, "createdAt": "…", "updatedAt": "…" } ],
    "statusHistory": [ { "id": "…", "fromStatus": "NEW", "toStatus": "ONGOING", "reason": null, "changedBy": "…", "changedAt": "…" } ]
  }
}`;

export const claimsGroup: ApiGroup = {
  id: 'claims',
  title: 'Claims, PDFs and documents',
  description:
    'Claims are always scoped to your company. Claim statuses: NEW, ONGOING, APPROVED, REJECTED, COMPLETED. Claim categories: AUTO, HOME, HEALTH, LIFE, TRAVEL, … (OTHER when unknown). The /api/clients/{id}/claims/{claimNumber}/… routes ignore {id} for access control: the claim number and your company decide.',
  endpoints: [
    {
      method: 'GET', path: '/api/claims', service: 'dashboard', auth: 'jwt',
      summary: 'List claims of your company',
      params: [
        { name: 'customerId', in: 'query', type: 'uuid', description: 'Only claims of this customer.' },
        { name: 'phoneNumber', in: 'query', type: 'string', description: 'Only claims of the customer with this phone (normalised to E.164 with the company calling code). An invalid number returns an empty list.' },
      ],
      response: `{ "claims": [ { "id": "…", "claimNumber": "DEMO-MG1Z2K-7QX4", "type": "AUTO", "status": "NEW", "description": "…", "customer": { "…": "…" }, "autoClaimData": { "…": "…" }, "documents": [ { "id": "…", "fileName": "…", "fileType": "image/jpeg", "fileSize": 182344 } ], "createdAt": "…" } ] }`,
      errors: JWT_ERRORS,
      curl: `curl "$BASE/api/claims?phoneNumber=%2B243810000001" -H "Authorization: Bearer $TOKEN"`,
    },
    {
      method: 'POST', path: '/api/claims', service: 'dashboard', auth: 'jwt-or-internal',
      summary: 'Create a claim (dashboard or the WhatsApp bot)',
      description:
        'Creates or updates the customer (one customer per phone number per company), the claim, its AUTO details and, when claimTypeName matches a configured claim type, the dynamic field data with a completion percentage. Pending WhatsApp media of the customer are attached and the claim PDF is generated. With the internal key, X-Company-ID selects the company and X-WhatsApp-Phone (the sender number) overrides phoneNumber.',
      params: [
        { name: 'insuredFullName', in: 'body', type: 'string (1-200)', required: true, description: 'Name of the insured person.' },
        { name: 'phoneNumber', in: 'body', type: 'string', required: true, description: 'Customer phone, international format recommended (+243…).' },
        { name: 'claimCategory', in: 'body', type: 'string', description: 'AUTO (default), HOME, HEALTH, … Unknown values become OTHER.' },
        { name: 'claimTypeName / claimFields', in: 'body', type: 'string / object', description: 'Configured claim type and its field values.' },
        { name: 'policyNumber, address, email', in: 'body', type: 'string', description: 'Customer file fields (only replace existing values when listed in correctedFields).' },
        { name: 'incidentDate', in: 'body', type: 'YYYY-MM-DD', description: 'With incidentDateApproximate + incidentDateText for "around mid-September".' },
        { name: 'incidentTime, incidentLocation, incidentDescription, description, damageDescription', in: 'body', type: 'string', description: 'What happened.' },
        { name: 'vehicleMakeModel, vehicleYear, vehicleRegistration, vehicleVin, licenseNumber, policeReportNumber', in: 'body', type: 'string / number', description: 'Vehicle details (AUTO).' },
        { name: 'injuriesOccurred, policeContacted, medicalTreatmentRequired', in: 'body', type: 'boolean', description: 'Also accepts "yes"/"no".' },
        { name: 'language', in: 'body', type: 'string', description: 'Conversation language (ISO 639-1); used for the PDF.' },
        { name: 'source', in: 'body', type: 'string', description: '"whatsapp" adds a bot note on the claim.' },
      ],
      body: `{
  "insuredFullName": "Grace Mutombo",
  "phoneNumber": "+243810000001",
  "claimCategory": "AUTO",
  "policyNumber": "POL-2026-0042",
  "incidentDate": "2026-09-28",
  "incidentTime": "08:30",
  "incidentLocation": "Boulevard du 30 Juin, Kinshasa",
  "incidentDescription": "Rear-ended at a traffic light.",
  "vehicleMakeModel": "Toyota Corolla",
  "injuriesOccurred": false,
  "language": "en"
}`,
      successStatus: 201,
      response: `{
  "success": true,
  "claim": { "id": "…", "claimNumber": "DEMO-MG1Z2K-7QX4", "type": "AUTO", "status": "NEW", "customer": { "…": "…" }, "autoClaimData": { "…": "…" }, "pdfPath": "/api/claims/DEMO-MG1Z2K-7QX4/pdf" },
  "pdf": { "documentId": "…", "fileName": "claim-DEMO-MG1Z2K-7QX4.pdf", "size": 117000, "locale": "en", "url": "/api/documents/…/…" }
}`,
      errors: [
        ...JWT_ERRORS, READ_ONLY_ERROR,
        { status: 400, error: 'Invalid claim data', when: 'Schema validation failed (details.fieldErrors)' },
        { status: 400, error: 'Invalid JSON body', when: 'Body is not JSON' },
        { status: 400, error: 'Invalid phone number: use the international format, e.g. +243812345678', when: 'Phone cannot be normalised' },
        { status: 403, error: 'Company context is required', when: 'Internal key without X-Company-ID' },
        { status: 404, error: 'Company not found', when: 'Unknown or inactive company' },
        { status: 409, error: 'Unable to allocate a claim number; please retry', when: 'Claim number collision' },
      ],
    },
    {
      method: 'GET', path: '/api/claims/{claimNumber}/pdf', service: 'dashboard', auth: 'jwt-or-pdf-token',
      summary: 'Download the claim report PDF',
      description: 'Serves the stored report PDF, generating it first when missing. Accepts a dashboard token, or ?accessToken= (a 24-hour signed link the bot sends over WhatsApp).',
      params: [
        { name: 'claimNumber', in: 'path', type: 'string', required: true, description: 'Claim number.' },
        { name: 'download', in: 'query', type: '1', description: 'Content-Disposition: attachment instead of inline.' },
        { name: 'regenerate', in: 'query', type: '1', description: 'Dashboard only: re-render and store before serving.' },
        { name: 'lang', in: 'query', type: 'string', description: 'Dashboard only: render in another language without storing.' },
        { name: 'accessToken', in: 'query', type: 'string', description: 'Signed PDF link token (instead of a Bearer token).' },
      ],
      response: 'application/pdf (binary)',
      errors: [...CLAIM_ERRORS, { status: 401, error: 'Invalid or expired access token', when: 'Bad ?accessToken' }, { status: 500, error: 'Failed to generate PDF', when: 'Rendering failed' }],
      curl: `curl -o claim.pdf "$BASE/api/claims/DEMO-MG1Z2K-7QX4/pdf?download=1" -H "Authorization: Bearer $TOKEN"`,
    },
    {
      method: 'POST', path: '/api/claims/{claimNumber}/pdf', service: 'dashboard', auth: 'jwt',
      summary: 'Regenerate and store the report PDF',
      response: `{ "success": true, "documentId": "…", "fileName": "claim-DEMO-MG1Z2K-7QX4.pdf", "size": 117000, "locale": "en", "url": "/api/documents/…/…", "pdfPath": "/api/claims/DEMO-MG1Z2K-7QX4/pdf" }`,
      errors: [...CLAIM_ERRORS, READ_ONLY_ERROR, { status: 500, error: 'Failed to generate PDF', when: 'Rendering failed' }],
    },
    {
      method: 'GET', path: '/api/claims/{claimNumber}/status-pdf', service: 'dashboard', auth: 'jwt-or-pdf-token',
      summary: 'Download the status-update PDF',
      description: 'Same query parameters as the report PDF.',
      response: 'application/pdf (binary)',
      errors: CLAIM_ERRORS,
    },
    {
      method: 'GET', path: '/api/claims/{claimNumber}/status-update', service: 'dashboard', auth: 'jwt-or-pdf-token',
      summary: 'Status-update PDF (alias of GET …/status-pdf)',
      response: 'application/pdf (binary)',
      errors: CLAIM_ERRORS,
    },
    {
      method: 'POST', path: '/api/claims/{claimNumber}/status-pdf', service: 'dashboard', auth: 'jwt',
      summary: 'Regenerate and store the status PDF',
      response: `{ "success": true, "documentId": "…", "fileName": "…", "size": 52000, "locale": "en", "url": "/api/documents/…/…", "pdfPath": "/api/claims/DEMO-MG1Z2K-7QX4/pdf" }`,
      errors: [...CLAIM_ERRORS, READ_ONLY_ERROR],
    },
    {
      method: 'GET', path: '/api/claims/{claimNumber}/documents', service: 'dashboard', auth: 'jwt',
      summary: 'List the documents of a claim',
      response: `{ "success": true, "documents": [ { "id": "…", "fileName": "photo-1.jpg", "fileType": "image/jpeg", "fileSize": 182344, "uploadedBy": "whatsapp", "createdAt": "…", "url": "/api/documents/<claimId>/<documentId>" } ] }`,
      errors: CLAIM_ERRORS,
    },
    {
      method: 'GET', path: '/api/claims/{claimNumber}/image', service: 'dashboard', auth: 'jwt',
      summary: 'Get an image of a claim',
      params: [{ name: 'index', in: 'query', type: 'number', description: 'Zero-based image index, oldest first (default 0).' }],
      response: 'image/* (binary, inline, Cache-Control: private, no-store)',
      errors: [...CLAIM_ERRORS, { status: 404, error: 'No image found', when: 'The claim has no image' }],
    },
    {
      method: 'GET', path: '/api/documents/{claimId}/{documentId}', service: 'dashboard', auth: 'jwt',
      summary: 'Download or preview a claim document',
      description: 'Images and PDFs are served inline; other types (and ?download=1) as an attachment.',
      params: [
        { name: 'claimId / documentId', in: 'path', type: 'uuid', required: true, description: 'Ids from the claim documents list.' },
        { name: 'download', in: 'query', type: '1', description: 'Force attachment.' },
      ],
      response: 'The file bytes with its Content-Type',
      errors: [...JWT_ERRORS, { status: 404, error: 'Document not found / Document file is missing', when: 'Unknown document, document of another company, or file deleted from storage' }],
    },
    {
      method: 'GET', path: '/api/claims/media/upload', service: 'dashboard', auth: 'jwt',
      summary: 'List the media files of a claim',
      params: [{ name: 'claimId', in: 'query', type: 'uuid', required: true, description: 'Claim id.' }],
      response: `{ "success": true, "data": { "claimId": "…", "totalFiles": 1, "files": [ { "id": "…", "fileName": "photo-1.jpg", "filePath": "/api/documents/…/…", "fileType": "image/jpeg", "fileSize": 182344, "category": "image", "uploadedBy": "whatsapp", "uploadedAt": "…", "claimNumber": "…" } ] } }`,
      errors: [...JWT_ERRORS, { status: 400, error: 'claimId parameter is required', when: 'Missing claimId' }, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'POST', path: '/api/claims/media/upload', service: 'dashboard', auth: 'jwt',
      summary: 'Upload files to a claim as base64 JSON',
      description: 'Up to 10 files of at most 10 MB each. Files with a bad type are reported in data.errors; the others are stored. Regenerates the claim PDF.',
      body: `{
  "claimId": "c4b1…",
  "files": [ { "name": "photo-1.jpg", "type": "image/jpeg", "size": 182344, "data": "<base64 or data URL>" } ]
}`,
      response: `{ "success": true, "message": "Successfully uploaded 1 files", "data": { "claimId": "…", "claimNumber": "…", "uploadedFiles": [ { "id": "…", "fileName": "photo-1.jpg", "filePath": "/api/documents/…/…", "fileType": "image/jpeg", "fileSize": 182344, "category": "image", "uploadedAt": "…" } ], "totalUploaded": 1, "totalErrors": 0 } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: 'Invalid request data', when: 'Schema validation failed (details)' }, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'GET', path: '/api/clients/{id}/claims/{claimNumber}', service: 'dashboard', auth: 'jwt',
      summary: 'Claim detail (customer, documents, notes, status history)',
      response: CLAIM_DETAIL,
      errors: [...JWT_ERRORS, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'PUT', path: '/api/clients/{id}/claims/{claimNumber}', service: 'dashboard', auth: 'jwt',
      summary: 'Edit a claim',
      description: 'Only the fields you send change. autoClaimData accepts policyNumber, insuredFullName, phoneNumber, address, email, licenseNumber, vehicleMakeModel, vehicleYear, vehicleRegistration, vehicleVin, incidentLocation, roadType, otherDriverName, otherDriverPhone, otherInsuranceCompany, otherPolicyNumber, otherVehicleRegistration, witnessName, witnessPhone, policeReportNumber, damageDescription, estimatedRepairCost, injuryDescription, additionalNotes, totalPhotosUploaded, birthDate and the booleans policeContacted, injuriesOccurred, medicalTreatmentRequired.',
      params: [
        { name: 'description, notes, incidentTime', in: 'body', type: 'string', description: 'Claim fields.' },
        { name: 'estimatedAmount, approvedAmount', in: 'body', type: 'number', description: 'Amounts.' },
        { name: 'incidentDate', in: 'body', type: 'ISO date', description: 'Incident date.' },
        { name: 'autoClaimData', in: 'body', type: 'object', description: 'AUTO details (see above).' },
      ],
      body: `{ "estimatedAmount": 850, "notes": "Garage quote received", "autoClaimData": { "vehicleRegistration": "KN-1234-AB" } }`,
      response: CLAIM_DETAIL,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'PUT', path: '/api/clients/{id}/claims/{claimNumber}/status', service: 'dashboard', auth: 'jwt',
      summary: 'Change the status of a claim',
      description:
        'Records the status history and a note, regenerates the report and status PDFs and, when "Notify customers of status updates" is on, sends the customer a WhatsApp message with the PDF (unless the bot is paused on the conversation: notification.skipped = "bot_paused").',
      params: [
        { name: 'status', in: 'body', type: 'NEW | ONGOING | APPROVED | REJECTED | COMPLETED', required: true, description: 'New status.' },
        { name: 'reason', in: 'body', type: 'string', description: 'Optional reason, added to the note and history.' },
      ],
      body: `{ "status": "APPROVED", "reason": "Repair quote accepted" }`,
      response: `{
  "success": true,
  "message": "Status updated successfully",
  "notification": { "sent": true, "language": "en" },
  "pdf": { "report": { "documentId": "…", "url": "…" }, "status": { "documentId": "…", "url": "…" } },
  "claim": { "id": "…", "claimNumber": "DEMO-MG1Z2K-7QX4", "status": "APPROVED", "updatedAt": "…" }
}`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: 'Invalid status', when: 'Unknown status' }, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'POST', path: '/api/clients/{id}/claims/{claimNumber}/notes', service: 'dashboard', auth: 'jwt',
      summary: 'Add a note to a claim',
      body: `{ "content": "Called the customer, garage visit on Monday.", "isInternal": true }`,
      response: `{ "success": true, "note": { "id": "…", "content": "Called the customer, garage visit on Monday.", "isInternal": true, "createdAt": "…", "author": { "id": "…", "firstName": "Amina", "lastName": "Diallo", "email": "…", "role": "ADMIN" } } }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: 'Note content is required', when: 'Empty content' }, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'GET', path: '/api/clients/{id}/claims/{claimNumber}/documents', service: 'dashboard', auth: 'jwt',
      summary: 'Documents of a claim, grouped by kind',
      response: `{
  "success": true,
  "claim": { "id": "…", "claimNumber": "…", "type": "AUTO", "status": "NEW" },
  "documents": {
    "images": [ { "id": "…", "fileName": "photo-1.jpg", "fileType": "image/jpeg", "fileSize": 182344, "category": "image", "previewUrl": "/api/documents/…/…", "downloadUrl": "/api/documents/…/…?download=1", "canPreview": true, "icon": "image" } ],
    "pdfs": [], "documents": [], "all": [ "…" ]
  },
  "totalCount": 1
}`,
      errors: [...JWT_ERRORS, { status: 404, error: 'Claim not found', when: 'Unknown claim or another company' }],
    },
    {
      method: 'POST', path: '/api/clients/{id}/claims/{claimNumber}/upload', service: 'dashboard', auth: 'jwt',
      summary: 'Upload a file to a claim (multipart)',
      description: 'Images, PDF and Word documents up to 10 MB. The type is detected from the bytes. Regenerates the claim PDF.',
      form: { file: '@damage.jpg' },
      response: `{ "success": true, "document": { "id": "…", "fileName": "damage.jpg", "fileType": "image/jpeg", "fileSize": 182344, "filePath": "/api/documents/…/…" }, "message": "File uploaded successfully" }`,
      errors: [...CLAIM_ERRORS, READ_ONLY_ERROR, ...UPLOAD_ERRORS],
    },
    {
      method: 'GET', path: '/api/clients/{id}/claims/{claimNumber}/pdf', service: 'dashboard', auth: 'jwt-or-pdf-token',
      summary: 'Report PDF (same as /api/claims/{claimNumber}/pdf)',
      response: 'application/pdf (binary)',
      errors: CLAIM_ERRORS,
    },
    {
      method: 'POST', path: '/api/clients/{id}/claims/{claimNumber}/pdf', service: 'dashboard', auth: 'jwt',
      summary: 'Regenerate the report PDF (client path)',
      response: `{ "success": true, "documentId": "…", "fileName": "…", "size": 117000, "locale": "en", "url": "/api/documents/…/…", "pdfPath": "/api/claims/DEMO-MG1Z2K-7QX4/pdf" }`,
      errors: [...CLAIM_ERRORS, READ_ONLY_ERROR],
    },
    {
      method: 'POST', path: '/api/clients/{id}/claims/{claimNumber}/generate-pdf', service: 'dashboard', auth: 'jwt',
      summary: 'Regenerate the report PDF (alias used by the claim page)',
      response: `{ "success": true, "documentId": "…", "fileName": "…", "size": 117000, "locale": "en", "url": "/api/documents/…/…", "pdfPath": "/api/claims/DEMO-MG1Z2K-7QX4/pdf" }`,
      errors: [...CLAIM_ERRORS, READ_ONLY_ERROR],
    },
    {
      method: 'POST', path: '/api/customers/pdf/send', service: 'dashboard', auth: 'jwt',
      summary: 'Legacy PDF send (no-op)',
      description: 'Kept for older clients: it validates the request and answers success but does not send anything. Use POST /api/customers/pdf/retrieve to send the PDF.',
      body: `{ "claimNumber": "DEMO-MG1Z2K-7QX4", "reason": "customer_requested" }`,
      response: `{ "success": true, "message": "PDF sent successfully for claim DEMO-MG1Z2K-7QX4" }`,
      errors: [...JWT_ERRORS, READ_ONLY_ERROR, { status: 400, error: 'Claim number is required', when: 'Missing claimNumber' }],
    },
    {
      method: 'POST', path: '/api/customers/pdf/retrieve', service: 'dashboard', auth: 'jwt-or-internal',
      summary: 'Send the claim PDF to the customer on WhatsApp',
      description: 'Uses the stored report PDF (generated when missing) and asks the Go API to send it as a WhatsApp document with a 24-hour signed link. With the internal key (automated sends) nothing is sent while the bot is paused on the customer conversation.',
      params: [
        { name: 'claimNumber', in: 'body', type: 'string', required: true, description: 'Claim number in your company.' },
        { name: 'reason', in: 'body', type: 'claim_created | status_updated | notes_added | customer_requested', description: 'Default status_updated; selects the message text.' },
      ],
      body: `{ "claimNumber": "DEMO-MG1Z2K-7QX4", "reason": "customer_requested" }`,
      response: `{ "success": true, "message": "PDF sent successfully to customer" }
// or, for an automated send while support paused the bot:
{ "success": true, "skipped": "bot_paused" }`,
      errors: [
        ...JWT_ERRORS,
        { status: 403, error: 'Company context is required', when: 'Internal key without X-Company-ID' },
        { status: 400, error: 'Claim number is required / Invalid reason / Customer phone number not found', when: 'Bad input or no customer phone' },
        { status: 404, error: 'Claim not found', when: 'Unknown claim in this company' },
        { status: 500, error: 'Failed to generate PDF / Failed to send PDF to customer', when: 'Rendering or WhatsApp send failed' },
      ],
    },
    {
      method: 'POST', path: '/api/admin/pdf-bulk-generate', service: 'dashboard', auth: 'jwt', roles: 'SUPER_ADMIN, ADMIN',
      summary: 'Generate missing report PDFs for every claim',
      body: `{ "action": "generate-all" }`,
      response: `{ "success": true, "message": "PDF generation process completed", "summary": { "total": 12, "generated": 3, "skipped": 9, "errors": 0 } }`,
      errors: [...JWT_ERRORS, { status: 403, error: 'Insufficient role permissions', when: 'Not an admin' }, { status: 400, error: 'Invalid action', when: 'action is not "generate-all"' }],
    },
  ],
};
