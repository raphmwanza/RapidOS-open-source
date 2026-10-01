'use client';

import { useI18n } from './I18nProvider';

export default function LogoutButton() {
  const { t } = useI18n();

  const handleLogout = async () => {
    try {
      // Call logout API
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('Logout API call failed:', error);
    } finally {
      // Clear local storage and redirect
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        window.location.href = '/login';
      }
    }
  };

  return (
    <button
      onClick={handleLogout}
  className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-md font-medium transition duration-200 whitespace-nowrap shrink-0"
      title={t('nav.logout')}
    >
      {t('nav.logout')}
    </button>
  );
}
