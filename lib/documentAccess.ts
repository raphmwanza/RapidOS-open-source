/**
 * Opening and downloading claim documents from the dashboard.
 *
 * The document and PDF routes need the admin's bearer token, which plain
 * links, <img src> and window.open cannot send. These helpers fetch the bytes
 * with authedFetch and hand the browser an object URL instead.
 */
import { authedFetch } from './authedFetch';

export async function fetchDocumentBlob(url: string, init?: RequestInit): Promise<Blob> {
  const res = await authedFetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('Empty document');
  return blob;
}

/** File name from Content-Disposition (RFC 5987 filename* first). */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : fallback;
}

/** Saves the document under its file name. */
export async function downloadDocument(url: string, fallbackName: string): Promise<void> {
  const res = await authedFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('Empty document');
  const name = fileNameFromDisposition(res.headers.get('Content-Disposition'), fallbackName);
  const objectUrl = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  window.document.body.appendChild(a);
  a.click();
  window.document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/**
 * Opens the document in a new tab. Call it straight from a click handler: the
 * tab is opened before the fetch so pop-up blockers allow it.
 */
export async function openDocument(url: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const blob = await fetchDocumentBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    if (win) win.location.href = objectUrl;
    else window.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60_000);
  } catch (error) {
    win?.close();
    throw error;
  }
}
