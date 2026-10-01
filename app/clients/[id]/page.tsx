'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { authedFetch } from '@/lib/authedFetch';
import { useCurrentUser } from '@/components/CurrentUser';
import { useI18n } from '@/components/I18nProvider';
import { claimStatusLabel, claimTypeLabel } from '@/lib/i18n/claimLabels';

interface Claim {
  id: string;
  claimNumber: string;
  status: string;
  type: string;
  description: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
  notes: ClaimNote[];
}

interface ClaimNote {
  id: string;
  content: string;
  createdAt: string;
  author: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface Customer {
  id: string;
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  claims: Claim[];
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

export default function ClientProfilePage() {
  const router = useRouter();
  const { canWrite } = useCurrentUser();
  const { t, intl } = useI18n();
  const money = (n: number) => (n || 0).toLocaleString(intl, { style: 'currency', currency: 'EUR' });
  const params = useParams();
  const clientId = params.id as string;
  
  const [client, setClient] = useState<Customer | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [newNote, setNewNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  // Edit client info state
  const [clientEditOpen, setClientEditOpen] = useState(false);
  const [clientSaving, setClientSaving] = useState(false);
  const [clientForm, setClientForm] = useState({ firstName: '', lastName: '', phoneNumber: '', email: '' });
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchData();
  }, [clientId]);

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

      // Fetch client data from API
      const clientRes = await authedFetch(`/api/clients/${clientId}`);
      if (clientRes.ok) {
        const clientData = await clientRes.json();
        if (clientData.success) {
          setClient(clientData.client);
          setClientForm({
            firstName: clientData.client.firstName || '',
            lastName: clientData.client.lastName || '',
            phoneNumber: clientData.client.phoneNumber || '',
            email: clientData.client.email || '',
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch client data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-dismiss notification
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  const saveClient = async () => {
    if (!client || clientSaving) return;
    try {
      setClientSaving(true);
      const res = await authedFetch(`/api/agents/customers/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: clientForm.firstName || undefined,
          lastName: clientForm.lastName || undefined,
          phoneNumber: clientForm.phoneNumber || undefined,
          email: clientForm.email || undefined,
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t('clientDetail.updateError'));
      }
      await res.json();
      setNotification({ message: t('clientDetail.updated'), type: 'success' });
      setClientEditOpen(false);
      await fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotification({ message: t('clientDetail.updateFailed', { message: msg }), type: 'error' });
    } finally {
      setClientSaving(false);
    }
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
    
    return t('clientDetail.insurance');
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

  const getStatusText = (status: string) => claimStatusLabel(t, status);
  const getTypeText = (type: string) => claimTypeLabel(t, type);

  const handleAddNote = async () => {
    if (!selectedClaim || !newNote.trim() || isAddingNote) return;

    setIsAddingNote(true);
    try {
      // Make API call to add note
      const response = await authedFetch(`/api/clients/${clientId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          claimId: selectedClaim.id,
          content: newNote.trim()
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const addedNote: ClaimNote = {
            id: data.note.id,
            content: data.note.content,
            createdAt: data.note.createdAt,
            author: {
              firstName: user?.firstName || 'Agent',
              lastName: user?.lastName || 'Assurance',
              email: user?.email || 'agent@assurance.com'
            }
          };

          // Update local state
          if (client) {
            const updatedClient = {
              ...client,
              claims: client.claims.map(claim => 
                claim.id === selectedClaim.id 
                  ? { ...claim, notes: [...claim.notes, addedNote] }
                  : claim
              )
            };
            setClient(updatedClient);
            
            // Update selected claim
            const updatedClaim = updatedClient.claims.find(c => c.id === selectedClaim.id);
            if (updatedClaim) {
              setSelectedClaim(updatedClaim);
            }
          }

          setNewNote('');
        }
      }
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setIsAddingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-transparent mx-auto" style={{ borderTopColor: '#374151' }}></div>
          </div>
          <div className="mt-6 space-y-2">
            <p className="text-xl font-semibold" style={{ color: '#374151' }}>{t('clientDetail.loading')}</p>
            <p className="text-sm" style={{ color: '#6b7280' }}>{t('clientDetail.fetching')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <svg className="mx-auto h-24 w-24 mb-4" style={{ color: '#DEE1E6' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <h3 className="text-2xl font-bold mb-2" style={{ color: '#374151' }}>{t('clientDetail.notFound')}</h3>
          <p className="text-lg mb-6" style={{ color: '#6b7280' }}>{t('clientDetail.notFoundMessage')}</p>
          <button
            onClick={() => router.push('/clients')}
            className="text-white px-6 py-3 rounded-xl font-bold"
            style={{ backgroundColor: '#374151' }}
          >
            {t('clientDetail.backToClients')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 end-4 z-50 px-6 py-4 rounded-lg shadow-lg ${notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          <div className="flex items-center gap-2">
            <span className="font-medium">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ms-2 opacity-80 hover:opacity-100">✕</button>
          </div>
        </div>
      )}
      {/* Chrome-inspired Client Header */}
      <div className="relative py-16 overflow-hidden" style={{ backgroundColor: '#374151' }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M30 30c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15zm15 0c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-block">
              <h1 className="text-6xl md:text-7xl font-black text-white tracking-tight">
                {client.firstName && client.lastName 
                  ? `${client.firstName} ${client.lastName}`
                  : t('clientDetail.unnamed')
                }
              </h1>
              <div className="h-1 mt-4 mx-auto w-3/4" style={{ backgroundColor: '#DEE1E6' }}></div>
            </div>
            <p className="mt-6 text-xl font-medium" style={{ color: '#d1d5db' }}>
              {t('clientDetail.profileOf', { company: getCompanyName() })}
            </p>
            <div className="mt-4 flex justify-center space-x-6 rtl:space-x-reverse">
              <div className="flex items-center" style={{ color: '#d1d5db' }}>
                <div className={`w-2 h-2 rounded-full animate-pulse me-2 ${client.isActive ? 'bg-white' : 'bg-gray-400'}`}></div>
                <span className="text-sm font-medium">{client.isActive ? t('clientDetail.active') : t('clientDetail.inactive')}</span>
              </div>
              <div className="flex items-center" style={{ color: '#d1d5db' }}>
                <span className="text-sm font-medium">{t('clientDetail.claimCount', { count: client.claims.length })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-h-screen p-8">
        <div className="max-w-7xl mx-auto">
          
          {/* Client Information Card */}
          <div className="mb-8 shadow-2xl rounded-2xl border" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
            <div className="p-8">
              <h2 className="text-2xl font-bold mb-6" style={{ color: '#374151' }}>
                {t('clientDetail.clientInformation')}
              </h2>
              {canWrite && (
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-gray-500">{t('clientDetail.editHint')}</div>
                <button data-write-action="edit-client" onClick={() => setClientEditOpen(!clientEditOpen)} className="px-3 py-1 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">
                  {clientEditOpen ? t('clientDetail.close') : t('clientDetail.edit')}
                </button>
              </div>
              )}

              {canWrite && clientEditOpen && (
                <div className="p-4 rounded-lg border mb-6 space-y-3" style={{ borderColor: '#e5e7eb' }}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">{t('clientDetail.firstName')} <span className="text-red-600">*</span></label>
                      <input required className="w-full p-2 border rounded" value={clientForm.firstName} onChange={(e)=>setClientForm({...clientForm, firstName: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">{t('clientDetail.lastName')} <span className="text-red-600">*</span></label>
                      <input required className="w-full p-2 border rounded" value={clientForm.lastName} onChange={(e)=>setClientForm({...clientForm, lastName: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">{t('clientDetail.phone')} <span className="text-red-600">*</span></label>
                      <input required className="w-full p-2 border rounded" value={clientForm.phoneNumber} onChange={(e)=>setClientForm({...clientForm, phoneNumber: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">{t('clientDetail.email')}</label>
                      <input className="w-full p-2 border rounded" value={clientForm.email} onChange={(e)=>setClientForm({...clientForm, email: e.target.value})} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                        <button className="px-4 py-2 text-sm rounded-lg border border-gray-300" onClick={()=>setClientEditOpen(false)} disabled={clientSaving}>{t('clientDetail.cancel')}</button>
                        <button className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed" style={{backgroundColor:'#374151'}} onClick={saveClient} disabled={clientSaving || !clientForm.firstName.trim() || !clientForm.lastName.trim() || !clientForm.phoneNumber.trim()}>{clientSaving ? t('clientDetail.saving') : t('clientDetail.save')}</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {/* Personal Information Section */}
                <div className="space-y-6">
                  <h3 className="text-xl font-bold" style={{ color: '#374151' }}>{t('clientDetail.personalInfo')}</h3>
                  
                  <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                      <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.fullName')}</span>
                    </div>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                      {client.firstName && client.lastName 
                        ? `${client.firstName} ${client.lastName}`
                        : t('clientDetail.notProvided')
                      }
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                      <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.phone')}</span>
                    </div>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>{client.phoneNumber}</p>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                      <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.email')}</span>
                    </div>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                      {client.email || t('clientDetail.notProvided')}
                    </p>
                  </div>
                </div>

                {/* Account Information Section */}
                <div className="space-y-6">
                  <h3 className="text-xl font-bold" style={{ color: '#374151' }}>{t('clientDetail.accountInfo')}</h3>
                  
                  <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                      <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.status')}</span>
                    </div>
                    <span className={`inline-block px-3 py-1 text-sm font-bold rounded-full ${
                      client.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {client.isActive ? t('clientDetail.statusActive') : t('clientDetail.statusInactive')}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                      <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.registrationDate')}</span>
                    </div>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                      {new Date(client.createdAt).toLocaleDateString(intl, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                      <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.lastUpdate')}</span>
                    </div>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                      {new Date(client.updatedAt).toLocaleDateString(intl)}
                    </p>
                  </div>
                </div>

                {/* Statistics Section */}
                <div className="space-y-6">
                  <h3 className="text-xl font-bold" style={{ color: '#374151' }}>{t('clientDetail.statistics')}</h3>
                  
                  <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                      <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.totalClaims')}</span>
                    </div>
                    <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                      {t('clientDetail.claimsTotal', { count: client.claims.length })}
                    </p>
                  </div>

                  {client.claims.length > 0 && (
                    <>
                      <div>
                        <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                          <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                          </svg>
                          <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.totalEstimated')}</span>
                        </div>
                        <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                          {money(client.claims.reduce((total, claim) => total + (claim.amount || 0), 0))}
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center space-x-2 rtl:space-x-reverse mb-2">
                          <svg className="w-5 h-5" style={{ color: '#6b7280' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clientDetail.lastClaim')}</span>
                        </div>
                        <p className="text-lg font-semibold" style={{ color: '#374151' }}>
                          {new Date(client.claims[0]?.createdAt).toLocaleDateString(intl)}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Claims List */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Claims Overview */}
            <div className="shadow-2xl rounded-2xl border" style={{ backgroundColor: 'white', borderColor: '#6b7280' }}>
              <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: '#6b7280' }}>
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>
                    {t('clientDetail.claimsTitle', { count: client.claims.length })}
                  </h2>
                </div>
              </div>
              <div className="p-6">
                {client.claims.length > 0 ? (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {client.claims.map((claim) => (
                      <div 
                        key={claim.id} 
                        className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                          selectedClaim?.id === claim.id 
                            ? 'border-gray-900 shadow-lg' 
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                        }`}
                        onClick={() => setSelectedClaim(claim)}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-3 rtl:space-x-reverse">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: '#6b7280' }}>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <h3 className="font-bold text-lg" style={{ color: '#374151' }}>
                              {claim.claimNumber}
                            </h3>
                          </div>
                          <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusColor(claim.status)}`}>
                            {getStatusText(claim.status)}
                          </span>
                        </div>
                        <p className="text-sm mb-2" style={{ color: '#6b7280' }}>
                          {claim.description}
                        </p>
                        <div className="flex items-center justify-between text-sm">
                          <span style={{ color: '#6b7280' }}>{getTypeText(claim.type)}</span>
                          <span className="font-bold" style={{ color: '#374151' }}>
                            {money(claim.amount)}
                          </span>
                        </div>
                          <div className="flex items-center justify-between text-xs mt-2" style={{ color: '#6b7280' }}>
                          <span>{t('clientDetail.createdOn', { date: new Date(claim.createdAt).toLocaleDateString(intl) })}</span>
                          <span>{t('clientDetail.notesCount', { count: claim.notes.length })}</span>
                        </div>
                        <div className="mt-3 pt-2 border-t" style={{ borderColor: '#e5e7eb' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/clients/claims/${claim.claimNumber}`);
                            }}
                            className="w-full px-3 py-2 text-xs font-medium text-white rounded-lg transition-all duration-200 hover:opacity-90"
                            style={{ 
                              background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)',
                            }}
                          >
                            {t('clientDetail.viewFullClaim')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <svg className="mx-auto h-16 w-16 mb-4" style={{ color: '#DEE1E6' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-lg font-medium" style={{ color: '#6b7280' }}>
                      {t('clientDetail.noClaims')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Claim Details & Notes */}
            <div className="shadow-2xl rounded-2xl border" style={{ backgroundColor: 'white', borderColor: '#6b7280' }}>
              <div className="p-6 border-b" style={{ borderColor: '#6b7280' }}>
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: '#6b7280' }}>
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold" style={{ color: '#374151' }}>
                    {selectedClaim ? t('clientDetail.claimDetails') : t('clientDetail.selectClaim')}
                  </h2>
                </div>
              </div>
              <div className="p-6">
                {selectedClaim ? (
                  <div className="space-y-6">
                    {/* Claim Details */}
                    <div className="p-4 rounded-xl" style={{ backgroundColor: '#F8F9FA' }}>
                      <h3 className="font-bold text-lg mb-3" style={{ color: '#374151' }}>
                        {selectedClaim.claimNumber}
                      </h3>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span style={{ color: '#6b7280' }}>{t('clientDetail.type')}</span>
                          <p className="font-medium" style={{ color: '#374151' }}>
                            {getTypeText(selectedClaim.type)}
                          </p>
                        </div>
                        <div>
                          <span style={{ color: '#6b7280' }}>{t('clientDetail.amount')}</span>
                          <p className="font-medium" style={{ color: '#374151' }}>
                            {money(selectedClaim.amount)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <span style={{ color: '#6b7280' }}>{t('clientDetail.description')}</span>
                        <p className="font-medium" style={{ color: '#374151' }}>
                          {selectedClaim.description}
                        </p>
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <h4 className="font-bold text-lg mb-4" style={{ color: '#374151' }}>
                        {t('clientDetail.notesTitle', { count: selectedClaim.notes.length })}
                      </h4>
                      
                      {/* Add Note Form (hidden from read-only roles) */}
                      {canWrite && (
                      <div data-write-action="add-note" className="mb-4 p-4 rounded-xl border" style={{ borderColor: '#DEE1E6' }}>
                        <textarea
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          placeholder={t('clientDetail.addNotePlaceholder')}
                          className="w-full p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-700"
                          style={{ borderColor: '#d1d5db' }}
                          rows={3}
                        />
                        <div className="flex justify-end mt-3">
                          <button
                            onClick={handleAddNote}
                            disabled={!newNote.trim() || isAddingNote}
                            className="px-4 py-2 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ backgroundColor: '#374151' }}
                          >
                            {isAddingNote ? t('clientDetail.adding') : t('clientDetail.addNote')}
                          </button>
                        </div>
                      </div>
                      )}

                      {/* Notes List */}
                      <div className="space-y-3 max-h-64 overflow-y-auto">
                        {selectedClaim.notes.map((note) => (
                          <div key={note.id} className="p-4 rounded-xl" style={{ backgroundColor: '#F8F9FA' }}>
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                                <div 
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                                  style={{ backgroundColor: '#374151' }}
                                >
                                  {note.author.firstName.charAt(0)}{note.author.lastName.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-medium text-sm" style={{ color: '#374151' }}>
                                    {note.author.firstName} {note.author.lastName}
                                  </p>
                                  <p className="text-xs" style={{ color: '#6b7280' }}>
                                    {new Date(note.createdAt).toLocaleString(intl)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm" style={{ color: '#374151' }}>
                              {note.content}
                            </p>
                          </div>
                        ))}
                        {selectedClaim.notes.length === 0 && (
                          <div className="text-center py-6">
                            <p className="text-sm" style={{ color: '#6b7280' }}>
                              {t('clientDetail.noNotes')}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: '#6b7280' }}>
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-lg font-medium" style={{ color: '#6b7280' }}>
                      {t('clientDetail.selectClaimHint')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-12 flex justify-center space-x-4 rtl:space-x-reverse">
            <button
              onClick={() => router.push('/clients')}
              className="text-white px-8 py-4 rounded-2xl font-bold shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 rtl:space-x-reverse"
              style={{ backgroundColor: '#374151' }}
            >
              <svg className="w-6 h-6 rtl:-scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>{t('clientDetail.backToClients')}</span>
            </button>
            
            <button
              onClick={() => router.push('/home')}
              className="border-2 px-8 py-4 rounded-2xl font-bold shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 rtl:space-x-reverse"
              style={{ 
                borderColor: '#6b7280', 
                color: '#374151',
                backgroundColor: 'white'
              }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m0 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span>{t('clientDetail.backToOverview')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
