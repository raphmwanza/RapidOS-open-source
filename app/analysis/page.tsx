'use client';

import { useState, useEffect } from 'react';
import LiveClock from '@/components/LiveClock';
import { authedFetch } from '@/lib/authedFetch';
import { useI18n } from '@/components/I18nProvider';

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

//

export default function AnalysisPage() {
  const { t, intl } = useI18n();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [analyticsRes, profileRes] = await Promise.all([
        authedFetch('/api/analytics'),
        authedFetch('/api/auth/profile')
      ]);

      if (analyticsRes.ok) {
        const analyticsData = await analyticsRes.json();
        setAnalytics(analyticsData.analytics);
      }

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUser(profileData.user);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
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
    
    return t('analysis.insurance');
  };

  // Chart data would be computed inline in components as needed

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-transparent mx-auto" style={{ borderTopColor: 'rgb(32, 33, 36)' }}></div>
          </div>
          <div className="mt-6 space-y-2">
            <p className="text-xl font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('analysis.loading')}</p>
            <p className="text-sm" style={{ color: '#5F6368' }}>{t('analysis.processing')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      {/* Chrome-inspired Company Banner */}
      <div className="relative py-16 overflow-hidden" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M30 30c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15zm15 0c0-8.3-6.7-15-15-15s-15 6.7-15 15 6.7 15 15 15 15-6.7 15-15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>


        
        <div className="relative px-4">
          <div className="text-center">
            <div className="inline-block">
              <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">
                {t('analysis.title')}
              </h1>
              <div className="h-1 mt-2 mx-auto w-3/4" style={{ backgroundColor: '#DEE1E6' }}></div>
            </div>
            <p className="mt-3 text-lg font-medium" style={{ color: '#DEE1E6' }}>
              {t('analysis.subtitle', { company: getCompanyName() })}
            </p>
            <div className="mt-2 flex justify-center space-x-4 rtl:space-x-reverse">
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse me-2"></div>
                <span className="text-xs font-medium">{t('analysis.realtime')}</span>
              </div>
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <span className="text-xs font-medium">{t('analysis.updated')}&nbsp;</span>
                <LiveClock locale={intl} className="text-xs font-medium" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-0">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Enhanced KPI Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 px-6" style={{ paddingTop: '5%' }}>
            {/* Total Claims KPI */}
            <div className="group hover:scale-105 transition-all duration-300">
              <div className="overflow-hidden shadow-2xl rounded-2xl border-2" style={{ backgroundColor: '#1976D2', borderColor: '#1976D2' }}>
                <div className="p-8 relative">
                  <div className="absolute top-0 end-0 w-32 h-32 rounded-full -me-16 -mt-16" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-16 h-16 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="text-end">
                        <div className="text-4xl font-black text-white">{analytics?.totalClaims || 0}</div>
                        <div className="text-blue-100 font-semibold">{t('analysis.totalClaims')}</div>
                      </div>
                    </div>
                    <div className="text-white text-sm opacity-90">
                      {t('analysis.totalClaimsHint')}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Resolution Rate KPI */}
            <div className="group hover:scale-105 transition-all duration-300">
              <div className="overflow-hidden shadow-2xl rounded-2xl border-2" style={{ backgroundColor: '#388E3C', borderColor: '#388E3C' }}>
                <div className="p-8 relative">
                  <div className="absolute top-0 end-0 w-32 h-32 rounded-full -me-16 -mt-16" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-16 h-16 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="text-end">
                        <div className="text-4xl font-black text-white">{analytics?.resolutionRate?.toFixed(1) || '0'}%</div>
                        <div className="text-green-100 font-semibold">{t('analysis.resolutionRate')}</div>
                      </div>
                    </div>
                    <div className="text-white text-sm opacity-90">
                      {t('analysis.resolutionRateHint')}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Response Time KPI */}
            <div className="group hover:scale-105 transition-all duration-300">
              <div className="overflow-hidden shadow-2xl rounded-2xl border-2" style={{ backgroundColor: '#F57C00', borderColor: '#F57C00' }}>
                <div className="p-8 relative">
                  <div className="absolute top-0 end-0 w-32 h-32 rounded-full -me-16 -mt-16" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-16 h-16 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div className="text-end">
                        <div className="text-4xl font-black text-white">{analytics?.avgResponseTime || '0'}s</div>
                        <div className="text-orange-100 font-semibold">{t('analysis.responseTime')}</div>
                      </div>
                    </div>
                    <div className="text-white text-sm opacity-90">
                      {t('analysis.responseTimeHint')}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Satisfaction Rate KPI */}
            <div className="group hover:scale-105 transition-all duration-300">
              <div className="overflow-hidden shadow-2xl rounded-2xl border-2" style={{ backgroundColor: '#9C27B0', borderColor: '#9C27B0' }}>
                <div className="p-8 relative">
                  <div className="absolute top-0 end-0 w-32 h-32 rounded-full -me-16 -mt-16" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-16 h-16 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </div>
                      <div className="text-end">
                        <div className="text-4xl font-black text-white">{analytics?.avgSatisfactionRating?.toFixed(1) || '0'}/5</div>
                        <div className="text-purple-100 font-semibold">{t('analysis.satisfaction')}</div>
                      </div>
                    </div>
                    <div className="text-white text-sm opacity-90">
                      {t('analysis.satisfactionHint')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Enhanced Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            
            {/* Claims Status Distribution */}
            <div className="shadow-2xl rounded-2xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              <div className="px-8 py-6 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                <h3 className="text-2xl font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                  <svg className="w-6 h-6 me-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  {t('analysis.breakdown')}
                </h3>
              </div>
              <div className="p-8">
                <div className="grid grid-cols-1 gap-4">
                  {[
                    { status: 'NEW', count: analytics?.newClaims || 0, color: '#1976D2', label: t('analysis.status.NEW') },
                    { status: 'ONGOING', count: analytics?.ongoingClaims || 0, color: '#F57C00', label: t('analysis.status.ONGOING') },
                    { status: 'APPROVED', count: analytics?.approvedClaims || 0, color: '#388E3C', label: t('analysis.status.APPROVED') },
                    { status: 'REJECTED', count: analytics?.rejectedClaims || 0, color: '#D32F2F', label: t('analysis.status.REJECTED') },
                    { status: 'COMPLETED', count: analytics?.completedClaims || 0, color: '#616161', label: t('analysis.status.COMPLETED') }
                  ].map((item) => {
                    const percentage = analytics?.totalClaims ? ((item.count / analytics.totalClaims) * 100).toFixed(1) : '0';
                    return (
                      <div key={item.status} className="flex items-center justify-between p-4 rounded-xl border hover:shadow-lg transition-all duration-300" style={{ backgroundColor: '#F8F9FA', borderColor: '#DEE1E6' }}>
                        <div className="flex items-center space-x-4 rtl:space-x-reverse">
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold" style={{ backgroundColor: item.color }}>
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                              <circle cx="10" cy="10" r="8"/>
                            </svg>
                          </div>
                          <div>
                            <div className="font-bold text-lg" style={{ color: 'rgb(32, 33, 36)' }}>{item.label}</div>
                            <div className="text-sm" style={{ color: '#5F6368' }}>{t('claim.count', { count: item.count })}</div>
                          </div>
                        </div>
                        <div className="text-end">
                          <div className="text-2xl font-black" style={{ color: item.color }}>{percentage}%</div>
                          <div className="w-24 h-2 rounded-full mt-2" style={{ backgroundColor: '#E8EAED' }}>
                            <div 
                              className="h-2 rounded-full transition-all duration-1000" 
                              style={{ 
                                backgroundColor: item.color, 
                                width: `${percentage}%` 
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Performance Metrics */}
            <div className="shadow-2xl rounded-2xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              <div className="px-8 py-6 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                <h3 className="text-2xl font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                  <svg className="w-6 h-6 me-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  {t('analysis.performance')}
                </h3>
              </div>
              <div className="p-8">
                <div className="space-y-6">
                  {/* Resolution Rate Progress */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('analysis.resolutionRate')}</span>
                      <span className="text-xl font-bold" style={{ color: '#388E3C' }}>{analytics?.resolutionRate?.toFixed(1) || '0'}%</span>
                    </div>
                    <div className="w-full h-4 rounded-full" style={{ backgroundColor: '#E8EAED' }}>
                      <div 
                        className="h-4 rounded-full transition-all duration-1000" 
                        style={{ 
                          backgroundColor: '#388E3C', 
                          width: `${analytics?.resolutionRate || 0}%` 
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Escalation Rate Progress */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('analysis.escalationRate')}</span>
                      <span className="text-xl font-bold" style={{ color: '#D32F2F' }}>{analytics?.escalationRate?.toFixed(1) || '0'}%</span>
                    </div>
                    <div className="w-full h-4 rounded-full" style={{ backgroundColor: '#E8EAED' }}>
                      <div 
                        className="h-4 rounded-full transition-all duration-1000" 
                        style={{ 
                          backgroundColor: '#D32F2F', 
                          width: `${analytics?.escalationRate || 0}%` 
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Satisfaction Rating */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('analysis.satisfaction')}</span>
                      <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <span className="text-xl font-bold" style={{ color: '#FF9800' }}>{analytics?.avgSatisfactionRating?.toFixed(1) || '0'}/5</span>
                        <div className="flex text-yellow-400">
                          {[...Array(5)].map((_, i) => (
                            <span key={i} className={i < Math.floor(analytics?.avgSatisfactionRating || 0) ? 'text-yellow-400' : 'text-gray-300'}>
                              ⭐
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="w-full h-4 rounded-full" style={{ backgroundColor: '#E8EAED' }}>
                      <div 
                        className="h-4 rounded-full transition-all duration-1000" 
                        style={{ 
                          backgroundColor: '#FF9800', 
                          width: `${((analytics?.avgSatisfactionRating || 0) / 5) * 100}%` 
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Additional Metrics */}
                  <div className="grid grid-cols-2 gap-4 mt-8">
                    <div className="text-center p-4 rounded-xl" style={{ backgroundColor: '#F1F3F4' }}>
                      <div className="text-2xl font-black mb-2" style={{ color: 'rgb(32, 33, 36)' }}>{analytics?.totalConversations || 0}</div>
                      <div className="text-sm font-medium" style={{ color: '#5F6368' }}>{t('analysis.totalConversations')}</div>
                    </div>
                    <div className="text-center p-4 rounded-xl" style={{ backgroundColor: '#F1F3F4' }}>
                      <div className="text-2xl font-black mb-2" style={{ color: 'rgb(32, 33, 36)' }}>{analytics?.totalFeedbacks || 0}</div>
                      <div className="text-sm font-medium" style={{ color: '#5F6368' }}>{t('analysis.feedbackReceived')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Analytics Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Claims Activity Heatmap */}
            <div className="lg:col-span-2 shadow-2xl rounded-2xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              <div className="px-8 py-6 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                <h3 className="text-2xl font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                  <svg className="w-6 h-6 me-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  </svg>
                  {t('analysis.activityByStatus')}
                </h3>
              </div>
              <div className="p-8">
                <div className="grid grid-cols-5 gap-4">
                  {[
                    { status: 'NEW', count: analytics?.newClaims || 0, color: '#1976D2', label: t('analysis.status.NEW') },
                    { status: 'ONGOING', count: analytics?.ongoingClaims || 0, color: '#F57C00', label: t('analysis.status.ONGOING') },
                    { status: 'APPROVED', count: analytics?.approvedClaims || 0, color: '#388E3C', label: t('analysis.status.APPROVED') },
                    { status: 'REJECTED', count: analytics?.rejectedClaims || 0, color: '#D32F2F', label: t('analysis.status.REJECTED') },
                    { status: 'COMPLETED', count: analytics?.completedClaims || 0, color: '#616161', label: t('analysis.status.COMPLETED') }
                  ].map((item) => {
                    const maxCount = Math.max(
                      analytics?.newClaims || 0,
                      analytics?.ongoingClaims || 0,
                      analytics?.approvedClaims || 0,
                      analytics?.rejectedClaims || 0,
                      analytics?.completedClaims || 0
                    );
                    const intensity = maxCount > 0 ? (item.count / maxCount) : 0;
                    
                    return (
                      <div key={item.status} className="text-center">
                        <div 
                          className="w-full h-32 rounded-2xl mb-4 flex items-center justify-center text-white font-bold text-2xl transition-all duration-300 hover:scale-105"
                          style={{ 
                            backgroundColor: item.color,
                            opacity: 0.3 + (intensity * 0.7)
                          }}
                        >
                          {item.count}
                        </div>
                        <div className="text-sm font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{item.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Quick Stats Summary */}
            <div className="shadow-2xl rounded-2xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              <div className="px-8 py-6 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                <h3 className="text-2xl font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                  <svg className="w-6 h-6 me-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                  {t('analysis.quickSummary')}
                </h3>
              </div>
              <div className="p-8">
                <div className="space-y-6">
                  <div className="text-center p-6 rounded-2xl" style={{ backgroundColor: '#F8F9FA' }}>
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'rgb(32, 33, 36)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <div className="text-3xl font-black mb-2" style={{ color: 'rgb(32, 33, 36)' }}>
                      {((analytics?.completedClaims || 0) + (analytics?.approvedClaims || 0))} / {analytics?.totalClaims || 0}
                    </div>
                    <div className="text-sm font-medium" style={{ color: '#5F6368' }}>{t('analysis.resolvedClaims')}</div>
                  </div>

                  <div className="text-center p-6 rounded-2xl" style={{ backgroundColor: '#F8F9FA' }}>
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'rgb(32, 33, 36)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <div className="text-3xl font-black mb-2" style={{ color: 'rgb(32, 33, 36)' }}>
                      {analytics?.avgResponseTime || '0'}s
                    </div>
                    <div className="text-sm font-medium" style={{ color: '#5F6368' }}>{t('analysis.avgResponseTime')}</div>
                  </div>

                  <div className="text-center p-6 rounded-2xl" style={{ backgroundColor: '#F8F9FA' }}>
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'rgb(32, 33, 36)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <div className="text-3xl font-black mb-2" style={{ color: 'rgb(32, 33, 36)' }}>
                      {analytics?.totalConversations || 0}
                    </div>
                    <div className="text-sm font-medium" style={{ color: '#5F6368' }}>{t('analysis.activeConversations')}</div>
                  </div>

                  <div className="text-center p-6 rounded-2xl" style={{ backgroundColor: '#E8F5E8' }}>
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#2E7D2E' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-lg font-semibold" style={{ color: '#2E7D2E' }}>
                      {t('analysis.healthy')}
                    </div>
                    <div className="text-sm mt-2" style={{ color: '#5F6368' }}>
                      {t('analysis.healthyHint')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
