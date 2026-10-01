'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch } from '@/lib/authedFetch';
import LogoutButton from '@/components/LogoutButton';
import { useI18n } from '@/components/I18nProvider';
import { useCurrentUser } from '@/components/CurrentUser';

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

interface Analytics {
  totalClaims: number;
  newClaims: number;
  ongoingClaims: number;
  approvedClaims: number;
  rejectedClaims: number;
  completedClaims: number;
  resolutionRate: number;
  avgResponseTime: number;
  escalationRate: number;
  avgSatisfactionRating: number;
  totalConversations: number;
  totalFeedbacks: number;
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

function NewClaimModal({ isOpen, onClose, onSuccess, userCompany }: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userCompany: string;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [company, setCompany] = useState('');
  const [formData, setFormData] = useState<any>({});
  const [loading, setLoading] = useState(false);

  // Update step and company when userCompany or modal opens
  useEffect(() => {
    if (isOpen) {
      // Tenant context comes from the authenticated user.
      setStep(2);
      setCompany('tenant');
      setFormData({});
    }
  }, [isOpen, userCompany]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = '/api/claims';
      const data = {
        ...formData,
        vehicleYear: parseInt(formData.vehicleYear || '2020'),
        policeContacted: !!formData.policeContacted,
        injuriesOccurred: !!formData.injuriesOccurred,
        totalPhotosUploaded: 0
      };

      const response = await authedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        onSuccess();
        onClose();
        // Reset will happen in useEffect when modal reopens
      } else {
        alert(t('home.createError'));
      }
    } catch (error) {
      alert(t('home.createError'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-4 mx-auto p-5 border max-w-2xl shadow-lg rounded-xl" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium" style={{ color: 'rgb(32, 33, 36)' }}>
            {t('home.newClaim')}
          </h3>
          <button onClick={onClose} style={{ color: '#5F6368' }} className="hover:text-gray-600">✕</button>
        </div>

        {step === 1 && false && (
          <div>
            <h4 className="text-md font-medium mb-4" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.selectCompany')}</h4>
            <div className="space-y-3">
              <button
                onClick={() => { setCompany('tenant'); setStep(2); }}
                className="w-full p-4 text-start border rounded-lg transition-colors"
                style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F1F3F4'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
              >
                <div className="font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.yourCompany')}</div>
                <div className="text-sm" style={{ color: '#5F6368' }}>{t('home.autoClaimForm')}</div>
              </button>
              <button
                onClick={() => { setCompany('other'); setStep(2); }}
                className="w-full p-4 text-start border rounded-lg transition-colors"
                style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F1F3F4'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
              >
                <div className="font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.otherInsurance')}</div>
                <div className="text-sm" style={{ color: '#5F6368' }}>{t('home.generalClaimForm')}</div>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit}>
            <div className="max-h-96 overflow-y-auto space-y-4">
              {company === 'tenant' ? (
                <>
                  <input
                    type="text"
                    placeholder={t('home.policyNumber')}
                    required
                    value={formData.policyNumber || ''}
                    onChange={(e) => setFormData({...formData, policyNumber: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="text"
                    placeholder={t('home.fullName')}
                    required
                    value={formData.insuredFullName || ''}
                    onChange={(e) => setFormData({...formData, insuredFullName: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="tel"
                    placeholder={t('home.phoneNumber')}
                    required
                    value={formData.phoneNumber || ''}
                    onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <textarea
                    placeholder={t('home.address')}
                    required
                    value={formData.address || ''}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={2}
                  />
                  <input
                    type="date"
                    placeholder={t('home.birthDate')}
                    required
                    value={formData.birthDate || ''}
                    onChange={(e) => setFormData({...formData, birthDate: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="text"
                    placeholder={t('home.licenseNumber')}
                    required
                    value={formData.licenseNumber || ''}
                    onChange={(e) => setFormData({...formData, licenseNumber: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="text"
                    placeholder={t('home.vehicleMakeModel')}
                    required
                    value={formData.vehicleMakeModel || ''}
                    onChange={(e) => setFormData({...formData, vehicleMakeModel: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="number"
                    placeholder={t('home.vehicleYear')}
                    required
                    value={formData.vehicleYear || ''}
                    onChange={(e) => setFormData({...formData, vehicleYear: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="text"
                    placeholder={t('home.vehicleRegistration')}
                    required
                    value={formData.vehicleRegistration || ''}
                    onChange={(e) => setFormData({...formData, vehicleRegistration: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="text"
                    placeholder={t('home.vehicleVin')}
                    required
                    value={formData.vehicleVin || ''}
                    onChange={(e) => setFormData({...formData, vehicleVin: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="datetime-local"
                    placeholder={t('home.incidentDate')}
                    required
                    value={formData.incidentDate || ''}
                    onChange={(e) => setFormData({...formData, incidentDate: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="text"
                    placeholder={t('home.incidentLocation')}
                    required
                    value={formData.incidentLocation || ''}
                    onChange={(e) => setFormData({...formData, incidentLocation: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <textarea
                    placeholder={t('home.damageDescription')}
                    required
                    value={formData.damageDescription || ''}
                    onChange={(e) => setFormData({...formData, damageDescription: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                  />
                </>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder={t('home.customerName')}
                    required
                    value={formData.customerName || ''}
                    onChange={(e) => setFormData({...formData, customerName: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="tel"
                    placeholder={t('home.phoneNumber')}
                    required
                    value={formData.phoneNumber || ''}
                    onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <input
                    type="datetime-local"
                    placeholder={t('home.incidentDate')}
                    required
                    value={formData.incidentDate || ''}
                    onChange={(e) => setFormData({...formData, incidentDate: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                  <textarea
                    placeholder={t('home.description')}
                    required
                    value={formData.description || ''}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                  />
                </>
              )}
            </div>

            <div className="flex justify-between mt-6">
              <button type="button" onClick={() => setStep(1)} className="px-4 py-2" style={{ color: '#5F6368' }}>
                {t('common.back')}
              </button>
              <div className="space-x-2 rtl:space-x-reverse">
                <button type="button" onClick={onClose} className="px-4 py-2 border rounded-md" style={{ borderColor: '#DEE1E6', color: '#5F6368' }}>
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={loading} className="px-4 py-2 text-white rounded-md" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                  {loading ? t('home.creating') : t('home.createClaim')}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { t, intl } = useI18n();
  const { canWrite, isAdmin } = useCurrentUser();
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showNewClaimModal, setShowNewClaimModal] = useState(false);

  // Detect company environment - this would be set based on the database/deployment environment
  const [companyEnvironment, setCompanyEnvironment] = useState('tenant');

  // Navigation function for quick access cards
  const handleCardNavigation = (destination: string) => {
    switch (destination) {
      case 'conversations':
        router.push('/conversations');
        break;
      case 'analytics':
        router.push('/analysis');
        break;
      case 'clients':
        router.push('/clients');
        break;
      case 'settings':
        router.push('/settings');
        break;
      default:
        console.log('Unknown destination:', destination);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Update company environment when user data is loaded
  useEffect(() => {
    if (user?.email) {
      setCompanyEnvironment('tenant');
    }
  }, [user]);



  const fetchData = async () => {
    try {
      setLoading(true);
      const [analyticsRes, profileRes, claimsRes] = await Promise.all([
        authedFetch('/api/analytics'),
        authedFetch('/api/auth/profile'),
        authedFetch('/api/agents/claims')
      ]);

      if (analyticsRes.ok) {
        const analyticsData = await analyticsRes.json();
        setAnalytics(analyticsData.analytics);
      }

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUser(profileData.user);
      }

      if (claimsRes.ok) {
        const claimsData = await claimsRes.json();
        // Claims are already sorted by createdAt desc from the API
        setClaims(claimsData.claims || []);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
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
    const keys = { NEW: 'home.status.NEW', ONGOING: 'home.status.ONGOING', APPROVED: 'home.status.APPROVED', REJECTED: 'home.status.REJECTED', COMPLETED: 'home.status.COMPLETED' } as const;
    return status in keys ? t(keys[status as keyof typeof keys]) : status;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-transparent mx-auto" style={{ borderTopColor: 'rgb(32, 33, 36)' }}></div>
          </div>
          <div className="mt-6 space-y-2">
            <p className="text-xl font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.loading')}</p>
            <p className="text-sm" style={{ color: '#5F6368' }}>{t('home.preparingData')}</p>
          </div>
        </div>
      </div>
    );
  }

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
    
    return t('home.insurance');
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      {/* Chrome-inspired Company Banner */}
      <div className="relative py-16 overflow-hidden" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
        {/* Subtle tech pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M20 20c0-5.5-4.5-10-10-10s-10 4.5-10 10 4.5 10 10 10 10-4.5 10-10zm10 0c0-5.5-4.5-10-10-10s-10 4.5-10 10 4.5 10 10 10 10-4.5 10-10z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>


        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-block">
              <h1 className="text-7xl md:text-8xl font-black text-white tracking-tight">
                {getCompanyName()}
              </h1>
              <div className="h-1 mt-4 mx-auto w-3/4" style={{ backgroundColor: '#DEE1E6' }}></div>
            </div>
            <p className="mt-6 text-xl font-medium" style={{ color: '#DEE1E6' }}>
              {t('home.insuranceDashboard')}
            </p>
            <div className="mt-4 flex justify-center space-x-6 rtl:space-x-reverse">
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse me-2"></div>
                <span className="text-sm font-medium">{t('home.systemActive')}</span>
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

      {/* Chrome-inspired Header */}
      <div className="flex-1 flex flex-col" style={{ backgroundColor: 'white' }}>
        <header className="shadow-sm border-b" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
          <div className="px-4">
            <div className="flex justify-between items-center py-2">
              <div className="flex items-center space-x-3 rtl:space-x-reverse">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-2m-2 0H7m14 0V9a2 2 0 00-2-2H9a2 2 0 00-2 2v12a2 2 0 002 2h2m2 0V9a2 2 0 012-2h2a2 2 0 012 2v12a2 2 0 01-2 2h-2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.claimsManagement')}</h2>
                  <p className="text-xs" style={{ color: '#5F6368' }}>{t('home.adminPlatform')}</p>
                </div>
              </div>
            <div className="flex items-center space-x-4 rtl:space-x-reverse">
              <div className="hidden md:flex items-center space-x-3 rtl:space-x-reverse rounded-lg px-3 py-2" style={{ backgroundColor: '#F1F3F4' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                  <span className="text-white text-xs font-bold">
                    {user?.firstName?.charAt(0) || 'A'}
                  </span>
                </div>
                <div className="text-sm">
                  <p className="font-medium" style={{ color: 'rgb(32, 33, 36)' }}>
                    {user?.firstName} {user?.lastName}
                  </p>
                  <p style={{ color: '#5F6368' }}>{user?.role}</p>
                </div>
              </div>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Container with Chrome styling */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="shadow-xl rounded-2xl overflow-hidden border min-h-[calc(100vh-200px)]" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
          {/* Main Content */}
          <main className="p-0">
            <div className="space-y-8" style={{ padding: '5%' }}>
              {/* Chrome-style Stats Cards */}
              {analytics && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="group hover:scale-105 transition-all duration-300">
                      <div className="overflow-hidden shadow-lg rounded-xl border" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                        <div className="p-6 relative">
                          <div className="flex items-center justify-between">
                            <div className="flex-shrink-0">
                              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                                <span className="text-white text-2xl">📋</span>
                              </div>
                            </div>
                            <div className="text-end">
                              <div className="text-3xl font-black" style={{ color: 'rgb(32, 33, 36)' }}>{analytics.totalClaims}</div>
                              <div className="font-medium" style={{ color: '#5F6368' }}>{t('home.totalClaims')}</div>
                            </div>
                          </div>
                          <div className="absolute top-0 end-0 w-20 h-20 rounded-full -me-10 -mt-10" style={{ backgroundColor: '#F1F3F4', opacity: 0.3 }}></div>
                        </div>
                      </div>
                    </div>

                    <div className="group hover:scale-105 transition-all duration-300">
                      <div className="overflow-hidden shadow-lg rounded-xl border" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                        <div className="p-6 relative">
                          <div className="flex items-center justify-between">
                            <div className="flex-shrink-0">
                              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                                <span className="text-white text-2xl">✅</span>
                              </div>
                            </div>
                            <div className="text-end">
                              <div className="text-3xl font-black" style={{ color: 'rgb(32, 33, 36)' }}>{analytics.resolutionRate.toFixed(1)}%</div>
                              <div className="font-medium" style={{ color: '#5F6368' }}>{t('home.resolutionRate')}</div>
                            </div>
                          </div>
                          <div className="absolute top-0 end-0 w-20 h-20 rounded-full -me-10 -mt-10" style={{ backgroundColor: '#F1F3F4', opacity: 0.3 }}></div>
                        </div>
                      </div>
                    </div>

                    <div className="group hover:scale-105 transition-all duration-300">
                      <div className="overflow-hidden shadow-lg rounded-xl border" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                        <div className="p-6 relative">
                          <div className="flex items-center justify-between">
                            <div className="flex-shrink-0">
                              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                                <span className="text-white text-2xl">💬</span>
                              </div>
                            </div>
                            <div className="text-end">
                              <div className="text-3xl font-black" style={{ color: 'rgb(32, 33, 36)' }}>{analytics.totalConversations}</div>
                              <div className="font-medium" style={{ color: '#5F6368' }}>{t('home.conversations')}</div>
                            </div>
                          </div>
                          <div className="absolute top-0 end-0 w-20 h-20 rounded-full -me-10 -mt-10" style={{ backgroundColor: '#F1F3F4', opacity: 0.3 }}></div>
                        </div>
                      </div>
                    </div>

                    <div className="group hover:scale-105 transition-all duration-300">
                      <div className="overflow-hidden shadow-lg rounded-xl border" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                        <div className="p-6 relative">
                          <div className="flex items-center justify-between">
                            <div className="flex-shrink-0">
                              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                                <span className="text-white text-2xl">⭐</span>
                              </div>
                            </div>
                            <div className="text-end">
                              <div className="text-3xl font-black" style={{ color: 'rgb(32, 33, 36)' }}>{analytics.avgSatisfactionRating.toFixed(1)}/5</div>
                              <div className="font-medium" style={{ color: '#5F6368' }}>{t('home.satisfaction')}</div>
                            </div>
                          </div>
                          <div className="absolute top-0 end-0 w-20 h-20 rounded-full -me-10 -mt-10" style={{ backgroundColor: '#F1F3F4', opacity: 0.3 }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chrome-style Recent Claims */}
                <div className="shadow-lg rounded-xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                  <div className="px-6 py-4 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                        <span className="me-3">🔥</span>
                        {t('home.recentClaims')}
                      </h3>
                      <span className="text-sm bg-white px-3 py-1 rounded-full" style={{ color: '#5F6368' }}>
                        {t('home.totalCount', { count: claims.length })}
                      </span>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="space-y-4">
                      {claims.slice(0, 5).map((claim, index) => (
                        <div key={claim.id} className="group cursor-pointer" onClick={() => router.push(`/clients/claims/${claim.claimNumber}`)}>
                          <div className="flex items-center justify-between p-4 rounded-xl border hover:shadow-lg transition-all duration-300 hover:border-gray-400" 
                               style={{ 
                                 backgroundColor: 'white', 
                                 borderColor: '#DEE1E6'
                               }}>
                            <div className="flex items-center space-x-4 rtl:space-x-reverse">
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                                {index + 1}
                              </div>
                              <div>
                                <p className="text-sm font-bold" style={{ color: 'rgb(32, 33, 36)' }}>#{claim.claimNumber}</p>
                                <p className="text-sm" style={{ color: '#5F6368' }}>{claim.customer.firstName} {claim.customer.lastName}</p>
                                <p className="text-xs" style={{ color: '#80868B' }}>{claim.customer.phoneNumber}</p>
                              </div>
                            </div>
                            <div className="text-end">
                              <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusColor(claim.status)}`}>
                                {getStatusText(claim.status)}
                              </span>
                              <div className="text-xs mt-1" style={{ color: '#80868B' }}>
                                {new Date(claim.createdAt).toLocaleDateString(intl)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quick Access Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Conversations Card */}
                  <div className="shadow-lg rounded-xl border overflow-hidden hover:scale-105 transition-all duration-300 cursor-pointer" 
                       onClick={() => handleCardNavigation('conversations')}
                       style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                    <div className="p-6">
                      <div className="flex items-center space-x-4 rtl:space-x-reverse">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.conversations')}</h3>
                          <p className="text-sm" style={{ color: '#5F6368' }}>{t('home.latestActiveConversation')}</p>
                          <div className="mt-2 p-2 rounded" style={{ backgroundColor: '#F1F3F4' }}>
                            <p className="text-xs truncate" style={{ color: 'rgb(32, 33, 36)' }}>
                              {t('home.conversationPreview')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Analytics Summary Card */}
                  <div className="shadow-lg rounded-xl border overflow-hidden hover:scale-105 transition-all duration-300 cursor-pointer" 
                       onClick={() => handleCardNavigation('analytics')}
                       style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                    <div className="p-6">
                      <div className="flex items-center space-x-4 rtl:space-x-reverse">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.advancedAnalysis')}</h3>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="text-center p-2 rounded" style={{ backgroundColor: '#F1F3F4' }}>
                              <div className="text-lg font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{analytics?.newClaims || 0}</div>
                              <div className="text-xs" style={{ color: '#5F6368' }}>{t('home.status.NEW')}</div>
                            </div>
                            <div className="text-center p-2 rounded" style={{ backgroundColor: '#F1F3F4' }}>
                              <div className="text-lg font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{analytics?.completedClaims || 0}</div>
                              <div className="text-xs" style={{ color: '#5F6368' }}>{t('home.resolved')}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Clients Card */}
                  <div className="shadow-lg rounded-xl border overflow-hidden hover:scale-105 transition-all duration-300 cursor-pointer" 
                       onClick={() => handleCardNavigation('clients')}
                       style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                    <div className="p-6">
                      <div className="flex items-center space-x-4 rtl:space-x-reverse">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.newClients')}</h3>
                          <p className="text-sm" style={{ color: '#5F6368' }}>{t('home.addedToday')}</p>
                          <div className="mt-2 flex items-center space-x-2 rtl:space-x-reverse">
                            <div className="text-2xl font-bold" style={{ color: 'rgb(32, 33, 36)' }}>
                              {new Date().getDate() % 10 + 3}
                            </div>
                            <div className="text-sm" style={{ color: '#5F6368' }}>{t('home.clients')}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Settings Card (admins only, like the sidebar link) */}
                  {isAdmin && (
                  <div data-admin-action="settings" className="shadow-lg rounded-xl border overflow-hidden hover:scale-105 transition-all duration-300 cursor-pointer" 
                       onClick={() => handleCardNavigation('settings')}
                       style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
                    <div className="p-6">
                      <div className="flex items-center space-x-4 rtl:space-x-reverse">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.settings')}</h3>
                          <p className="text-sm" style={{ color: '#5F6368' }}>{t('home.customizeChatbot')}</p>
                          <div className="mt-2">
                            <button className="text-xs px-3 py-1 rounded-full transition-colors"
                                    style={{ backgroundColor: '#F1F3F4', color: 'rgb(32, 33, 36)' }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#DEE1E6'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#F1F3F4'}>
                              {t('home.configure')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>

      {/* New Claim Modal */}
      <NewClaimModal 
        isOpen={canWrite && showNewClaimModal}
        onClose={() => setShowNewClaimModal(false)}
        onSuccess={fetchData}
        userCompany={companyEnvironment}
      />

      {/* Chrome-style Claim Details Modal */}
      {selectedClaim && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-xl" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
            <div className="mt-3">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.claimDetails')}</h3>
                <button onClick={() => setSelectedClaim(null)} style={{ color: '#5F6368' }} className="hover:text-gray-600">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.claimNumber')}</p>
                  <p className="text-sm" style={{ color: '#5F6368' }}>#{selectedClaim.claimNumber}</p>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.customer')}</p>
                  <p className="text-sm" style={{ color: '#5F6368' }}>{selectedClaim.customer.firstName} {selectedClaim.customer.lastName}</p>
                  <p className="text-sm" style={{ color: '#80868B' }}>{selectedClaim.customer.phoneNumber}</p>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.typeAndStatus')}</p>
                  <div className="flex space-x-2 rtl:space-x-reverse mt-1">
                    <span className="px-2 py-1 text-xs font-medium rounded-full" style={{ backgroundColor: '#F1F3F4', color: 'rgb(32, 33, 36)' }}>
                      {selectedClaim.type}
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(selectedClaim.status)}`}>
                      {getStatusText(selectedClaim.status)}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.amount')}</p>
                  <p className="text-sm" style={{ color: '#5F6368' }}>${selectedClaim.estimatedAmount?.toLocaleString(intl) || t('home.notAvailable')}</p>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.description')}</p>
                  <p className="text-sm" style={{ color: '#5F6368' }}>{selectedClaim.description}</p>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'rgb(32, 33, 36)' }}>{t('home.incidentDateLabel')}</p>
                  <p className="text-sm" style={{ color: '#5F6368' }}>{new Date(selectedClaim.incidentDate).toLocaleDateString(intl, { timeZone: 'UTC' })}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
