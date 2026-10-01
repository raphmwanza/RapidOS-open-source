import { ADMIN_ONLY, JWT_ERRORS, ROLE_ERROR, type ApiGroup } from './types';

export const authGroup: ApiGroup = {
  id: 'auth',
  title: 'Authentication and accounts',
  description:
    'Sign up a company, sign in, refresh and revoke sessions. Access tokens are short-lived JWTs (JWT_EXPIRES_IN, default 15 minutes) sent as Authorization: Bearer. The refresh token lives in an httpOnly, SameSite=Strict cookie named refreshToken and is rotated on every refresh. One active session per account: a new sign-in revokes the older session, whose access and refresh tokens then fail with 401 code session_replaced.',
  endpoints: [
    {
      method: 'POST', path: '/api/signup', service: 'dashboard', auth: 'none',
      summary: 'Create a company and its super admin',
      description:
        'Creates the company, a SUPER_ADMIN account, the chatbot configuration, the selected coverage (claim types and fields), behaviour toggles and knowledge settings in one transaction. The password is generated on the server and returned once; it is never stored in plain text or logged. Rate limited per client IP (SIGNUP_RATE_LIMIT_PER_HOUR, default 5).',
      params: [
        { name: 'companyName', in: 'body', type: 'string (2-120)', required: true, description: 'Company name, unique (case-insensitive).' },
        { name: 'slug', in: 'body', type: 'string', description: 'Lowercase letters, digits and dashes, at least 3 characters. Derived from the name when omitted.' },
        { name: 'domain', in: 'body', type: 'string', description: 'Optional company domain. Defaults to <slug>.local.' },
        { name: 'contactEmail / contactPhone', in: 'body', type: 'string', required: true, description: 'Public contact details the bot can share.' },
        { name: 'country / city', in: 'body', type: 'string', required: true, description: 'Used for the default calling code and knowledge.' },
        { name: 'address, logoUrl, primaryColor, whatsappDisplayNumber, businessHours, claimsEmail', in: 'body', type: 'string', description: 'Optional company details.' },
        { name: 'adminFirstName / adminLastName / adminEmail', in: 'body', type: 'string', required: true, description: 'The first user (SUPER_ADMIN). adminEmail is the login.' },
        { name: 'coverage', in: 'body', type: 'string[]', required: true, description: 'At least one of AUTO, HOME, HEALTH, LIFE, TRAVEL, ... (see Settings > Coverage).' },
        { name: 'toggles', in: 'body', type: 'object<string, boolean>', description: 'bot_require_claim_photos, bot_require_claim_documents, bot_human_handoff, bot_claim_status_lookup, notify_customer_status_updates, bot_reply_in_customer_language.' },
        { name: 'language', in: 'body', type: '"en" | "fr" | ...', description: 'Bot and dashboard language for the company. Default en.' },
      ],
      body: `{
  "companyName": "Demo Assurance",
  "contactEmail": "contact@demo-assurance.example.com",
  "contactPhone": "+243810000000",
  "country": "DR Congo",
  "city": "Kinshasa",
  "adminFirstName": "Amina",
  "adminLastName": "Diallo",
  "adminEmail": "amina@demo-assurance.example.com",
  "coverage": ["AUTO", "HOME"],
  "toggles": { "bot_human_handoff": true },
  "language": "en"
}`,
      successStatus: 201,
      response: `{
  "company": { "id": "7d0c…", "name": "Demo Assurance", "slug": "demo-assurance", "language": "en" },
  "admin": { "email": "amina@demo-assurance.example.com", "firstName": "Amina", "lastName": "Diallo", "role": "SUPER_ADMIN" },
  "coverage": ["AUTO", "HOME"],
  "password": "3f1c2b9e-…  (shown once)"
}`,
      errors: [
        { status: 400, error: 'invalid_json', when: 'Body is not JSON' },
        { status: 400, error: 'validation_failed', when: 'fields: { field: required | too_long | invalid_email | invalid_phone | invalid_slug | invalid_domain | invalid_url | invalid_color | invalid_language | coverage_required }' },
        { status: 409, error: 'conflict', when: 'fields: { companyName | slug | domain | adminEmail: "taken" }' },
        { status: 429, error: 'rate_limited', when: 'Too many signups from this IP in the last hour' },
        { status: 500, error: 'signup_failed', when: 'Unexpected database error' },
      ],
    },
    {
      method: 'POST', path: '/api/auth/login', service: 'dashboard', auth: 'none',
      summary: 'Sign in with email and password',
      description:
        'Returns an access token and sets the refreshToken cookie. This becomes the only active session of the account: every older refresh token is revoked and older access tokens fail with 401 session_replaced on their next request. Rate limited to 10 attempts per 15 minutes per IP; after LOGIN_MAX_FAILURES (default 5) failed attempts the account is locked for LOGIN_LOCKOUT_MINUTES (default 15) whatever the IP.',
      params: [
        { name: 'email', in: 'body', type: 'string', required: true, description: 'Login email (case-insensitive).' },
        { name: 'password', in: 'body', type: 'string (min 8)', required: true, description: 'Account password.' },
      ],
      body: `{ "email": "amina@demo-assurance.example.com", "password": "<password>" }`,
      response: `{
  "message": "Login successful",
  "admin": {
    "id": "…", "email": "amina@demo-assurance.example.com", "firstName": "Amina", "lastName": "Diallo",
    "role": "SUPER_ADMIN", "uiLanguage": "en",
    "company": { "id": "…", "name": "Demo Assurance", "slug": "demo-assurance", "domain": "demo-assurance.local", "isActive": true, "uiLanguage": "en" }
  },
  "accessToken": "eyJhbGciOi…"
}
Set-Cookie: refreshToken=…; HttpOnly; SameSite=Strict; Path=/`,
      errors: [
        { status: 400, error: 'Validation failed', when: 'Missing email or password shorter than 8 characters (details lists the fields)' },
        { status: 401, error: 'Invalid credentials', when: 'Unknown email, wrong password or deactivated user' },
        { status: 403, error: 'Company account is inactive', when: 'The company was deactivated' },
        { status: 429, error: 'Too many failed sign-in attempts for this account. Please try again later.', when: 'Account locked (code account_locked, Retry-After header in seconds)' },
        { status: 429, error: 'Too many login attempts…', when: 'IP rate limit (X-RateLimit-Reset header)' },
      ],
      curl: `curl -i -X POST "$BASE/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -c cookies.txt \\
  -d '{"email":"amina@demo-assurance.example.com","password":"<password>"}'

# Keep the token for the next calls
export TOKEN="<accessToken from the response>"`,
    },
    {
      method: 'POST', path: '/api/auth/refresh', service: 'dashboard', auth: 'refresh-cookie',
      summary: 'Rotate the refresh token and get a new access token',
      description:
        'Reads the refreshToken cookie (or a JSON body { "refreshToken": "…" } when there is no cookie). The old refresh token is revoked and a new one is set. Re-using a revoked token revokes every session of the account, except when the token belongs to a session replaced by a newer sign-in (answered with code session_replaced, nothing else is revoked). Rate limited to 30 per minute per IP.',
      body: `{ "refreshToken": "<only when you cannot send the cookie>" }`,
      response: `{
  "message": "Token refreshed successfully",
  "admin": { "id": "…", "email": "…", "firstName": "…", "lastName": "…", "role": "ADMIN", "company": { "id": "…", "name": "…" } },
  "accessToken": "eyJhbGciOi…"
}`,
      errors: [
        { status: 400, error: 'Refresh token required', when: 'No cookie and no body token' },
        { status: 401, error: 'Invalid or expired refresh token', when: 'Bad signature or expired; the cookie is cleared' },
        { status: 401, error: 'Token has been revoked - please login again', when: 'Revoked token (all sessions are revoked)' },
        { status: 401, error: 'You were signed out because this account signed in on another device', when: 'The account signed in again elsewhere (code session_replaced); the cookie is cleared' },
        { status: 403, error: 'Account is inactive / Company is inactive', when: 'User or company deactivated' },
        { status: 429, error: 'Too many refresh attempts. Please try again later.', when: 'More than 30 per minute' },
      ],
      curl: `curl -X POST "$BASE/api/auth/refresh" -b cookies.txt -c cookies.txt`,
    },
    {
      method: 'POST', path: '/api/auth/logout', service: 'dashboard', auth: 'refresh-cookie',
      summary: 'Sign out',
      description:
        'Revokes the refresh token from the cookie. When the Bearer token of the current session is sent, every refresh token of that user is revoked and the session ends, so its access tokens stop working at once. Clears the cookie. Always answers 200.',
      response: `{ "message": "Logout successful" }`,
      curl: `curl -X POST "$BASE/api/auth/logout" -H "Authorization: Bearer $TOKEN" -b cookies.txt`,
    },
    {
      method: 'GET', path: '/api/auth/verify', service: 'dashboard', auth: 'jwt',
      summary: 'Check an access token',
      response: `{
  "valid": true,
  "admin": { "id": "…", "email": "…", "firstName": "…", "lastName": "…", "role": "AGENT",
             "company": { "id": "…", "name": "…", "slug": "…", "domain": "…", "isActive": true } }
}`,
      errors: [
        { status: 401, error: 'No token provided', when: 'Missing Bearer token' },
        ...JWT_ERRORS.slice(1),
        { status: 403, error: 'Company account is inactive', when: 'Company deactivated' },
      ],
    },
    {
      method: 'GET', path: '/api/auth/profile', service: 'dashboard', auth: 'jwt',
      summary: 'Current user and company',
      response: `{
  "user": {
    "id": "…", "email": "…", "firstName": "…", "lastName": "…", "role": "ADMIN",
    "uiLanguage": "en", "uiLanguageOverride": null, "companyUiLanguage": "en",
    "company": { "id": "…", "name": "…", "slug": "…", "domain": "…", "logoUrl": null, "primaryColor": null,
                 "botLanguage": "en", "uiLanguage": "en", "isActive": true }
  }
}`,
      errors: [...JWT_ERRORS, { status: 404, error: 'Admin not found', when: 'User deleted' }],
    },
    {
      method: 'PATCH', path: '/api/auth/profile', service: 'dashboard', auth: 'jwt',
      summary: 'Set your own dashboard language',
      description: 'Allowed for every role, including VIEWER. null removes the personal override and falls back to the company language.',
      params: [{ name: 'uiLanguage', in: 'body', type: 'string | null', required: true, description: 'One of the dashboard locales (en, fr, …) or null.' }],
      body: `{ "uiLanguage": "fr" }`,
      response: `{ "uiLanguage": "fr", "uiLanguageOverride": "fr" }`,
      errors: [...JWT_ERRORS, { status: 400, error: 'uiLanguage is required', when: 'Missing field' }, { status: 400, error: 'uiLanguage must be one of … or null', when: 'Unknown locale' }],
    },
    {
      method: 'GET', path: '/api/auth/sessions', service: 'dashboard', auth: 'jwt',
      summary: 'List your active sessions',
      response: `{ "activeSessions": 1, "sessions": [ { "id": "…", "createdAt": "2026-10-01T15:00:00.000Z", "expiresAt": "2026-10-08T15:00:00.000Z", "isCurrent": false } ] }`,
      errors: JWT_ERRORS,
    },
    {
      method: 'POST', path: '/api/auth/sessions', service: 'dashboard', auth: 'jwt',
      summary: 'Sign out everywhere',
      description: 'Revokes every refresh token and bumps the token version, so all access tokens of the user stop working immediately. Clears the cookie.',
      response: `{ "message": "All sessions have been revoked", "sessionsRevoked": 2 }`,
      errors: JWT_ERRORS,
    },
    {
      method: 'GET', path: '/api/auth/tokens/cleanup', service: 'dashboard', auth: 'jwt', roles: 'SUPER_ADMIN',
      summary: 'Refresh-token statistics',
      response: `{ "total": 120, "active": 8, "expired": 40, "revoked": 72 }`,
      errors: [...JWT_ERRORS, ROLE_ERROR],
    },
    {
      method: 'POST', path: '/api/auth/tokens/cleanup', service: 'dashboard', auth: 'jwt', roles: 'SUPER_ADMIN',
      summary: 'Delete expired and old revoked refresh tokens',
      description: 'Deletes expired tokens and revoked tokens older than 24 hours (all companies).',
      response: `{ "message": "Token cleanup completed", "expiredTokensDeleted": 40, "revokedTokensDeleted": 60 }`,
      errors: [...JWT_ERRORS, ROLE_ERROR],
    },
  ],
};

