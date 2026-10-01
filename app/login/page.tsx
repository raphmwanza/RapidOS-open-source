'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetRefreshState } from '@/lib/tokenRefresh';
import { useI18n } from '@/components/I18nProvider';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { normalizeLocale } from '@/lib/i18n';
import { clearSignedOutReason } from '@/lib/sessionNotice';
import { SITE } from '@/config/site';

function LoginForm() {
  const { t, setLocale } = useI18n();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const justCreated = searchParams.get('created') === '1';
  const sessionReplaced = searchParams.get('reason') === 'session_replaced';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for refresh token
        body: JSON.stringify({
          email,
          password,
          rememberMe,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(response.status === 401 ? t('auth.login.invalidCredentials') : response.status === 403 ? t('auth.login.inactive') : response.status === 429 ? t(data?.code === 'account_locked' ? 'auth.login.locked' : 'auth.login.tooMany') : t('auth.login.failed'));
        return;
      }

      // Store access token and reset refresh state (clear any cooldowns)
      localStorage.setItem('accessToken', data.accessToken);
      resetRefreshState();
      clearSignedOutReason();

      // Open the dashboard in the account's language.
      const preferred = normalizeLocale(data?.admin?.uiLanguage);
      if (preferred) setLocale(preferred);

      // Redirect to home (not root to avoid middleware redirect)
      router.push('/home');
    } catch {
      setError(t('common.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)' }}>
      <div className="absolute end-4 top-4"><LanguageSwitcher variant="dark" /></div>
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Logo and Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center items-center mb-4">
              <Link href="/"><img src="/assets/images/icon.png" alt="Rapidos" className="h-16 w-auto" /></Link>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('auth.login.title')}</h1>
            <p className="text-gray-600">{t('auth.login.subtitle')}</p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {justCreated && <div role="status" className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{t('auth.login.accountCreated')}</div>}
            {sessionReplaced && <div role="alert" data-testid="session-replaced" className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg text-sm">{t('auth.login.sessionReplaced')}</div>}
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                {t('auth.login.email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition duration-200"
                placeholder={t('auth.login.emailPlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                {t('auth.login.password')}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus={justCreated}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition duration-200"
                placeholder={t('auth.login.passwordPlaceholder')}
              />
            </div>

            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <label htmlFor="remember-me" className="ms-2 block text-sm text-gray-700">
                {t('auth.login.rememberMe')}
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2"></div>
                  {t('auth.login.submitting')}
                </div>
              ) : (
                t('auth.login.submit')
              )}
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-sm text-gray-700">{t('auth.login.newCompany')}</p>
            <Link href="/signup" className="mt-2 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              {t('auth.login.createCompany')}
            </Link>
          </div>

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-xs text-gray-500">
              {t('auth.login.footer').split('AGPL-3.0').flatMap((part, i) => (i === 0 ? [part] : [
                <a key={i} href={`${SITE.githubUrl}/blob/main/LICENSE`} className="whitespace-nowrap hover:underline" rel="noopener noreferrer license" target="_blank" data-testid="login-license-link">AGPL-3.0</a>,
                part,
              ]))}{' '}
              <a href={SITE.githubUrl} className="font-medium text-emerald-700 hover:underline" rel="noopener noreferrer" target="_blank" data-testid="login-source-link">
                {t('auth.login.sourceCode')}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for static rendering in Next 14.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
