'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch } from '@/lib/authedFetch';
import { useCurrentUser } from '@/components/CurrentUser';
import { useI18n } from '@/components/I18nProvider';
import { claimStatusLabel, claimTypeLabel } from '@/lib/i18n/claimLabels';

interface Message {
  id: string;
  content: string;
  role: string;
  createdAt: string;
}

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string;
  email: string | null;
}

interface Claim {
  id: string;
  claimNumber: string;
  type: string;
  status: string;
  description: string;
  estimatedAmount: number | null;
  incidentDate: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string | null;
  isActive: boolean;
  isEscalated: boolean;
  isBotPaused: boolean;
  pausedBy: string | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: Customer;
  messages: Message[];
}

interface ConversationPageProps {
  params: { id: string };
}

export default function ConversationPage({ params }: ConversationPageProps) {
  const { canWrite } = useCurrentUser();
  const { t, intl } = useI18n();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [customerClaims, setCustomerClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausingBot, setPausingBot] = useState(false);
  const [hasInitiallyScrolled, setHasInitiallyScrolled] = useState(false);
  const router = useRouter();

  // Scroll to the newest message on first load and whenever a new message arrives.
  const lastMessageCount = useRef(0);
  useEffect(() => {
    const count = conversation?.messages?.length ?? 0;
    if (count === 0) return;
    if (!hasInitiallyScrolled || count > lastMessageCount.current) {
      const messagesContainer = document.getElementById('messages-container');
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        setHasInitiallyScrolled(true);
      }
    }
    lastMessageCount.current = count;
  }, [conversation?.messages, hasInitiallyScrolled]);

  // Function to toggle bot pause
  const toggleBotPause = async () => {
    if (!conversation || pausingBot) return;
    
    setPausingBot(true);
    try {
      const response = await authedFetch(`/api/conversations/${params.id}/pause-bot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paused: !conversation.isBotPaused,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to toggle bot pause');
      }

      // Refresh conversation to get updated data
      await fetchConversation();
    } catch (err) {
      console.error('Error toggling bot pause:', err);
      setError('Failed to toggle bot pause');
    } finally {
      setPausingBot(false);
    }
  };

  // Fetch conversation data
  useEffect(() => {
    fetchConversation();
    // Set up polling to refresh conversation every 3 seconds for real-time updates
    const interval = setInterval(() => {
      fetchConversation();
    }, 3000);
    return () => clearInterval(interval);
  }, [params.id]);

  const fetchConversation = async () => {
    try {
      const response = await authedFetch(`/api/conversations/${params.id}?limit=200&sortOrder=asc`);
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error(t('conversationDetail.loadFailed'));
      }
      const data = await response.json();
      setConversation(data.conversation);
      
      // Fetch customer claims only once when conversation loads or customer changes
      if (data.conversation?.customer?.phoneNumber && 
          (!conversation || conversation.customer.phoneNumber !== data.conversation.customer.phoneNumber)) {
        await fetchAllCustomerClaims(data.conversation.customer.phoneNumber, data.conversation.customer.id);
      }
      
      setError(null);
    } catch (err) {
      console.error('Error fetching conversation:', err);
      setError(t('conversationDetail.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchAllCustomerClaims = async (phoneNumber: string, customerId?: string) => {
    try {
      const allClaims = new Map<string, Claim>();
      
      // Try to fetch by customer ID first if available
      if (customerId) {
        try {
          const customerResponse = await authedFetch(`/api/claims?customerId=${customerId}`);
          if (customerResponse.ok) {
            const customerData = await customerResponse.json();
            customerData.claims?.forEach((claim: Claim) => {
              allClaims.set(claim.id, claim);
            });
          }
        } catch (err) {
          console.error('Error fetching claims by customer ID:', err);
        }
      }
      
      // Always fetch by phone number to ensure complete coverage (WhatsApp integration)
      try {
        const phoneResponse = await authedFetch(`/api/claims?phoneNumber=${encodeURIComponent(phoneNumber)}`);
        if (phoneResponse.ok) {
          const phoneData = await phoneResponse.json();
          phoneData.claims?.forEach((claim: Claim) => {
            allClaims.set(claim.id, claim);
          });
        }
      } catch (err) {
        console.error('Error fetching claims by phone number:', err);
      }
      
      // Convert Map to array and sort by creation date (newest first)
      const claims = Array.from(allClaims.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      setCustomerClaims(claims);
    } catch (err) {
      console.error('Error fetching all customer claims:', err);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || sending) return;

    setSending(true);
    try {
      const response = await authedFetch('/api/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: conversation?.customer.phoneNumber,
          message: messageText.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(t('conversationDetail.sendFailed'));
      }

      setMessageText('');
      // Refresh conversation after sending
      await fetchConversation();
    } catch (err) {
      console.error('Error sending message:', err);
      setError(t('conversationDetail.sendFailed'));
    } finally {
      setSending(false);
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

  const handleClaimClick = (claimNumber: string) => {
    router.push(`/clients/claims/${claimNumber}`);
  };

  // Removed auto-scroll behavior

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto" style={{ borderColor: 'rgb(32, 33, 36)' }}></div>
          <span className="ms-4 text-lg font-medium mt-4 block" style={{ color: 'rgb(32, 33, 36)' }}>
            {t('conversationDetail.loading')}
          </span>
        </div>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-red-500 me-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-700">{error || t('conversationDetail.notFound')}</span>
              <button 
                onClick={() => router.push('/conversations')}
                className="ms-4 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
              >
                {t('conversationDetail.back')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const customerName = conversation.customer.firstName && conversation.customer.lastName 
    ? `${conversation.customer.firstName} ${conversation.customer.lastName}`
    : conversation.customer.phoneNumber;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      {/* Chrome-inspired Header */}
      <div className="relative py-8 overflow-hidden" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M20 20c0-5.5-4.5-10-10-10s-10 4.5-10 10 4.5 10 10 10 10-4.5 10-10zm10 0c0-5.5-4.5-10-10-10s-10 4.5-10 10 4.5 10 10 10 10-4.5 10-10z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <button
                onClick={() => router.push('/conversations')}
                className="flex items-center text-white hover:opacity-80 transition-opacity mb-4"
              >
                <svg className="w-5 h-5 me-2 rtl:-scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t('conversationDetail.back')}
              </button>
              <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">
                {t('conversationDetail.title')}
              </h1>
              <div className="h-1 mt-2 w-1/2" style={{ backgroundColor: '#DEE1E6' }}></div>
              <p className="mt-4 text-xl font-medium" style={{ color: '#DEE1E6' }}>
                {customerName}
              </p>
            </div>
              <div className="text-end">
                <div className="flex flex-col items-end space-y-2">
                  <div className="flex items-center" style={{ color: '#DEE1E6' }}>
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse me-2"></div>
                    <span>{t('conversationDetail.live')}</span>
                  </div>
                  
                  {/* Bot Status Indicator */}
                  <div className="flex items-center" style={{ color: conversation.isBotPaused ? '#FEF3C7' : '#DEE1E6' }}>
                    <svg className="w-4 h-4 me-2" fill="currentColor" viewBox="0 0 20 20">
                      {conversation.isBotPaused ? (
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      ) : (
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 6L12 10.5 8.5 8 12 5.5 15.5 8zM12 13.5l3.5 2.5L12 18.5 8.5 16l3.5-2.5z"/>
                      )}
                    </svg>
                    <span className="text-sm">
                      {conversation.isBotPaused ? t('conversationDetail.botPaused') : t('conversationDetail.botActive')}
                    </span>
                  </div>
                  
                  <div className="text-white text-sm">
                    <div style={{ color: '#DEE1E6' }}>
                      {conversation.customer.phoneNumber}
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </div>
      </div>

      {/* Main Container with Chrome styling */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-[calc(100vh-300px)]">
          
          {/* Left Column - Conversation */}
          <div className="lg:col-span-2">
            <div className="shadow-xl rounded-2xl overflow-hidden border h-full" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              {/* Conversation Header */}
              <div className="px-6 py-4 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                    <svg className="w-6 h-6 me-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {t('conversationDetail.messagesTitle')}
                  </h3>
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <span className="text-sm bg-white px-3 py-1 rounded-full" style={{ color: '#5F6368' }}>
                      {t('conversationDetail.messageCount', { count: conversation.messages.length })}
                    </span>
                    
                    {/* Bot Pause/Resume Button (hidden from read-only roles) */}
                    {canWrite && (
                    <button
                      data-write-action="toggle-bot"
                      onClick={toggleBotPause}
                      disabled={pausingBot}
                      className={`flex items-center space-x-2 rtl:space-x-reverse px-4 py-2 rounded-lg font-medium transition-colors ${
                        conversation.isBotPaused
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                      } ${pausingBot ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {pausingBot ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          {conversation.isBotPaused ? (
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                      <span className="text-sm">
                        {conversation.isBotPaused ? t('conversationDetail.resumeBot') : t('conversationDetail.pauseBot')}
                      </span>
                    </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages Container */}
              <div className="flex flex-col h-[600px]">
                {/* Messages */}
                <div id="messages-container" className="flex-1 p-6 space-y-4 overflow-y-auto">
                  {conversation.messages.length === 0 ? (
                    <div className="text-center py-8">
                      <svg className="mx-auto h-12 w-12 mb-4" style={{ color: '#DEE1E6' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <p className="text-gray-500">{t('conversationDetail.noMessages')}</p>
                    </div>
                  ) : (
                    // Messages are fetched oldest first (sortOrder=asc): render them in that order.
                    conversation.messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${
                          message.role === 'user' ? 'justify-start' : 'justify-end'
                        }`}
                      >
                        <div
                          className={`p-4 rounded-2xl max-w-xl shadow-lg ${
                            message.role === 'user'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          <div className="flex items-center mb-2">
                            {message.role === 'user' ? (
                              <svg className="w-4 h-4 me-2" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                              </svg>
                            ) : (
                              <svg className="w-4 h-4 me-2" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 6L12 10.5 8.5 8 12 5.5 15.5 8zM12 13.5l3.5 2.5L12 18.5 8.5 16l3.5-2.5z"/>
                              </svg>
                            )}
                            <span className="text-xs font-bold opacity-80">
                              {message.role === 'user' ? t('conversationDetail.roleCustomer') : t('conversationDetail.roleAssistant')}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                          <p className="text-xs opacity-70 mt-2 text-end">
                            {new Date(message.createdAt).toLocaleString(intl)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  {/* Auto-scroll removed */}
                </div>

                {/* Message Input Form (hidden from read-only roles) */}
                {canWrite && (
                <div data-write-action="send-message" className="border-t p-4" style={{ borderColor: '#DEE1E6' }}>
                  {/* Bot Pause Warning */}
                  {conversation.isBotPaused && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-center">
                        <svg className="w-5 h-5 text-yellow-600 me-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-yellow-800">
                            {t('conversationDetail.pausedTitle')}
                          </p>
                          <p className="text-xs text-yellow-600 mt-1">
                            {t('conversationDetail.pausedHelp')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <form onSubmit={sendMessage} className="flex space-x-2 rtl:space-x-reverse">
                    <div className="flex-1">
                      <textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder={t('conversationDetail.messagePlaceholder')}
                        className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={3}
                        disabled={sending}
                      />
                    </div>
                    <div className="flex flex-col space-y-2">
                      <button
                        type="submit"
                        disabled={!messageText.trim() || sending}
                        className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                          !messageText.trim() || sending
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'text-white hover:opacity-90'
                        }`}
                        style={{ backgroundColor: !messageText.trim() || sending ? undefined : 'rgb(32, 33, 36)' }}
                      >
                        {sending ? t('conversationDetail.sending') : t('conversationDetail.send')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMessageText('')}
                        className="px-6 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                        disabled={sending}
                      >
                        {t('conversationDetail.clear')}
                      </button>
                    </div>
                  </form>
                  
                  {/* Quick Response Templates */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      t('conversationDetail.quick1'),
                      t('conversationDetail.quick2'),
                      t('conversationDetail.quick3'),
                      t('conversationDetail.quick4'),
                    ].map((template, index) => (
                      <button
                        key={index}
                        onClick={() => setMessageText(template)}
                        className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 transition-colors"
                        disabled={sending}
                      >
                        {template.length > 40 ? template.substring(0, 40) + '...' : template}
                      </button>
                    ))}
                  </div>
                </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Customer Info & Claims */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Customer Information Card */}
            <div className="shadow-lg rounded-xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              <div className="px-6 py-4 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                <h3 className="text-lg font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                  <svg className="w-5 h-5 me-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {t('conversationDetail.customerInfo')}
                </h3>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
                    {customerName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{customerName}</p>
                    <p className="text-sm" style={{ color: '#5F6368' }}>{t('conversationDetail.whatsappCustomer')}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <svg className="w-4 h-4" style={{ color: '#5F6368' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <span className="text-sm" style={{ color: '#5F6368' }}>
                      <strong>{t('conversationDetail.phone')}</strong> {conversation.customer.phoneNumber}
                    </span>
                  </div>
                  
                  {conversation.customer.email && (
                    <div className="flex items-center space-x-2 rtl:space-x-reverse">
                      <svg className="w-4 h-4" style={{ color: '#5F6368' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm" style={{ color: '#5F6368' }}>
                        <strong>{t('conversationDetail.email')}</strong> {conversation.customer.email}
                      </span>
                    </div>
                  )}
                  
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <svg className="w-4 h-4" style={{ color: '#5F6368' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a4 4 0 118 0v4m-4 9v2m-6 3h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm" style={{ color: '#5F6368' }}>
                      <strong>{t('conversationDetail.customerSince')}</strong> {new Date(conversation.createdAt).toLocaleDateString(intl)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Claims */}
            <div className="shadow-lg rounded-xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              <div className="px-6 py-4 border-b" style={{ backgroundColor: '#4285f4', borderColor: '#4285f4' }}>
                <h3 className="text-lg font-bold flex items-center text-white">
                  <div className="p-1.5 rounded-lg me-3" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  {t('conversationDetail.customerClaims', { count: customerClaims.length })}
                </h3>
              </div>
              <div className="p-6">
                {customerClaims.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4285f4' }}>
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-lg font-medium mb-2" style={{ color: '#4285f4' }}>
                      {t('conversationDetail.noClaims')}
                    </p>
                    <p className="text-sm" style={{ color: '#5F6368' }}>
                      {t('conversationDetail.noClaimsHelp')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {customerClaims.map((claim) => (
                      <div 
                        key={claim.id} 
                        onClick={() => handleClaimClick(claim.claimNumber)}
                        className="border rounded-xl p-4 hover:shadow-lg transition-all duration-300 hover:scale-105 cursor-pointer" 
                        style={{ borderColor: '#4285f4', backgroundColor: '#f8f9ff' }}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-3 rtl:space-x-reverse">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: '#4285f4' }}>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <span className="font-bold text-sm" style={{ color: '#4285f4' }}>
                              #{claim.claimNumber}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 rtl:space-x-reverse">
                            <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusColor(claim.status)}`}>
                              {claimStatusLabel(t, claim.status).toUpperCase()}
                            </span>
                            <svg className="w-5 h-5 text-gray-400 rtl:-scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </div>
                        <div className="mb-3">
                          <span className="inline-block px-2 py-1 text-xs font-medium rounded-md" style={{ backgroundColor: '#e8f0fe', color: '#1a73e8' }}>
                            {claimTypeLabel(t, claim.type)}
                          </span>
                        </div>
                        <p className="text-sm mb-3" style={{ color: '#5f6368' }}>
                          {claim.description ? (claim.description.length > 120 ? claim.description.substring(0, 120) + '...' : claim.description) : t('conversationDetail.noDescription')}
                        </p>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="flex items-center space-x-2 rtl:space-x-reverse">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#34a853' }}></div>
                            <span style={{ color: '#5f6368' }}>{t('conversationDetail.created')}</span>
                            <span className="font-medium" style={{ color: '#202124' }}>
                              {new Date(claim.createdAt).toLocaleDateString(intl)}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 rtl:space-x-reverse">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#fbbc04' }}></div>
                            <span style={{ color: '#5f6368' }}>{t('conversationDetail.amount')}</span>
                            <span className="font-bold" style={{ color: '#ea4335' }}>
                              {claim.estimatedAmount ? claim.estimatedAmount.toLocaleString(intl, { style: 'currency', currency: 'EUR' }) : t('claim.amountTbd')}
                            </span>
                          </div>
                        </div>
                        
                        {/* Click to view indicator */}
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="flex items-center justify-center text-xs text-gray-500 hover:text-blue-500 transition-colors">
                            <svg className="w-3 h-3 me-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {t('conversationDetail.clickForDetails')}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Conversation Statistics */}
            <div className="shadow-lg rounded-xl border overflow-hidden" style={{ backgroundColor: 'white', borderColor: '#DEE1E6' }}>
              <div className="px-6 py-4 border-b" style={{ backgroundColor: '#F1F3F4', borderColor: '#DEE1E6' }}>
                <h3 className="text-lg font-bold flex items-center" style={{ color: 'rgb(32, 33, 36)' }}>
                  <svg className="w-5 h-5 me-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  {t('conversationDetail.statistics')}
                </h3>
              </div>
              <div className="p-6 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm" style={{ color: '#5F6368' }}>{t('conversationDetail.totalMessages')}</span>
                  <span className="text-sm font-bold" style={{ color: 'rgb(32, 33, 36)' }}>{conversation.messages.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm" style={{ color: '#5F6368' }}>{t('conversationDetail.customerMessages')}</span>
                  <span className="text-sm font-bold" style={{ color: 'rgb(32, 33, 36)' }}>
                    {conversation.messages.filter(m => m.role === 'user').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm" style={{ color: '#5F6368' }}>{t('conversationDetail.aiReplies')}</span>
                  <span className="text-sm font-bold" style={{ color: 'rgb(32, 33, 36)' }}>
                    {conversation.messages.filter(m => m.role === 'assistant').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm" style={{ color: '#5F6368' }}>{t('conversationDetail.lastActivity')}</span>
                  <span className="text-sm font-bold" style={{ color: 'rgb(32, 33, 36)' }}>
                    {conversation.messages.length > 0 
                      ? new Date(conversation.messages[conversation.messages.length - 1].createdAt).toLocaleDateString(intl)
                      : t('conversationDetail.none')
                    }
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
