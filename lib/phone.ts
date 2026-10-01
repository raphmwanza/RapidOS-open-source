/**
 * Phone numbers are stored in E.164 ("+243812345678") on every write:
 * customers, claim data and lookups. Same rules as the Go bot
 * (backend/internal/service/phone_e164.go).
 */

const COUNTRY_CALLING_CODES: Record<string, string> = {
  cd: '243', cod: '243', drc: '243', rdc: '243', 'dr congo': '243', 'rd congo': '243', 'congo-kinshasa': '243', 'congo kinshasa': '243',
  'democratic republic of the congo': '243', 'republique democratique du congo': '243',
  cg: '242', cog: '242', congo: '242', 'congo-brazzaville': '242', 'republic of the congo': '242', 'republique du congo': '242',
  ke: '254', ken: '254', kenya: '254', ug: '256', uga: '256', uganda: '256', ouganda: '256',
  tz: '255', tza: '255', tanzania: '255', tanzanie: '255', rw: '250', rwa: '250', rwanda: '250',
  bi: '257', bdi: '257', burundi: '257', ao: '244', ago: '244', angola: '244', zm: '260', zmb: '260', zambia: '260', zambie: '260',
  ng: '234', nga: '234', nigeria: '234', gh: '233', gha: '233', ghana: '233', sn: '221', sen: '221', senegal: '221',
  ci: '225', civ: '225', "cote d'ivoire": '225', 'ivory coast': '225', cm: '237', cmr: '237', cameroon: '237', cameroun: '237',
  za: '27', zaf: '27', 'south africa': '27', 'afrique du sud': '27', et: '251', eth: '251', ethiopia: '251', ethiopie: '251',
  ma: '212', mar: '212', morocco: '212', maroc: '212', eg: '20', egy: '20', egypt: '20', egypte: '20',
  fr: '33', fra: '33', france: '33', be: '32', bel: '32', belgium: '32', belgique: '32',
  gb: '44', uk: '44', gbr: '44', 'united kingdom': '44', us: '1', usa: '1', 'united states': '1', ca: '1', canada: '1',
  in: '91', ind: '91', india: '91', ph: '63', phl: '63', philippines: '63', id: '62', idn: '62', indonesia: '62', indonesie: '62',
  vn: '84', vnm: '84', vietnam: '84', 'viet nam': '84', bd: '880', bgd: '880', bangladesh: '880',
  br: '55', bra: '55', brazil: '55', bresil: '55', pt: '351', prt: '351', portugal: '351', es: '34', esp: '34', spain: '34', espagne: '34',
  mx: '52', mex: '52', mexico: '52',
};

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Calling code ("243") of a company country, or of its own E.164 contact phone. */
export function callingCodeFor(country?: string | null, contactPhone?: string | null): string | null {
  if (country) {
    const cc = COUNTRY_CALLING_CODES[fold(country)];
    if (cc) return cc;
  }
  if (contactPhone && /^\s*(\+|00)/.test(contactPhone)) {
    const digits = contactPhone.replace(/\D/g, '').replace(/^00/, '');
    const codes = Array.from(new Set(Object.values(COUNTRY_CALLING_CODES))).sort((a, b) => b.length - a.length);
    return codes.find((c) => digits.startsWith(c)) || null;
  }
  return null;
}

/**
 * "+<country code><number>", or null when the number cannot be normalised.
 * National numbers ("0812345678", "812345678") need the company's calling
 * code; without it they are rejected rather than guessed. Digits-only input
 * of 10+ digits (a WhatsApp wa_id) is taken as international.
 */
export function normalizePhoneE164(raw: string | null | undefined, defaultCallingCode?: string | null): string | null {
  let s = String(raw ?? '').trim().replace(/[\s\u00a0\-.()/]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  const plus = s.startsWith('+');
  let d = s.replace(/^\+/, '');
  if (!/^\d+$/.test(d)) return null;
  const cc = String(defaultCallingCode ?? '').replace(/\D/g, '');
  if (!plus) {
    if (d.startsWith('0')) {
      if (!cc) return null;
      d = cc + d.replace(/^0+/, '');
    } else if (d.length <= 9 && cc && !d.startsWith(cc)) {
      d = cc + d;
    } else if (d.length < 10 && !cc) {
      return null;
    }
  }
  if (d.length < 8 || d.length > 15 || d.startsWith('0')) return null;
  return `+${d}`;
}

/** Stored forms a number may still have in rows written before E.164 (E.164 and digits only). */
export function phoneLookupVariants(e164: string): string[] {
  const d = e164.replace(/\D/g, '');
  return d ? [`+${d}`, d] : [];
}
