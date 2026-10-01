'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch } from '@/lib/authedFetch';
import { useI18n } from '@/components/I18nProvider';
import { useCurrentUser } from '@/components/CurrentUser';
import { claimTypeLabel } from '@/lib/i18n/claimLabels';

interface Customer {
  id: string;
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  claims: {
    id: string;
    claimNumber: string;
    status: string;
    type: string;
    createdAt: string;
  }[];
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

export default function ClientsPage() {
  const { t, intl } = useI18n();
  const { canWrite } = useCurrentUser();
  const router = useRouter();
  const [clients, setClients] = useState<Customer[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredClients, setFilteredClients] = useState<Customer[]>([]);

  const [selectedClient, setSelectedClient] = useState<Customer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [clientClaims, setClientClaims] = useState<any[]>([]);
  // New client modal state
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientSaving, setNewClientSaving] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ firstName: '', lastName: '', phoneNumber: '', email: '' });
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  // The same person is one client (one number per company); several clients
  // with the same name but different numbers are flagged for staff to review,
  // never merged automatically (two people can share a name).
  const sameNameCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) {
      const key = nameKey(c);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [clients]);

  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    if (q === '') {
      setFilteredClients(clients);
      return;
    }
    // Filter clients
    const filtered = clients.filter(client => 
      `${client.firstName || ''} ${client.lastName || ''}`.toLowerCase().includes(q) ||
      client.phoneNumber.toLowerCase().includes(q) ||
      (client.email || '').toLowerCase().includes(q) ||
      client.claims.some(claim =>
        claim.claimNumber.toLowerCase().includes(q) ||
        claim.status.toLowerCase().includes(q) ||
        claim.type.toLowerCase().includes(q)
      )
    );
    setFilteredClients(filtered);
  }, [searchTerm, clients]);

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

      // Fetch clients data from API
      const clientsRes = await authedFetch('/api/clients');
      if (clientsRes.ok) {
        const clientsData = await clientsRes.json();
        if (clientsData.success) {
          setClients(clientsData.clients);
          setFilteredClients(clientsData.clients);
        }
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-dismiss notification
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(t);
  }, [notification]);

  const saveNewClient = async () => {
    if (newClientSaving) return;
    // Basic client-side validation
    if (!newClientForm.firstName.trim() || !newClientForm.lastName.trim() || !newClientForm.phoneNumber.trim()) {
      setNotification({ message: t('clients.requiredFields'), type: 'error' });
      return;
    }
    try {
      setNewClientSaving(true);
      const res = await authedFetch('/api/agents/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: newClientForm.firstName || undefined,
          lastName: newClientForm.lastName || undefined,
          phoneNumber: newClientForm.phoneNumber || undefined,
          email: newClientForm.email || undefined,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || t('clients.createError'));
      }
      setNotification({ message: t('clients.created'), type: 'success' });
      setNewClientOpen(false);
      setNewClientForm({ firstName: '', lastName: '', phoneNumber: '', email: '' });
      await fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotification({ message: t('clients.createFailed', { message: msg }), type: 'error' });
    } finally {
      setNewClientSaving(false);
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
    
    return t('clients.insurance');
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
    const keys = { NEW: 'clients.status.NEW', ONGOING: 'clients.status.ONGOING', APPROVED: 'clients.status.APPROVED', REJECTED: 'clients.status.REJECTED', COMPLETED: 'clients.status.COMPLETED' } as const;
    return status in keys ? t(keys[status as keyof typeof keys]) : status;
  };

  const handleClientClick = async (client: Customer) => {
    setSelectedClient(client);
    setIsModalOpen(true);
    
    // Fetch detailed claims for this client
    try {
      // By customer id: exact, whatever format the number was stored in.
      const response = await authedFetch(`/api/claims?customerId=${encodeURIComponent(client.id)}`);
      if (response.ok) {
        const data = await response.json();
        setClientClaims(data.claims || []);
      }
    } catch (error) {
      console.error('Failed to fetch client claims:', error);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedClient(null);
    setClientClaims([]);
  };



  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-transparent mx-auto" style={{ borderTopColor: 'rgb(32, 33, 36)' }}></div>
          </div>
          <div className="mt-6 space-y-2">
            <p className="text-xl font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('clients.loading')}</p>
            <p className="text-sm" style={{ color: '#5F6368' }}>{t('clients.fetchingData')}</p>
          </div>
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
      {/* Chrome-inspired Company Banner */}
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
                {t('clients.title')}
              </h1>
              <div className="h-1 mt-4 mx-auto w-3/4" style={{ backgroundColor: '#DEE1E6' }}></div>
            </div>
            <p className="mt-6 text-xl font-medium" style={{ color: '#DEE1E6' }}>
              {t('clients.database', { company: getCompanyName() })}
            </p>
            <div className="mt-4 flex justify-center space-x-6 rtl:space-x-reverse">
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse me-2"></div>
                <span className="text-sm font-medium">{t('clients.count', { count: filteredClients.length })}</span>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-h-screen p-0">
        <div className="max-w-7xl mx-auto">
          
          {/* Search and Filter Bar */}
          <div className="mt-6 mb-8 shadow-2xl rounded-2xl border" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
            <div className="p-8">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                
                {/* Search Bar */}
                <div className="flex-1 lg:me-8">
                  <div className="relative">
                    <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none">
                      <svg className="h-5 w-5" style={{ color: '#5F6368' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <input
                      type="search"
                      className="w-full ps-10 pe-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                      style={{ 
                        borderColor: '#DEE1E6',
                        backgroundColor: 'white'
                      }}
                      name="clientSearch"
                      autoComplete="off"
                      placeholder={t('clients.searchPlaceholder')}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>

                {/* Nouveau Client Button (hidden from read-only roles) */}
                {canWrite && (
                <div className="mt-2 lg:mt-0">
                  <button
                    data-write-action="new-client"
                    onClick={() => setNewClientOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-xl font-medium text-white hover:opacity-90 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)' }}
                    aria-label={t('clients.newClient')}
                  >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t('clients.newClient')}
                  </button>
                </div>
                )}

              </div>
            </div>
          </div>

          {/* Clients Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredClients.map((client) => (
              <div key={client.id} className="group">
                <div
                  className="bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105 cursor-pointer border-2 overflow-hidden"
                  style={{ borderColor: '#6b7280' }}
                  onClick={() => handleClientClick(client)}
                >
                  {/* Client Header */}
                  <div 
                    className="px-4 py-3 text-center"
                    style={{ 
                      background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)',
                    }}
                  >
                    <div className="flex items-center justify-center space-x-2 rtl:space-x-reverse mb-2">
                      <div className="w-8 h-8 rounded-full bg-black/20 backdrop-blur-sm flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <span className="text-white font-bold">
                        {clientDisplayName(client) || client.phoneNumber}
                      </span>
                    </div>
                    
                    {!clientDisplayName(client) && (
                      <div className="text-white/80 text-xs mb-2">{t('clients.whatsappContact')}</div>
                    )}
                    {(sameNameCount.get(nameKey(client)) || 0) > 1 && (
                      <div className="text-xs mb-2 rounded px-2 py-1" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                        {t('clients.sameNameBadge', { count: (sameNameCount.get(nameKey(client)) || 1) - 1 })}
                      </div>
                    )}
                    <div className="inline-flex items-center space-x-2 rtl:space-x-reverse bg-black/20 backdrop-blur-sm rounded-full px-3 py-1">
                      <div className={`w-2 h-2 rounded-full ${
                        client.isActive ? 'bg-white animate-pulse' : 'bg-gray-400'
                      }`}></div>
                      <span className="text-white text-xs font-medium">
                        {client.isActive ? t('common.active') : t('common.inactive')}
                      </span>
                    </div>
                  </div>

                  {/* Content Section */}
                  <div className="p-4 space-y-3">
                    {/* Phone Number */}
                    <div className="flex items-center space-x-2 rtl:space-x-reverse text-sm">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span className="font-medium text-gray-800">{client.phoneNumber}</span>
                    </div>
                    
                    {/* Client ID */}
                    <div className="flex items-center space-x-2 rtl:space-x-reverse text-sm">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      <span className="text-gray-600">{t('clients.id', { id: client.id })}</span>
                    </div>
                    
                    {/* Email */}
                    <div className="flex items-center space-x-2 rtl:space-x-reverse text-sm">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="text-gray-600">
                        {client.email || t('clients.emailNotProvided')}
                      </span>
                    </div>
                    
                    {/* Claims Count */}
                    <div className="flex items-center space-x-2 rtl:space-x-reverse text-sm">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-gray-600">{t('clients.claimCount', { count: client.claims.length })}</span>
                    </div>
                    
                    {/* Created Date */}
                    <div className="flex items-center space-x-2 rtl:space-x-reverse text-sm">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-gray-600">
                        {client.createdAt ? new Date(client.createdAt).toLocaleDateString(intl) : t('clients.unknownDate')}
                      </span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="px-4 pb-4">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClientClick(client);
                      }}
                      className="w-full px-4 py-2 text-sm font-medium text-white rounded-lg transition-all duration-200 hover:opacity-90"
                      style={{ 
                        background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)',
                      }}
                    >
                      {t('clients.viewFullProfile')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>



          {/* Empty State */}
          {filteredClients.length === 0 && (
            <div className="text-center py-16">
              <svg className="mx-auto h-24 w-24 mb-4" style={{ color: '#DEE1E6' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 className="text-2xl font-bold mb-2" style={{ color: 'rgb(32, 33, 36)' }}>
                {searchTerm ? t('clients.noResults') : t('clients.noClients')}
              </h3>
              <p className="text-lg" style={{ color: '#5F6368' }}>
                {searchTerm 
                  ? t('clients.tryDifferentTerms')
                  : t('clients.clientsWillAppear')
                }
              </p>
            </div>
          )}

          {/* Back to Overview Button */}
          <div className="mt-12 text-center">
            <button
              onClick={() => router.push('/home')}
              className="text-white px-8 py-4 rounded-2xl font-bold shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 rtl:space-x-reverse mx-auto"
              style={{ backgroundColor: 'rgb(32, 33, 36)' }}
            >
              <svg className="w-6 h-6 rtl:-scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>{t('clients.backToOverview')}</span>
            </button>
          </div>
        </div>
      </div>
      {/* Client Details Modal */}
      {isModalOpen && selectedClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="relative px-6 py-8 text-center" style={{ background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)' }}>
              <button
                onClick={closeModal}
                className="absolute top-4 end-4 w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-black/20 backdrop-blur-sm flex items-center justify-center">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              
              <h2 className="text-3xl font-bold text-white mb-2">
                {clientDisplayName(selectedClient) || t('clients.anonymousCustomer')}
              </h2>
              
              <div className="flex items-center justify-center space-x-4 rtl:space-x-reverse">
                <div className="inline-flex items-center space-x-2 rtl:space-x-reverse bg-black/20 backdrop-blur-sm rounded-full px-4 py-2">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <span className="text-white font-medium">{selectedClient.phoneNumber}</span>
                </div>
                
                <div className={`inline-flex items-center space-x-2 rtl:space-x-reverse rounded-full px-4 py-2 ${
                  selectedClient.isActive ? 'bg-white/20 text-white' : 'bg-gray-600/20 text-gray-200'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    selectedClient.isActive ? 'bg-white animate-pulse' : 'bg-gray-400'
                  }`}></div>
                  <span className="font-medium">{selectedClient.isActive ? t('common.active') : t('common.inactive')}</span>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Client Information */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 rtl:space-x-reverse" style={{ color: '#374151' }}>
                      <div className="p-2 rounded-lg" style={{ backgroundColor: '#6b7280' }}>
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <span>{t('clients.clientInformation')}</span>
                    </h3>
                    
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl" style={{ backgroundColor: '#f9fafb' }}>
                        <div className="flex items-center space-x-3 rtl:space-x-reverse">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#6b7280' }}>
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clients.email')}</p>
                            <p className="font-semibold" style={{ color: '#374151' }}>
                              {selectedClient.email || t('clients.notProvided')}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 rounded-xl" style={{ backgroundColor: '#f9fafb' }}>
                        <div className="flex items-center space-x-3 rtl:space-x-reverse">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#374151' }}>
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a4 4 0 118 0v4m-4 0v8m0 0l3-3m-3 3l-3-3" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clients.registrationDate')}</p>
                            <p className="font-semibold" style={{ color: '#374151' }}>
                              {new Date(selectedClient.createdAt).toLocaleDateString(intl, { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Claims Information */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 rtl:space-x-reverse" style={{ color: '#374151' }}>
                      <div className="p-2 rounded-lg" style={{ backgroundColor: '#6b7280' }}>
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <span>{t('clients.claims', { count: clientClaims.length })}</span>
                    </h3>
                    
                    {clientClaims.length > 0 ? (
                      <div className="space-y-3 max-h-80 overflow-y-auto">
                        {clientClaims.map((claim) => (
                          <div key={claim.id} className="p-4 rounded-xl border-2 hover:shadow-md transition-shadow" style={{ borderColor: '#6b7280', backgroundColor: '#f9fafb' }}>
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center space-x-3 rtl:space-x-reverse">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: '#6b7280' }}>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                </div>
                                <span className="font-bold" style={{ color: '#374151' }}>
                                  #{claim.claimNumber}
                                </span>
                              </div>
                              <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusColor(claim.status)}`}>
                                {getStatusText(claim.status)}
                              </span>
                            </div>
                            
                            <p className="text-sm mb-3" style={{ color: '#5f6368' }}>
                              {claim.description || t('clients.noDescription')}
                            </p>
                            
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#6b7280' }}></div>
                                <span style={{ color: '#6b7280' }}>{t('clients.type')}</span>
                                <span className="font-medium" style={{ color: '#374151' }}>
                                  {claimTypeLabel(t, claim.type)}
                                </span>
                              </div>
                              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#9ca3af' }}></div>
                                <span style={{ color: '#6b7280' }}>{t('clients.date')}</span>
                                <span className="font-medium" style={{ color: '#374151' }}>
                                  {claim.incidentDate ? new Date(claim.incidentDate).toLocaleDateString(intl, { timeZone: 'UTC' }) : new Date(claim.createdAt).toLocaleDateString(intl)}
                                </span>
                              </div>
                            </div>
                            
                            {claim.estimatedAmount && (
                              <div className="mt-3 pt-3 border-t" style={{ borderColor: '#e5e7eb' }}>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{t('clients.estimatedAmount')}</span>
                                  <span className="text-lg font-bold" style={{ color: '#374151' }}>
                                    {claim.estimatedAmount.toLocaleString(intl, { style: 'currency', currency: 'EUR' })}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: '#6b7280' }}>
                          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="text-lg font-medium mb-2" style={{ color: '#374151' }}>
                          {t('clients.noClaimsDeclared')}
                        </p>
                        <p className="text-sm" style={{ color: '#6b7280' }}>
                          {t('clients.noClaimsMessage')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t flex justify-between items-center" style={{ borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}>
              <button
                onClick={closeModal}
                className="px-6 py-2 rounded-xl font-medium border hover:bg-gray-50 transition-colors"
                style={{ borderColor: '#d1d5db', color: '#6b7280' }}
              >
                {t('common.close')}
              </button>
              
              <button
                onClick={() => {
                  closeModal();
                  router.push(`/clients/${selectedClient.id}`);
                }}
                className="px-6 py-2 rounded-xl font-medium text-white hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#374151' }}
              >
                {t('clients.viewFullProfile')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nouveau Client Modal */}
      {canWrite && newClientOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)' }}>
              <h3 className="text-white text-xl font-bold">{t('clients.newClient')}</h3>
              <button onClick={() => setNewClientOpen(false)} className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('clients.firstName')} <span className="text-red-600">*</span></label>
                  <input required className="w-full p-2 border rounded" value={newClientForm.firstName} onChange={(e)=>setNewClientForm({...newClientForm, firstName: e.target.value})} autoComplete="given-name" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('clients.lastName')} <span className="text-red-600">*</span></label>
                  <input required className="w-full p-2 border rounded" value={newClientForm.lastName} onChange={(e)=>setNewClientForm({...newClientForm, lastName: e.target.value})} autoComplete="family-name" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('clients.phone')} <span className="text-red-600">*</span></label>
                  <input type="tel" required className="w-full p-2 border rounded" value={newClientForm.phoneNumber} onChange={(e)=>setNewClientForm({...newClientForm, phoneNumber: e.target.value})} autoComplete="tel" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">{t('clients.email')}</label>
                  <input type="email" className="w-full p-2 border rounded" value={newClientForm.email} onChange={(e)=>setNewClientForm({...newClientForm, email: e.target.value})} autoComplete="email" />
                </div>
              </div>
              <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
                {t('clients.requiredNote')}
              </p>
            </div>
            {/* Footer */}
            <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}>
              <button onClick={() => setNewClientOpen(false)} className="px-4 py-2 rounded-xl font-medium border hover:bg-gray-50 transition-colors" style={{ borderColor: '#d1d5db', color: '#6b7280' }}>{t('common.cancel')}</button>
              <button onClick={saveNewClient} disabled={newClientSaving || !newClientForm.firstName.trim() || !newClientForm.lastName.trim() || !newClientForm.phoneNumber.trim()} className="px-4 py-2 rounded-xl font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)' }}>
                {newClientSaving ? t('clients.creating') : t('clients.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function clientDisplayName(client: { firstName?: string | null; lastName?: string | null }): string {
  return [client.firstName, client.lastName].map((v) => (v || '').trim()).filter(Boolean).join(' ');
}

function nameKey(client: { firstName?: string | null; lastName?: string | null }): string {
  return clientDisplayName(client).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
