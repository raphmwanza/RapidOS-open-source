/**
 * Fonts and company logo for generated PDFs (server only).
 *
 * Fonts: a Unicode TrueType font (DejaVu Sans, installed in the dashboard
 * image) so accents, Vietnamese/Yoruba/Hausa letters, Cyrillic and Arabic
 * render. Without it the PDF falls back to Helvetica (Latin-1 only).
 */
import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';

export interface PdfFont { family: string; regular: string; bold: string; regularFile: string; boldFile: string }

let fontCache: PdfFont | null | undefined;

const FONT_CANDIDATES: Array<[string, string]> = [
  ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'],
  ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'],
];

function fontDirs(): string[] {
  return [
    process.env.PDF_FONT_DIR,
    path.join(process.cwd(), 'public', 'fonts'),
    '/usr/share/fonts/truetype/dejavu',
    '/usr/share/fonts/dejavu',
    '/usr/share/fonts/TTF',
    '/usr/share/fonts/truetype/noto',
  ].filter((d): d is string => !!d);
}

/** The Unicode font to embed, or null when none is installed. */
export function loadPdfFont(): PdfFont | null {
  if (fontCache !== undefined) return fontCache;
  for (const dir of fontDirs()) {
    for (const [reg, bold] of FONT_CANDIDATES) {
      const r = path.join(dir, reg);
      const b = path.join(dir, bold);
      if (existsSync(r) && existsSync(b)) {
        fontCache = { family: 'PdfSans', regular: readFileSync(r).toString('base64'), bold: readFileSync(b).toString('base64'), regularFile: reg, boldFile: bold };
        return fontCache;
      }
    }
  }
  fontCache = null;
  return null;
}

export interface PdfLogo { data: Uint8Array; format: 'PNG' | 'JPEG' }

const logoCache = new Map<string, { at: number; logo: PdfLogo | null }>();
const LOGO_TTL_MS = 10 * 60 * 1000;
const MAX_LOGO_BYTES = 1024 * 1024;

function imageFormat(buf: Buffer): 'PNG' | 'JPEG' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'PNG';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'JPEG';
  return null;
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

async function fetchRemoteLogo(url: URL): Promise<Buffer | null> {
  // The URL is set by a company admin; never let it reach internal services.
  if (process.env.PDF_LOGO_ALLOW_PRIVATE !== 'true') {
    const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= MAX_LOGO_BYTES ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The company logo as PNG/JPEG bytes (data: URL, file under /public, or http(s) URL), or null. */
export async function loadCompanyLogo(logoUrl: string | null | undefined): Promise<PdfLogo | null> {
  const src = String(logoUrl || '').trim();
  if (!src) return null;
  const hit = logoCache.get(src);
  if (hit && Date.now() - hit.at < LOGO_TTL_MS) return hit.logo;
  let buf: Buffer | null = null;
  try {
    const data = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(src);
    if (data) {
      buf = Buffer.from(data[2], 'base64');
    } else if (src.startsWith('/') && !src.startsWith('//')) {
      const publicDir = path.join(process.cwd(), 'public');
      const file = path.resolve(publicDir, '.' + decodeURIComponent(src.split('?')[0]));
      if (file.startsWith(publicDir + path.sep)) buf = await fs.readFile(file).catch(() => null);
    } else if (/^https?:\/\//i.test(src)) {
      buf = await fetchRemoteLogo(new URL(src));
    }
  } catch {
    buf = null;
  }
  const format = buf && buf.length <= MAX_LOGO_BYTES ? imageFormat(buf) : null;
  const logo = buf && format ? { data: new Uint8Array(buf), format } : null;
  logoCache.set(src, { at: Date.now(), logo });
  return logo;
}
