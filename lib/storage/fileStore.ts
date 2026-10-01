/**
 * File storage for claim documents (generated PDFs, WhatsApp photos, uploads).
 *
 * Files live on disk under FILE_STORAGE_DIR (a Docker volume in
 * docker-compose.yml), one folder per company:
 *   companies/<companyId>/claims/<claimId>/<uuid>-<name>
 *   companies/<companyId>/pending/<customerId>/<uuid>-<name>   (media sent before the claim exists)
 *   companies/<companyId>/knowledge/<uuid>-<name>              (knowledge-base documents from Settings)
 * A ClaimDocument row points at a file with filePath = "storage:<key>".
 * Every read checks that the key belongs to the caller's company.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const STORAGE_PREFIX = 'storage:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function storageRoot(): string {
  return path.resolve(process.env.FILE_STORAGE_DIR || path.join(process.cwd(), 'storage'));
}

/** File name safe for disk and Content-Disposition (keeps letters of any script). */
export function safeFileName(name: string, fallback = 'file'): string {
  const base = path.basename(String(name || '')).normalize('NFC');
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
}

function assertId(value: string, what: string) {
  if (!UUID_RE.test(value)) throw new Error(`invalid ${what}`);
}

function resolveKey(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('invalid storage key');
  return full;
}

/** True when the key is inside the company's folder. */
export function keyBelongsToCompany(key: string, companyId: string): boolean {
  const normalized = path.posix.normalize(key);
  return UUID_RE.test(companyId) && normalized.startsWith(`companies/${companyId}/`) && !normalized.includes('..');
}

export function claimFolder(companyId: string, claimId: string): string {
  assertId(companyId, 'company id');
  assertId(claimId, 'claim id');
  return `companies/${companyId}/claims/${claimId}`;
}

export function pendingFolder(companyId: string, customerId: string): string {
  assertId(companyId, 'company id');
  assertId(customerId, 'customer id');
  return `companies/${companyId}/pending/${customerId}`;
}

export function knowledgeFolder(companyId: string): string {
  assertId(companyId, 'company id');
  return `companies/${companyId}/knowledge`;
}

/** Dashboard URL of a knowledge document stored under the company's folder. */
export const KNOWLEDGE_FILE_ROUTE = '/api/settings/file';
export function knowledgeFileUrl(key: string): string {
  return `${KNOWLEDGE_FILE_ROUTE}?key=${encodeURIComponent(key)}`;
}

/** The storage key behind a knowledge document URL, or null for other (older, external) URLs. */
export function knowledgeKeyFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(`${KNOWLEDGE_FILE_ROUTE}?`)) return null;
  const key = new URLSearchParams(url.slice(KNOWLEDGE_FILE_ROUTE.length + 1)).get('key');
  return key && /^companies\/[^/]+\/knowledge\/[^/]+$/.test(key) ? key : null;
}

export async function writeStoredFile(folder: string, fileName: string, data: Buffer): Promise<string> {
  const key = `${folder}/${randomUUID()}-${safeFileName(fileName)}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return key;
}

export async function readStoredFile(key: string, companyId: string): Promise<Buffer | null> {
  if (!keyBelongsToCompany(key, companyId)) return null;
  try {
    return await fs.readFile(resolveKey(key));
  } catch {
    return null;
  }
}

export async function deleteStoredFile(key: string, companyId: string): Promise<void> {
  if (!keyBelongsToCompany(key, companyId)) return;
  await fs.rm(resolveKey(key), { force: true }).catch(() => undefined);
}

export async function moveStoredFile(key: string, companyId: string, folder: string): Promise<string | null> {
  if (!keyBelongsToCompany(key, companyId)) return null;
  const target = `${folder}/${path.posix.basename(key)}`;
  const to = resolveKey(target);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(resolveKey(key), to);
  return target;
}

export async function listStoredFiles(folder: string): Promise<string[]> {
  try {
    const names = await fs.readdir(resolveKey(folder));
    return names.filter((n) => !n.endsWith('.json')).map((n) => `${folder}/${n}`);
  } catch {
    return [];
  }
}

export async function writeSidecar(key: string, meta: Record<string, unknown>): Promise<void> {
  await fs.writeFile(resolveKey(`${key}.json`), JSON.stringify(meta));
}

export async function readSidecar(key: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(resolveKey(`${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export async function deleteSidecar(key: string): Promise<void> {
  await fs.rm(resolveKey(`${key}.json`), { force: true }).catch(() => undefined);
}
