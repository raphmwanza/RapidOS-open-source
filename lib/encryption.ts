import crypto from 'crypto';

const PREFIX = 'v1';

function key(): Buffer {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error('ENCRYPTION_KEY is not configured');
  const decoded = Buffer.from(value, 'base64');
  // Permit a base64 32-byte key, or a 64-character hexadecimal key.
  const candidate = decoded.length === 32 ? decoded : Buffer.from(value, 'hex');
  if (candidate.length !== 32) throw new Error('ENCRYPTION_KEY must encode exactly 32 bytes');
  return candidate;
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(value: string): string {
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== PREFIX || !iv || !tag || !ciphertext) throw new Error('Unsupported encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function maskSecret(value?: string | null): string | null {
  if (!value) return null;
  try {
    const plain = decryptSecret(value);
    return plain.length <= 4 ? '••••' : `••••${plain.slice(-4)}`;
  } catch {
    return '••••';
  }
}