export const usersGroup: ApiGroup = {
  id: 'users',
  title: 'Users',
  description: `Dashboard accounts of your company. Roles: SUPER_ADMIN (everything), ADMIN (settings, integrations and users except super admins), MODERATOR (agent work plus archiving conversations and deleting customers), AGENT (conversations, customers, claims, documents) and VIEWER (read-only). Only ${ADMIN_ONLY} can call these routes. Passwords are always generated by the server and returned once.`,
  endpoints: [
    {
      method: 'GET', path: '/api/users', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'List users of your company',
      response: `{
  "users": [
    { "id": "…", "email": "amina@demo-assurance.example.com", "firstName": "Amina", "lastName": "Diallo",
      "role": "SUPER_ADMIN", "isActive": true, "lastLoginAt": "2026-10-01T15:00:00.000Z", "createdAt": "…",
      "uiLanguage": null, "createdBy": null }
  ],
  "me": { "id": "…", "role": "SUPER_ADMIN" },
  "assignableRoles": ["SUPER_ADMIN", "ADMIN", "MODERATOR", "AGENT", "VIEWER"]
}`,
      errors: [...JWT_ERRORS, ROLE_ERROR],
    },
    {
      method: 'POST', path: '/api/users', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Create a user',
      description: 'An ADMIN cannot create SUPER_ADMIN accounts. Limited to 30 creations per hour per actor.',
      params: [
        { name: 'email', in: 'body', type: 'string', required: true, description: 'Login email, unique across all companies.' },
        { name: 'firstName / lastName', in: 'body', type: 'string', required: true, description: 'Display name.' },
        { name: 'role', in: 'body', type: 'string', required: true, description: 'SUPER_ADMIN, ADMIN, MODERATOR, AGENT or VIEWER.' },
        { name: 'uiLanguage', in: 'body', type: 'string', description: 'Optional dashboard language for the user.' },
      ],
      body: `{ "email": "joel@demo-assurance.example.com", "firstName": "Joel", "lastName": "Mbuyi", "role": "AGENT" }`,
      successStatus: 201,
      response: `{ "user": { "id": "…", "email": "joel@demo-assurance.example.com", "firstName": "Joel", "lastName": "Mbuyi", "role": "AGENT", "isActive": true, "lastLoginAt": null, "createdAt": "…", "uiLanguage": null, "createdBy": { "firstName": "Amina", "lastName": "Diallo" } },
  "password": "…(shown once)" }`,
      errors: [
        ...JWT_ERRORS, ROLE_ERROR,
        { status: 400, error: 'validation_failed', when: 'fields lists invalid values' },
        { status: 403, error: 'forbidden_role', when: 'Role you are not allowed to grant' },
        { status: 409, error: 'email_taken', when: 'Email already used' },
        { status: 429, error: 'rate_limited', when: 'More than 30 creations per hour' },
        { status: 500, error: 'create_failed', when: 'Unexpected error' },
      ],
    },
    {
      method: 'PATCH', path: '/api/users/{id}', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Edit, change role, activate or deactivate a user',
      description: 'Deactivating a user (isActive: false) revokes their sessions. ADMIN cannot manage SUPER_ADMIN accounts.',
      params: [
        { name: 'id', in: 'path', type: 'uuid', required: true, description: 'User id.' },
        { name: 'firstName, lastName, role, isActive', in: 'body', type: 'string | boolean', description: 'Any subset.' },
      ],
      body: `{ "role": "MODERATOR", "isActive": true }`,
      response: `{ "user": { "id": "…", "email": "…", "role": "MODERATOR", "isActive": true } }`,
      errors: [
        ...JWT_ERRORS, ROLE_ERROR,
        { status: 400, error: 'invalid_body / validation_failed / nothing_to_update', when: 'Bad or empty body' },
        { status: 400, error: 'cannot_change_self', when: 'Changing your own role or status' },
        { status: 409, error: 'last_super_admin', when: 'Would leave the company without an active SUPER_ADMIN' },
        { status: 403, error: 'forbidden_target / forbidden_role', when: 'Target or role outside your permissions' },
        { status: 404, error: 'not_found', when: 'Unknown user or another company' },
      ],
    },
    {
      method: 'POST', path: '/api/users/{id}/reset-password', service: 'dashboard', auth: 'jwt', roles: ADMIN_ONLY,
      summary: 'Generate a new password for a user',
      description: 'Revokes all sessions of the target and clears a login lockout. You cannot reset your own password here. 30 resets per hour per actor.',
      params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'User id.' }],
      response: `{ "email": "joel@demo-assurance.example.com", "password": "…(shown once)" }`,
      errors: [
        ...JWT_ERRORS, ROLE_ERROR,
        { status: 400, error: 'cannot_reset_self', when: 'id is your own account' },
        { status: 403, error: 'forbidden_target', when: 'ADMIN resetting a SUPER_ADMIN' },
        { status: 404, error: 'not_found', when: 'Unknown user' },
        { status: 429, error: 'rate_limited', when: 'Too many resets' },
      ],
    },
  ],
};
