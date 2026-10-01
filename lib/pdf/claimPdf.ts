/**
 * Renders the claim report and the claim status PDF with jsPDF.
 * Pure function of its input (no database), so it can be unit-tested.
 */
import { jsPDF } from 'jspdf';
import type { TranslationKey, TranslationVars } from '@/lib/i18n';
import { claimStatusLabel, claimTypeLabel } from '@/lib/i18n/claimLabels';
import type { PdfFont, PdfLogo } from './assets';

export type ClaimPdfKind = 'report' | 'status';
type T = (key: TranslationKey, vars?: TranslationVars) => string;

export interface ClaimPdfData {
  claimNumber: string;
  type: string;
  status: string;
  description?: string | null;
  incidentDate?: Date | string | null;
  incidentTime?: string | null;
  createdAt: Date | string;
  estimatedAmount?: unknown;
  approvedAmount?: unknown;
  company: { name: string; contactEmail?: string | null; contactPhone?: string | null; primaryColor?: string | null };
  customer: { firstName?: string | null; lastName?: string | null; phoneNumber: string; email?: string | null };
  /** Ordered [label, value] pairs (already localized labels, raw customer values). */
  details: Array<[string, string]>;
  documents: Array<{ fileName: string; fileSize: number }>;
  statusHistory: Array<{ fromStatus?: string | null; toStatus: string; changedAt: Date | string; reason?: string | null }>;
}

export interface RenderOptions {
  kind: ClaimPdfKind;
  locale: string;
  intlLocale: string;
  t: T;
  font: PdfFont | null;
  logo: PdfLogo | null;
  now?: Date;
}

const PAGE_W = 210;
const PAGE_H = 297;
const M = 18;
const CONTENT_W = PAGE_W - 2 * M;
const LABEL_W = 55;

