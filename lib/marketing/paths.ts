// Public marketing pages (landing, docs, pricing, contact). They are English only:
// no i18n dictionary, no language switcher, <html lang="en">. Browsers can
// still auto-translate them (no "notranslate").

/** Request header set by middleware.ts on marketing paths, read by app/layout.tsx. */
export const MARKETING_HEADER = 'x-rapidos-marketing';

const MARKETING_PREFIXES = ['/docs', '/pricing', '/contact'];

export function isMarketingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === '/') return true;
  return MARKETING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
