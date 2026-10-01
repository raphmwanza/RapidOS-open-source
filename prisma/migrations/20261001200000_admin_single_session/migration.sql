-- One active session per account: each login stores a new session id here and
-- puts it in the JWT ("sid"). Tokens of any other session are rejected
-- (code session_replaced), so the previous browser is signed out.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "current_session_id" UUID;
