'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authedFetch } from '@/lib/authedFetch';
import { useI18n } from '@/components/I18nProvider';
import { useCurrentUser } from '@/components/CurrentUser';

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string;
  createdAt: string;
  updatedAt: string;
  conversations: Array<{
    id: string;
    title: string | null;
    messages: Array<{
      id: string;
      content: string;
      role: string;
      createdAt: string;
    }>;
  }>;
  lastMessage: {
    id: string;
    content: string;
    role: string;
    createdAt: string;
  } | null;
  needsAttention: boolean;
  conversationMeta: {
    id: string;
    isEscalated: boolean;
    isBotPaused: boolean;
    pausedBy: string | null;
    pausedAt: string | null;
  };
}

// Function to determine if a conversation needs agent attention
function needsAgentAttention(lastMessage: string): boolean {
  const agentKeywords = [
    'talk to an agent',
    'speak to someone',
    'human help',
    'customer service',
    'representative',
    'agent',
    'help me',
    'complaint',
    'urgent',
    'emergency',
    'escalate',
    'manager',
    'supervisor',
    'problème',
    'aide humaine',
    'parler à quelqu\'un',
    'service client',
    'représentant',
    'plainte',
    'urgence'
  ];
  
  return agentKeywords.some(keyword => 
    lastMessage.toLowerCase().includes(keyword.toLowerCase())
  );
}

