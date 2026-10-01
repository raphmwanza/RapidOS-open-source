'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch } from '@/lib/authedFetch';
import { useI18n } from '@/components/I18nProvider';
import { useCurrentUser } from '@/components/CurrentUser';
import { claimTypeLabel } from '@/lib/i18n/claimLabels';

interface Claim {
  id: string;
  claimNumber: string;
  type: string;
  status: string;
  description: string;
  estimatedAmount: number;
  incidentDate: string;
  createdAt: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
  };
}

interface User {
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

export default function ClaimsPage() {
  const { t, intl } = useI18n();
  const { canWrite } = useCurrentUser();
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // New claim modal & notifications
  const [newClaimOpen, setNewClaimOpen] = useState(false);
  const [newClaimSaving, setNewClaimSaving] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredClaims, setFilteredClaims] = useState<Claim[]>([]);
  const [newClaimForm, setNewClaimForm] = useState({
    insuredFullName: '',
    phoneNumber: '',
    incidentDate: '',
    incidentLocation: '',
    damageDescription: '',
    claimCategory: 'Auto' as const,
  });

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-dismiss notification
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(t);
  }, [notification]);

  // Search-only filtering
  useEffect(() => {
    let filtered = claims;
    const q = searchTerm.trim().toLowerCase();
    if (q !== '') {
      filtered = filtered.filter((claim) => {
        const name = `${claim.customer.firstName} ${claim.customer.lastName}`.toLowerCase();
        return (
          claim.claimNumber.toLowerCase().includes(q) ||
          claim.customer.phoneNumber.toLowerCase().includes(q) ||
          name.includes(q) ||
          (claim.description || '').toLowerCase().includes(q)
        );
      });
    }
    setFilteredClaims(filtered);
  }, [claims, searchTerm]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [profileRes] = await Promise.all([
        authedFetch('/api/auth/profile')
      ]);

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUser(profileData.user);
      }

      const claimsRes = await authedFetch('/api/claims');
      if (claimsRes.ok) {
        const claimsData = await claimsRes.json();
        setClaims(claimsData.claims || []);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveNewClaim = async () => {
    if (newClaimSaving) return;
    // Minimal required fields: full name and phone
    if (!newClaimForm.insuredFullName.trim() || !newClaimForm.phoneNumber.trim()) {
      setNotification({ message: t('claims.requiredFields'), type: 'error' });
      return;
    }
    try {
      setNewClaimSaving(true);
      const res = await authedFetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insuredFullName: newClaimForm.insuredFullName,
          phoneNumber: newClaimForm.phoneNumber,
          claimCategory: newClaimForm.claimCategory,
          incidentDate: newClaimForm.incidentDate || undefined,
          incidentLocation: newClaimForm.incidentLocation || undefined,
          damageDescription: newClaimForm.damageDescription || undefined,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || t('claims.createError'));
      }
      setNotification({ message: t('claims.created', { number: data.claim?.claimNumber || '' }).trim(), type: 'success' });
      setNewClaimOpen(false);
      setNewClaimForm({ insuredFullName: '', phoneNumber: '', incidentDate: '', incidentLocation: '', damageDescription: '', claimCategory: 'Auto' });
      await fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotification({ message: t('claims.createFailed', { message: msg }), type: 'error' });
    } finally {
      setNewClaimSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors = {
      NEW: 'bg-blue-100 text-blue-800',
      ONGOING: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      COMPLETED: 'bg-gray-100 text-gray-800'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getStatusText = (status: string) => {
    const keys = { NEW: 'claims.status.NEW', ONGOING: 'claims.status.ONGOING', APPROVED: 'claims.status.APPROVED', REJECTED: 'claims.status.REJECTED', COMPLETED: 'claims.status.COMPLETED' } as const;
    return status in keys ? t(keys[status as keyof typeof keys]) : status;
  };

  const getCompanyName = () => {
    if (user?.company?.name) {
      return user.company.name;
    }
    
    if (user?.company?.slug) {
      return user.company.slug
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    
    if (user?.company?.domain) {
      const domainName = user.company.domain.split('.')[0];
      return domainName.charAt(0).toUpperCase() + domainName.slice(1);
    }
    
    if (user?.email) {
      const emailDomain = user.email.split('@')[1];
      if (emailDomain) {
        let companyName = emailDomain.split('.')[0];
        return companyName.charAt(0).toUpperCase() + companyName.slice(1);
      }
    }
    
    return t('claims.insurance');
  };

  const handleClaimClick = (claimNumber: string) => {
    router.push(`/clients/claims/${claimNumber}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f9fafb' }}>
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-transparent mx-auto" style={{ borderTopColor: '#374151' }}></div>
          </div>
          <div className="mt-6 space-y-2">
            <p className="text-xl font-semibold" style={{ color: '#374151' }}>{t('claims.loading')}</p>
            <p className="text-sm" style={{ color: '#6b7280' }}>{t('claims.fetchingData')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f9fafb' }}>
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 end-4 z-50 px-6 py-4 rounded-lg shadow-lg ${notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          <div className="flex items-center gap-2">
            <span className="font-medium">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ms-2 opacity-80 hover:opacity-100">✕</button>
          </div>
        </div>
      )}
      {/* Header */}
  <div className="relative py-16 overflow-hidden" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M30 30c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15zm15 0c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-block">
              <h1 className="text-6xl md:text-7xl font-black text-white tracking-tight">
                {t('claims.title')}
              </h1>
              <div className="h-1 mt-4 mx-auto w-3/4" style={{ backgroundColor: '#DEE1E6' }}></div>
            </div>
            <p className="mt-6 text-xl font-medium" style={{ color: '#DEE1E6' }}>
              {t('claims.management', { company: getCompanyName() })}
            </p>
            <div className="mt-4 flex justify-center space-x-6 rtl:space-x-reverse">
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <div className="w-2 h-2 bg-white rounded-full animate-pulse me-2"></div>
                <span className="text-sm font-medium">{t('claims.count', { count: claims.length })}</span>
              </div>
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <span className="text-sm font-medium">
                  {new Date().toLocaleDateString(intl, { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar + Action */}
  <div className="mt-1 mb-6 shadow-2xl rounded-2xl border" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
          <div className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center md:justify-between">
              {/* Search Input */}
              <div className="flex-1 relative">
                <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="search"
                  name="claimSearch"
                  autoComplete="off"
                  className="w-full ps-10 pe-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                  style={{ 
                    borderColor: '#DEE1E6',
                    backgroundColor: 'white'
                  }}
                  placeholder={t('claims.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Nouvelle Réclamation Button (hidden from read-only roles) */}
              {canWrite && (
              <div className="md:self-center">
                <button
                  data-write-action="new-claim"
                  onClick={() => setNewClaimOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)' }}
                  aria-label={t('claims.newClaim')}
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {t('claims.newClaim')}
                </button>
              </div>
              )}
            </div>
          </div>
        </div>

        {/* Claims Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredClaims.map((claim) => (
            <div
              key={claim.id}
              className="bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105 cursor-pointer border-2 overflow-hidden"
              style={{ borderColor: '#6b7280' }}
              onClick={() => handleClaimClick(claim.claimNumber)}
            >
              {/* Claim Header */}
              <div 
                className="px-4 py-3 text-center"
                style={{ 
                  background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)',
                }}
              >
                <div className="flex items-center justify-center space-x-2 rtl:space-x-reverse mb-2">
                  <div className="w-8 h-8 rounded-full bg-black/20 backdrop-blur-sm flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="text-white font-bold">#{claim.claimNumber}</span>
                </div>
                
                <div className="inline-flex items-center space-x-2 rtl:space-x-reverse bg-black/20 backdrop-blur-sm rounded-full px-3 py-1">
                  <div className="w-2 h-2 bg-white rounded-full"></div>
                  <span className="text-white text-xs font-medium">
                    {claimTypeLabel(t, claim.type)}
                  </span>
                </div>
              </div>

              {/* Claim Content */}
              <div className="p-4">
                <div className="space-y-3">
                  {/* Customer Info */}
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: '#f9fafb' }}>
                    <div className="flex items-center justify-center space-x-2 rtl:space-x-reverse mb-1">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#6b7280' }}></div>
                      <span className="text-sm font-medium" style={{ color: '#374151' }}>
                        {claim.customer.firstName && claim.customer.lastName 
                          ? `${claim.customer.firstName} ${claim.customer.lastName}`
                          : t('claims.anonymousCustomer')
                        }
                      </span>
                    </div>
                    <div className="text-xs" style={{ color: '#6b7280' }}>
                      {claim.customer.phoneNumber}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="text-center">
                    <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusColor(claim.status)}`}>
                      {getStatusText(claim.status)}
                    </span>
                  </div>

                  {/* Amount */}
                  {claim.estimatedAmount && (
                    <div className="text-center p-2 rounded-lg" style={{ backgroundColor: '#f3f4f6' }}>
                      <div className="text-lg font-bold" style={{ color: '#374151' }}>
                        {claim.estimatedAmount.toLocaleString(intl, { style: 'currency', currency: 'EUR' })}
                      </div>
                      <div className="text-xs" style={{ color: '#6b7280' }}>
                        {t('claims.estimatedAmount')}
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  <div className="text-xs p-2 rounded-lg truncate" style={{ backgroundColor: '#f9fafb', color: '#374151' }}>
                    {claim.description || t('claims.noDescription')}
                  </div>

                  {/* Date */}
                  <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: '#e5e7eb' }}>
                    <span className="text-xs" style={{ color: '#6b7280' }}>{t('claims.createdOn')}</span>
                    <span className="text-xs font-medium" style={{ color: '#374151' }}>
                      {new Date(claim.createdAt).toLocaleDateString(intl, { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                </div>
              </div>

              {/* View Details Indicator */}
              <div className="px-4 py-2 border-t text-center" style={{ borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}>
                <div className="flex items-center justify-center space-x-2 rtl:space-x-reverse text-xs font-medium" style={{ color: '#374151' }}>
                  <span>{t('claims.clickToView')}</span>
                  <svg className="w-3 h-3 rtl:-scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredClaims.length === 0 && (
          <div className="text-center py-16">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ backgroundColor: '#6b7280' }}>
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold mb-2" style={{ color: '#374151' }}>
              {searchTerm ? t('claims.noResults') : t('claims.noClaims')}
            </h3>
            <p className="text-lg" style={{ color: '#6b7280' }}>
              {searchTerm ? t('claims.modifySearch') : t('claims.noClaimsYet')}
            </p>
          </div>
        )}

        {/* Navigation Button */}
        <div className="mt-12 flex justify-center">
          <button
            onClick={() => router.push('/home')}
            className="text-white px-8 py-4 rounded-2xl font-bold shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 rtl:space-x-reverse"
            style={{ backgroundColor: '#374151' }}
          >
            <svg className="w-6 h-6 rtl:-scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>{t('claims.backToDashboard')}</span>
          </button>
        </div>
      </div>

      {/* Nouvelle Réclamation Modal */}
      {canWrite && newClaimOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)' }}>
              <h3 className="text-white text-xl font-bold">{t('claims.newClaim')}</h3>
              <button onClick={() => setNewClaimOpen(false)} className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('claims.fullName')} <span className="text-red-600">*</span></label>
                  <input required className="w-full p-2 border rounded" value={newClaimForm.insuredFullName} onChange={(e)=>setNewClaimForm({...newClaimForm, insuredFullName: e.target.value})} autoComplete="name" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('claims.phone')} <span className="text-red-600">*</span></label>
                  <input type="tel" required className="w-full p-2 border rounded" value={newClaimForm.phoneNumber} onChange={(e)=>setNewClaimForm({...newClaimForm, phoneNumber: e.target.value})} autoComplete="tel" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('claims.incidentDate')}</label>
                  <input type="date" className="w-full p-2 border rounded" value={newClaimForm.incidentDate} onChange={(e)=>setNewClaimForm({...newClaimForm, incidentDate: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('claims.incidentLocation')}</label>
                  <input className="w-full p-2 border rounded" value={newClaimForm.incidentLocation} onChange={(e)=>setNewClaimForm({...newClaimForm, incidentLocation: e.target.value})} autoComplete="off" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('claims.description')}</label>
                  <textarea className="w-full p-2 border rounded" rows={3} value={newClaimForm.damageDescription} onChange={(e)=>setNewClaimForm({...newClaimForm, damageDescription: e.target.value})} />
                </div>
              </div>
              <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
                {t('claims.requiredNote')}
              </p>
            </div>
            {/* Footer */}
            <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}>
              <button onClick={() => setNewClaimOpen(false)} className="px-4 py-2 rounded-xl font-medium border hover:bg-gray-50 transition-colors" style={{ borderColor: '#d1d5db', color: '#6b7280' }}>{t('common.cancel')}</button>
              <button onClick={saveNewClaim} disabled={newClaimSaving || !newClaimForm.insuredFullName.trim() || !newClaimForm.phoneNumber.trim()} className="px-4 py-2 rounded-xl font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)' }}>
                {newClaimSaving ? t('claims.creating') : t('claims.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
