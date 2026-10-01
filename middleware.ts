import { NextResponse, type NextRequest } from 'next/server';
import { MARKETING_HEADER, isMarketingPath } from '@/lib/marketing/paths';

// Tells the root layout that the request is for an English-only marketing page
// (the layout cannot see the pathname on its own).
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(MARKETING_HEADER);
  if (isMarketingPath(request.nextUrl.pathname)) headers.set(MARKETING_HEADER, '1');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/', '/docs', '/docs/:path*', '/pricing', '/pricing/:path*', '/contact'],
};