function hexColor(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [31, 41, 55];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Helvetica only has Latin-1: replace anything else so the PDF stays readable. */
function latin1(text: string): string {
  return text.normalize('NFC').replace(/[^\u0000-\u00ff\u2013\u2014\u2019\u201c\u201d\u20ac\u2022]/g, '?');
}

export function renderClaimPdf(data: ClaimPdfData, opts: RenderOptions): Buffer {
  const { t, font, kind } = opts;
  const now = opts.now || new Date();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  let family = 'helvetica';
  if (font) {
    doc.addFileToVFS(font.regularFile, font.regular);
    doc.addFont(font.regularFile, font.family, 'normal');
    doc.addFileToVFS(font.boldFile, font.bold);
    doc.addFont(font.boldFile, font.family, 'bold');
    family = font.family;
  }
  const clean = (s: unknown) => {
    const text = String(s ?? '').replace(/\r\n?/g, '\n');
    return font ? text : latin1(text);
  };
  const setFont = (style: 'normal' | 'bold', size: number) => { doc.setFont(family, style); doc.setFontSize(size); };
  const dateFmt = new Intl.DateTimeFormat(opts.intlLocale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const dateTimeFmt = new Intl.DateTimeFormat(opts.intlLocale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
  const fmtDate = (d: Date | string | null | undefined) => (d ? dateFmt.format(new Date(d)) : t('claimPdf.value.notSet'));
  const fmtAmount = (v: unknown) => {
    if (v === null || v === undefined || v === '') return t('claimPdf.value.notSet');
    const n = Number(String(v));
    return Number.isFinite(n) ? new Intl.NumberFormat(opts.intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : String(v);
  };
  const accent = hexColor(data.company.primaryColor);
  let y = M;

  const newPage = () => { doc.addPage(); y = M; };
  const ensure = (h: number) => { if (y + h > PAGE_H - 20) newPage(); };

  // ── header: logo + company ───────────────────────────────────────────
  let textX = M;
  if (opts.logo) {
    try {
      const props = doc.getImageProperties(opts.logo.data);
      const h = 16;
      const w = Math.min(40, (props.width / Math.max(1, props.height)) * h);
      doc.addImage(opts.logo.data, opts.logo.format, M, y, w, h);
      textX = M + w + 5;
    } catch {
      textX = M;
    }
  }
  setFont('bold', 15);
  doc.setTextColor(17, 24, 39);
  doc.text(clean(data.company.name), textX, y + 6);
  const contact = [data.company.contactEmail, data.company.contactPhone].filter(Boolean).join('  ·  ');
  if (contact) {
    setFont('normal', 9);
    doc.setTextColor(75, 85, 99);
    doc.text(clean(contact), textX, y + 12);
  }
  y += 20;
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.8);
  doc.line(M, y, PAGE_W - M, y);
  y += 10;

  // ── title ─────────────────────────────────────────────────────────────
  doc.setTextColor(17, 24, 39);
  setFont('bold', 18);
  doc.text(clean(t(kind === 'status' ? 'claimPdf.title.status' : 'claimPdf.title.report')), PAGE_W / 2, y, { align: 'center' });
  y += 8;
  setFont('normal', 12);
  doc.text(clean(t('claimPdf.claimNumber', { claimNumber: data.claimNumber })), PAGE_W / 2, y, { align: 'center' });
  y += 10;

  const section = (title: string) => {
    ensure(16);
    y += 2;
    setFont('bold', 12);
    doc.setTextColor(...accent);
    doc.text(clean(title.toUpperCase()), M, y);
    y += 2;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.line(M, y, PAGE_W - M, y);
    y += 6;
    doc.setTextColor(17, 24, 39);
  };
  const row = (label: string, value: string) => {
    setFont('normal', 10);
    const lines: string[] = doc.splitTextToSize(clean(value || t('claimPdf.value.notSet')), CONTENT_W - LABEL_W);
    const labelLines: string[] = doc.splitTextToSize(clean(label), LABEL_W - 3);
    const h = Math.max(lines.length, labelLines.length) * 5 + 1.5;
    ensure(h);
    setFont('bold', 10);
    doc.text(labelLines, M, y);
    setFont('normal', 10);
    doc.text(lines, M + LABEL_W, y);
    y += h;
  };
  const paragraph = (text: string) => {
    setFont('normal', 10);
    const lines: string[] = doc.splitTextToSize(clean(text), CONTENT_W);
    for (const line of lines) {
      ensure(5.5);
      doc.text(line, M, y);
      y += 5;
    }
    y += 2;
  };

  const customerName = [data.customer.firstName, data.customer.lastName].filter(Boolean).join(' ');
  section(t('claimPdf.section.general'));
  row(t('claimPdf.field.type'), claimTypeLabel(t, data.type));
  row(t('claimPdf.field.status'), claimStatusLabel(t, data.status));
  row(t('claimPdf.field.incidentDate'), fmtDate(data.incidentDate));
  if (data.incidentTime) row(t('claimPdf.field.incidentTime'), data.incidentTime);
  row(t('claimPdf.field.createdAt'), fmtDate(data.createdAt));
  if (kind === 'report') {
    row(t('claimPdf.field.estimatedAmount'), fmtAmount(data.estimatedAmount));
    row(t('claimPdf.field.approvedAmount'), fmtAmount(data.approvedAmount));
  }

  section(t('claimPdf.section.customer'));
  row(t('claimPdf.field.name'), customerName);
  row(t('claimPdf.field.phone'), data.customer.phoneNumber);
  if (data.customer.email) row(t('claimPdf.field.email'), data.customer.email);

  if (kind === 'status') {
    section(t('claimPdf.section.statusSummary'));
    paragraph(t('claimPdf.status.current', { status: claimStatusLabel(t, data.status) }));
    paragraph(t(`claimPdf.status.explain.${String(data.status).toUpperCase()}` as TranslationKey));
  }

  if (kind === 'report') {
    section(t('claimPdf.section.description'));
    paragraph(data.description || t('claimPdf.value.notSet'));
    if (data.details.length) {
      section(t('claimPdf.section.details'));
      for (const [label, value] of data.details) row(label, value);
    }
    if (data.documents.length) {
      section(t('claimPdf.section.documents'));
      data.documents.forEach((d, i) => paragraph(`${i + 1}. ${d.fileName} (${(d.fileSize / 1024).toFixed(1)} KB)`));
    }
  }

  if (data.statusHistory.length) {
    section(t('claimPdf.section.history'));
    for (const h of data.statusHistory) {
      const line = t('claimPdf.history.line', {
        date: dateTimeFmt.format(new Date(h.changedAt)),
        from: h.fromStatus ? claimStatusLabel(t, h.fromStatus) : '—',
        to: claimStatusLabel(t, h.toStatus),
      });
      paragraph(h.reason ? `${line} — ${h.reason}` : line);
    }
  }

  // ── footer on every page ─────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setFont('normal', 8);
    doc.setTextColor(107, 114, 128);
    doc.text(clean(t('claimPdf.footer', { company: data.company.name, date: dateTimeFmt.format(now), page: i, pages })), PAGE_W / 2, PAGE_H - 10, { align: 'center' });
  }
  doc.setProperties({ title: `${t(kind === 'status' ? 'claimPdf.title.status' : 'claimPdf.title.report')} ${data.claimNumber}`, author: data.company.name, creator: data.company.name, subject: data.claimNumber });
  return Buffer.from(doc.output('arraybuffer'));
}