export default function ConversationsPage() {
  const { t, intl } = useI18n();
  // Opening an urgent conversation also clears its urgent flag; read-only roles just open it.
  const { canWrite } = useCurrentUser();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null); // Track which conversation is being dismissed
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const prevSignatureRef = useRef<string>('');
  const router = useRouter();

  // Function to show toast notification
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000); // Hide after 3 seconds
  };

  // Function to remove conversation from urgent queue
  const removeFromUrgentQueue = async (conversationId: string) => {
    try {
      setDismissingId(conversationId); // Set loading state for this specific conversation
      
      const response = await authedFetch(`/api/conversations/${conversationId}/remove-urgent`, {
        method: 'POST',
      });
      
      if (response.ok) {
        await response.json();
        showToast(t('conversations.urgentHandled'), 'success');
        // Refresh conversations to update the UI
        await fetchConversations(true);
      } else {
        showToast(t('conversations.urgentError'), 'error');
      }
    } catch (err) {
      console.error('Failed to remove from urgent queue:', err);
      showToast(t('conversations.urgentError'), 'error');
    } finally {
      setDismissingId(null); // Clear loading state
    }
  };

  // Fetch conversations with optional background mode
  const fetchConversations = async (isBackgroundUpdate = false) => {
    try {
      if (!isBackgroundUpdate) {
        setLoading(true);
        setError(null); // Clear previous errors
      } else {
        setIsPolling(true);
      }
      
      const response = await authedFetch('/api/conversations');
      
      if (!response.ok) {
        // Handle errors but don't redirect automatically
        let errorMessage = 'Failed to fetch conversations';
        if (response.status === 401) {
          errorMessage = 'Authentication failed. Please refresh the page.';
        } else if (response.status === 403) {
          errorMessage = 'You do not have permission to view conversations.';
        } else if (response.status === 500) {
          errorMessage = 'Server error. Please try again later.';
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      // Ensure data structure is correct
      if (!data || !Array.isArray(data.customers)) {
        console.warn('Invalid data structure received:', data);
        setCustomers([]);
        return;
      }
      
      // Process conversations to add needsAttention flag
      const processedCustomers = data.customers.map((customer: any) => {
        const lastMessage = customer.conversations?.[0]?.messages?.[0] || customer.lastMessage || null;
        return {
          ...customer,
          lastMessage,
          needsAttention: lastMessage ? needsAgentAttention(lastMessage.content) : false
        };
      });
      
      // Compute lightweight signature to avoid unnecessary re-renders
      const signature = JSON.stringify(
        processedCustomers.map((c: any) => ([
          c.id,
          c.conversationMeta?.id,
          c.conversationMeta?.isEscalated,
          c.conversationMeta?.isBotPaused,
          c.lastMessage?.id,
          c.lastMessage?.createdAt
        ]))
      );

      if (prevSignatureRef.current !== signature) {
        prevSignatureRef.current = signature;
        setCustomers(processedCustomers);
      }
      
      // Debug logging
      console.log('Processed customers:', processedCustomers.length);
      console.log('Emergency (escalated):', processedCustomers.filter((c: any) => c.conversationMeta?.isEscalated === true).length);
      console.log('Needs attention (keywords):', processedCustomers.filter((c: any) => c.needsAttention).length);
      console.log('Current conversations logic will show:', 
        processedCustomers.filter((customer: any) => 
          customer.conversationMeta?.isEscalated !== true && (
            customer.needsAttention || 
            (customer.lastMessage && 
             new Date(customer.lastMessage.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000))
          )
        ).length
      );
      
      // Clear error if fetch was successful
      if (error && !isBackgroundUpdate) {
        setError(null);
      }

      // Log filtering info for debugging
      if (data.companyKeywords) {
        console.log('Company keywords used for filtering:', data.companyKeywords);
        console.log('Total filtered conversations:', data.totalFiltered);
      }
      
    } catch (err) {
      console.error('Fetch conversations error:', err);
      if (!isBackgroundUpdate) {
        setError(err instanceof Error ? err.message : 'Failed to fetch conversations');
      }
    } finally {
      if (!isBackgroundUpdate) {
        setLoading(false);
      } else {
        setIsPolling(false);
      }
    }
  };

  useEffect(() => {
    // Initial load
    fetchConversations();
    
    // Set up background polling every 5 seconds for updates without flicker
    const interval = setInterval(() => {
      fetchConversations(true); // Background update
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  // Live clock independent from data polling
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Separate conversations by status and recency
  // Priority: Database escalation status overrides keyword detection
  const emergencyConversations = customers.filter(customer => 
    customer.conversationMeta?.isEscalated === true
  );
  
  // Current conversations: Not escalated but either has urgent keywords OR recent activity (last 24 hours)
  const currentConversations = customers.filter(customer => 
    customer.conversationMeta?.isEscalated !== true && (
      customer.needsAttention || 
      (customer.lastMessage && 
       new Date(customer.lastMessage.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000))
    )
  );
  
  // Recent conversations could be computed similarly if needed for UI

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      {/* Add custom styles for animations */}
      <style jsx>{`
        .animate-slide-in-from-right {
          animation: slideInFromRight 0.3s ease-out;
        }
        
        @keyframes slideInFromRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 end-4 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium transition-all duration-300 ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } animate-slide-in-from-right`}>
          {toast.message}
        </div>
      )}

      {/* Chrome-inspired Header */}
      <div className="relative py-12 overflow-hidden" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M20 20c0-5.5-4.5-10-10-10s-10 4.5-10 10 4.5 10 10 10 10-4.5 10-10zm10 0c0-5.5-4.5-10-10-10s-10 4.5-10 10 4.5 10 10 10 10-4.5 10-10z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-6xl md:text-7xl font-black text-white tracking-tight">
              {t('conversations.title')}
            </h1>
            <div className="h-1 mt-4 mx-auto w-1/2" style={{ backgroundColor: '#DEE1E6' }}></div>
            <p className="mt-6 text-xl font-medium" style={{ color: '#DEE1E6' }}>
              {t('conversations.subtitle')}
            </p>
            <div className="mt-4 flex justify-center space-x-6 rtl:space-x-reverse">
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse me-2"></div>
                <span className="text-sm font-medium">{t('conversations.liveSystem')}</span>
              </div>
              <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                <svg className="w-4 h-4 me-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium">{now.toLocaleTimeString(intl)}</span>
                {isPolling && (
                  <div className="ms-2 w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container with Chrome styling */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'rgb(32, 33, 36)' }}></div>
            <span className="ms-4 text-lg font-medium" style={{ color: 'rgb(32, 33, 36)' }}>
              {t('conversations.loading')}
            </span>
          </div>
        ) : (
          <>
            {/* Show error if there is one, but still show the layout */}
            {error && (
              <div className="mb-8 bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <svg className="h-5 w-5 text-red-500 me-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-red-700">{t('conversations.error', { message: error })}</span>
                  </div>
                  <div className="flex space-x-2 rtl:space-x-reverse">
                    {error.includes('Authentication') ? (
                      <button 
                        onClick={() => router.push('/login')}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        {t('conversations.signIn')}
                      </button>
                    ) : (
                      <button 
                        onClick={() => fetchConversations(false)}
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        {t('conversations.retry')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Header with Refresh Button */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-4 rtl:space-x-reverse">
                <h2 className="text-3xl font-bold" style={{ color: 'rgb(32, 33, 36)' }}>
                  {t('conversations.subtitle')}
                </h2>
                <div className="flex items-center space-x-2 rtl:space-x-reverse" style={{ color: '#5F6368' }}>
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium">{t('conversations.realTime')}</span>
                </div>
              </div>
              <button 
                onClick={() => fetchConversations(false)}
                className="flex items-center space-x-2 rtl:space-x-reverse px-6 py-3 border rounded-lg hover:shadow-md transition-all font-medium"
                style={{ borderColor: '#DEE1E6', color: 'rgb(32, 33, 36)', backgroundColor: 'white' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{t('common.refresh')}</span>
              </button>
            </div>

            {/* Two Black Boxes: Left = Emergency, Right = On Going Conversation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[800px]">
              {/* Left: Emergency */}
              <div className="bg-black text-white rounded-lg overflow-hidden flex flex-col">
                <div className="p-4 text-center border-b border-neutral-700">
                  <h3 className="text-lg font-bold">{t('conversations.emergency')}</h3>
                  <div className="text-sm text-neutral-300 mt-1">{emergencyConversations.length}</div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {emergencyConversations.length === 0 ? (
                    <div className="p-8 text-center text-neutral-400">{t('conversations.noEmergency')}</div>
                  ) : (
                    <ul className="divide-y divide-neutral-800">
                      {emergencyConversations.map((customer) => (
                        <SimpleConversationItem
                          key={customer.id}
                          customer={customer}
                          variant="urgent"
                          onRemoveUrgent={canWrite ? removeFromUrgentQueue : undefined}
                          isDismissing={dismissingId === (customer.conversationMeta?.id || customer.conversations[0]?.id || customer.id)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Right: On Going Conversation */}
              <div className="bg-black text-white rounded-lg overflow-hidden flex flex-col">
                <div className="p-4 text-center border-b border-neutral-700">
                  <h3 className="text-lg font-bold">{t('conversations.current')}</h3>
                  <div className="text-sm text-neutral-300 mt-1">{currentConversations.length}</div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {currentConversations.length === 0 ? (
                    <div className="p-8 text-center text-neutral-400">{t('conversations.noCurrent')}</div>
                  ) : (
                    <ul className="divide-y divide-neutral-800">
                      {currentConversations.map((customer) => (
                        <SimpleConversationItem key={customer.id} customer={customer} variant="current" />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Quick Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard
            title={t('conversations.total')}
            value={customers.length}
            icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>}
            color="rgb(32, 33, 36)"
          />
          <StatCard
            title={t('conversations.emergency')}
            value={emergencyConversations.length}
            icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.08 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>}
            color="#DC2626"
            urgent={emergencyConversations.length > 0}
          />
          <StatCard
            title={t('conversations.current')}
            value={currentConversations.length}
            icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>}
            color="#2563EB"
          />
        </div>
      </div>
    </div>
  );
}

// Minimal item used in the two black boxes layout
function SimpleConversationItem({
  customer,
  variant,
  onRemoveUrgent,
  isDismissing = false
}: {
  customer: Customer;
  variant: 'urgent' | 'current';
  onRemoveUrgent?: (conversationId: string) => Promise<void>;
  isDismissing?: boolean;
}) {
  const { intl } = useI18n();
  const displayName = customer.firstName && customer.lastName
    ? `${customer.firstName} ${customer.lastName}`
    : customer.phoneNumber;

  const lastMessage = customer.lastMessage;
  const timeText = lastMessage
    ? new Date(lastMessage.createdAt).toLocaleTimeString(intl, { hour: '2-digit', minute: '2-digit' })
    : '';

  const conversationId = customer.conversationMeta?.id || customer.conversations[0]?.id;

  const content = (
    <div className={`m-2 rounded-md ${variant === 'urgent' ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-white text-black hover:bg-neutral-100'} transition-colors ${isDismissing ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">{displayName}</div>
            {lastMessage && (
              <div className={`text-sm truncate max-w-[42ch] ${variant === 'urgent' ? 'text-red-50' : 'text-neutral-700'}`}>{lastMessage.content}</div>
            )}
          </div>
          <div className={`text-xs ms-4 ${variant === 'urgent' ? 'text-red-100' : 'text-neutral-500'}`}>{timeText}</div>
        </div>
      </div>
    </div>
  );

  if (variant === 'urgent') {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDismissing || !conversationId) return;
      if (!onRemoveUrgent) {
        window.location.href = `/conversations/${conversationId}`;
        return;
      }
      await onRemoveUrgent(conversationId);
      setTimeout(() => {
        if (conversationId) window.location.href = `/conversations/${conversationId}`;
      }, 200);
    };

    return (
      <li onClick={handleClick} className="relative">
        {content}
      </li>
    );
  }

  return (
    <li>
      <Link
        href={conversationId ? `/conversations/${conversationId}` : '#'}
        aria-disabled={!conversationId}
        onClick={(e) => { if (!conversationId) e.preventDefault(); }}
        className="block"
      >
        {content}
      </Link>
    </li>
  );
}

// Removed unused card components to reduce bundle size and fix noUnused warnings

// Stat card component
function StatCard({ title, value, icon, color, urgent = false }: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  urgent?: boolean;
}) {
  return (
    <div className={`shadow-lg rounded-xl border-s-4 overflow-hidden ${urgent ? 'animate-pulse' : ''}`} 
         style={{ backgroundColor: 'white', borderColor: color }}>
      <div className="p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0 me-4" style={{ color }}>
            {icon}
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: 'rgb(32, 33, 36)' }}>
              {value}
            </p>
            <p className="text-sm font-medium" style={{ color: '#5F6368' }}>
              {title}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
