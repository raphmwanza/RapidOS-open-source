'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { refreshAccessToken, isRefreshOnCooldown } from '@/lib/tokenRefresh';
import { useI18n } from '@/components/I18nProvider';
import { isMarketingPath } from '@/lib/marketing/paths';
import { errorCodeOf, loginUrl, noteSignedOut } from '@/lib/sessionNotice';
import { notifyAuthChange } from '@/lib/authEvents';

/** Pages reachable without signing in. */
export const PUBLIC_PATHS = ['/', '/login', '/signup'];

/** Public pages: login, signup and the marketing site (landing, /docs/*, /pricing, /contact). */
export function isPublicPath(pathname: string | null | undefined): boolean {
  return PUBLIC_PATHS.includes(pathname || '') || isMarketingPath(pathname);
}
/** Public pages that send an already signed-in user to the dashboard. */
const REDIRECT_WHEN_AUTHED = ['/', '/login'];

interface AuthProviderProps {
  children: React.ReactNode;
}

interface Admin {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  company: {
    id: string;
    name: string;
    slug: string;
    domain: string;
    isActive: boolean;
  };
}

export default function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [, setAdmin] = useState<Admin | null>(null);
  const isCheckingRef = useRef(false); // Prevent concurrent auth checks (ref, not state!)
  const hasTriedRefreshRef = useRef(false); // Prevent infinite refresh loops
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const isPublic = isPublicPath(pathname);

  const checkAuth = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // Prevent concurrent auth checks using a ref (synchronous, no stale closures)
    if (isCheckingRef.current) {
      console.log('AuthProvider: Skipping - auth check already in progress');
      return;
    }
    isCheckingRef.current = true;

    try {
      // "Login page" here means any public page: no redirect to /login from it.
      const isLoginPage = isPublicPath(pathname);
      const redirectHome = REDIRECT_WHEN_AUTHED.includes(pathname);
      const accessToken = localStorage.getItem('accessToken');

      // CASE 0: Public page with no token (landing, login, signup) — just show it, don't try refresh.
      // The signup page is always shown, even to a signed-in admin.
      if ((isLoginPage && !accessToken) || pathname === '/signup') {
        setIsAuthenticated(false);
        setAdmin(null);
        return;
      }

      // CASE 1: Have an access token - verify it
      if (accessToken) {
        try {
          const response = await fetch('/api/auth/verify', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            setAdmin(data.admin);
            setIsAuthenticated(true);
            hasTriedRefreshRef.current = false; // Reset on success
            if (redirectHome) {
              router.push('/home');
            }
            return;
          }

          // Token invalid - remove it (and remember a forced sign-out for the login page)
          noteSignedOut(await errorCodeOf(response));
          console.log('AuthProvider: Access token invalid, status:', response.status);
          localStorage.removeItem('accessToken');
        } catch (error) {
          console.error('AuthProvider: Verify failed:', error);
          localStorage.removeItem('accessToken');
        }
      }

      // CASE 2: No valid access token - try refresh (but only once per cycle)
      if (hasTriedRefreshRef.current || isRefreshOnCooldown()) {
        console.log('AuthProvider: Skipping refresh - already tried or on cooldown');
        if (!isLoginPage) {
          router.push(loginUrl());
        }
        setIsAuthenticated(false);
        setAdmin(null);
        return;
      }

      // Attempt refresh using global singleton
      hasTriedRefreshRef.current = true;
      console.log('AuthProvider: Attempting token refresh via singleton...');

      const result = await refreshAccessToken();

      if (result.success && result.admin) {
        console.log('AuthProvider: Refresh successful');
        setAdmin(result.admin);
        setIsAuthenticated(true);
        hasTriedRefreshRef.current = false; // Reset on success
        if (redirectHome) {
          router.push('/home');
        }
      } else {
        console.log('AuthProvider: Refresh failed, clearing auth');
        setIsAuthenticated(false);
        setAdmin(null);
        if (!isLoginPage) {
          router.push(loginUrl());
        }
      }
    } finally {
      isCheckingRef.current = false;
      setIsLoading(false);
      notifyAuthChange(); // the token may have been verified, refreshed or dropped
    }
  }, [pathname, router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const spinner = (label: string) => (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)' }}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white text-lg">{label}</p>
      </div>
    </div>
  );

  // Public pages render immediately; signed-in users are sent on from / and /login.
  if (isPublic) {
    if (isAuthenticated && REDIRECT_WHEN_AUTHED.includes(pathname)) return spinner(t('common.redirecting'));
    return <>{children}</>;
  }

  if (isLoading) return spinner(t('common.loading'));

  if (isAuthenticated) return <>{children}</>;

  return spinner(t('common.redirecting'));
}
