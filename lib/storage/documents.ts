/**
 * Claim documents on top of the file store: create, read and attach files,
 * always inside one company.
 */
import { prisma } from '@/lib/prisma';
import {
  STORAGE_PREFIX,
  claimFolder,
  deleteSidecar,
  deleteStoredFile,
  listStoredFiles,
  moveStoredFile,
  pendingFolder,
  readSidecar,
  readStoredFile,
  safeFileName,
  writeSidecar,
  writeStoredFile,
} from './fileStore';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
  'image/heif': 'heif', 'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** MIME type from the file's magic bytes; falls back to the declared type or the extension. */
export function detectMimeType(data: Buffer, declared?: string | null, fileName?: string | null): string {
  const b = data;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|heif)/.test(b.subarray(8, 12).toString('latin1'))) return 'image/heic';
  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || '';
  const declaredType = String(declared || '').toLowerCase().split(';')[0].trim();
  // Office files are zip/OLE containers: trust the declared type or the extension.
  if ((b.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004' || b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) && (EXT_MIME[ext] || declaredType)) {
    const t = declaredType && declaredType !== 'application/octet-stream' ? declaredType : EXT_MIME[ext];
    if (t === 'application/msword' || t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return t;
  }
  return 'application/octet-stream';
}

/** A file name with an extension that matches its real type. */
export function fileNameFor(name: string | null | undefined, mime: string, fallbackBase: string): string {
  const ext = MIME_EXT[mime];
  let base = safeFileName(name || '', fallbackBase);
  if (ext && !base.toLowerCase().endsWith(`.${ext}`) && !(ext === 'jpg' && /\.jpe?g$/i.test(base))) {
    base = `${base.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.${ext}`;
  }
  return base;
}

export function documentUrl(claimId: string, documentId: string): string {
  return `/api/documents/${claimId}/${documentId}`;
}

export function storageKeyOf(filePath: string | null | undefined): string | null {
  return filePath && filePath.startsWith(STORAGE_PREFIX) ? filePath.slice(STORAGE_PREFIX.length) : null;
}

/** The bytes of a document: the stored file, or the legacy base64 column. */
export async function readDocumentBytes(
  doc: { filePath: string; base64Data?: string | null },
  companyId: string,
): Promise<Buffer | null> {
  const key = storageKeyOf(doc.filePath);
  if (key) return readStoredFile(key, companyId);
  if (doc.base64Data) return Buffer.from(doc.base64Data, 'base64');
  return null;
}

export async function storeClaimDocument(input: {
  companyId: string;
  claimId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  uploadedBy: string;
}) {
  const key = await writeStoredFile(claimFolder(input.companyId, input.claimId), input.fileName, input.data);
  try {
    return await prisma.claimDocument.create({
      data: {
        claimId: input.claimId,
        fileName: input.fileName,
        filePath: `${STORAGE_PREFIX}${key}`,
        fileType: input.mimeType,
        fileSize: input.data.length,
        uploadedBy: input.uploadedBy,
      },
      select: { id: true, claimId: true, fileName: true, fileType: true, fileSize: true, createdAt: true },
    });
  } catch (error) {
    await deleteStoredFile(key, input.companyId);
    throw error;
  }
}

/** Removes a document row and its stored file. */
export async function deleteClaimDocument(doc: { id: string; filePath: string }, companyId: string) {
  await prisma.claimDocument.delete({ where: { id: doc.id } }).catch(() => undefined);
  const key = storageKeyOf(doc.filePath);
  if (key) await deleteStoredFile(key, companyId);
}

/** Keeps media a customer sent before their claim existed; attached when it is created. */
export async function storePendingMedia(input: {
  companyId: string;
  customerId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  uploadedBy: string;
}): Promise<string> {
  const key = await writeStoredFile(pendingFolder(input.companyId, input.customerId), input.fileName, input.data);
  await writeSidecar(key, { fileName: input.fileName, mimeType: input.mimeType, uploadedBy: input.uploadedBy, size: input.data.length, createdAt: new Date().toISOString() });
  return key;
}

/**
 * Pending folders of a customer: their own, plus those of duplicate customer
 * records merged into them (files are stored by customer id).
 */
async function pendingFoldersOf(companyId: string, customerId: string): Promise<string[]> {
  const merged = await prisma.customerMerge
    .findMany({ where: { companyId, keptCustomerId: customerId }, select: { mergedCustomerId: true } })
    .catch(() => [] as { mergedCustomerId: string }[]);
  return [customerId, ...merged.map((m: { mergedCustomerId: string }) => m.mergedCustomerId)].map((id) => pendingFolder(companyId, id));
}

/** Moves the customer's pending media onto the claim. Returns how many files were attached. */
export async function attachPendingMedia(companyId: string, customerId: string, claimId: string): Promise<number> {
  let attached = 0;
  for (const folder of await pendingFoldersOf(companyId, customerId)) {
    for (const key of await listStoredFiles(folder)) {
      const meta = (await readSidecar(key)) || {};
      const moved = await moveStoredFile(key, companyId, claimFolder(companyId, claimId));
      await deleteSidecar(key);
      if (!moved) continue;
      const data = await readStoredFile(moved, companyId);
      await prisma.claimDocument.create({
        data: {
          claimId,
          fileName: String(meta.fileName || moved.split('/').pop()),
          filePath: `${STORAGE_PREFIX}${moved}`,
          fileType: String(meta.mimeType || 'application/octet-stream'),
          fileSize: data?.length || Number(meta.size) || 0,
          uploadedBy: String(meta.uploadedBy || 'whatsapp'),
        },
      });
      attached++;
    }
  }
  return attached;
}

/**
 * Deletes the media a customer sent for a claim they then cancelled, so it can
 * never be attached to a later, unrelated claim. Returns how many files were removed.
 */
export async function discardPendingMedia(companyId: string, customerId: string): Promise<number> {
  let discarded = 0;
  for (const folder of await pendingFoldersOf(companyId, customerId)) {
    for (const key of await listStoredFiles(folder)) {
      await deleteStoredFile(key, companyId);
      await deleteSidecar(key);
      discarded++;
    }
  }
  return discarded;
}

export type ValidatedUpload = { ok: true; data: Buffer; mimeType: string; fileName: string } | { ok: false; status: number; error: string };

/** Size and type checks for an uploaded file; the type comes from the file's bytes. */
export function validateUpload(data: Buffer, declaredType: string | null | undefined, name: string | null | undefined, fallbackBase: string): ValidatedUpload {
  if (!data.length) return { ok: false, status: 400, error: 'Empty file' };
  if (data.length > MAX_UPLOAD_BYTES) return { ok: false, status: 413, error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` };
  const mimeType = detectMimeType(data, declaredType, name);
  if (!ALLOWED_DOCUMENT_TYPES.has(mimeType)) return { ok: false, status: 415, error: 'File type not allowed (images, PDF and Word documents only)' };
  return { ok: true, data, mimeType, fileName: fileNameFor(name, mimeType, fallbackBase) };
}
