# Security Policy

Do not report vulnerabilities or exposed credentials through public issues. Contact the repository owner privately with a reproduction and impact.

Use independent strong JWT secrets and a 32-byte base64 `ENCRYPTION_KEY`, keep `.env` out of source control, use TLS, restrict `CORS_ALLOWED_ORIGINS`, set `TRUSTED_PROXY` only behind a proxy you control, and rotate provider keys from Settings. Database access together with `ENCRYPTION_KEY` permits decryption of stored credentials.
