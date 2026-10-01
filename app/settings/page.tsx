'use client';

import { useState, useEffect, useCallback } from 'react';
import { authedFetch } from '@/lib/authedFetch';
import { openDocument } from '@/lib/documentAccess';
import { useI18n } from '@/components/I18nProvider';
import NoAccess from '@/components/NoAccess';
import HelpLink from '@/components/HelpLink';
import { HELP_LINKS } from '@/lib/helpLinks';
import LanguageSelect from '@/components/LanguageSelect';
import WhatsAppIntegrationCard, { type WebhookInfo, type WhatsAppSettings } from '@/components/settings/WhatsAppIntegrationCard';
import { isAdminRole } from '@/lib/users/roles';
import { getLocale, localeLabel, normalizeLocale, type Locale, type TranslationKey } from '@/lib/i18n';
import { BEHAVIOR_TOGGLES, coverageDefinition, isBehaviorToggleKey, type BehaviorToggleKey, type BehaviorToggles } from '@/lib/company/catalog';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  uiLanguage?: Locale;
  uiLanguageOverride?: Locale | null;
  companyUiLanguage?: Locale;
  company: {
    id: string;
    name: string;
    slug: string;
    domain: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
    botLanguage?: string;
    isActive: boolean;
  };
}

interface Setting {
  id: string;
  name: string;
  description: string;
  type: 'document' | 'text' | 'boolean';
  value?: string;
  documentUrl?: string;
  documentContent?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CoverageState {
  type: string;
  displayName: string;
  isActive: boolean;
  inCatalog: boolean;
  configured: boolean;
  fieldCount: number;
}

interface Preferences {
  uiLanguage: Locale;
  botLanguage: Locale;
  toggles: BehaviorToggles;
  coverage: CoverageState[];
}

type PrefsUpdate = Partial<{ uiLanguage: Locale; botLanguage: Locale; toggles: Partial<BehaviorToggles>; coverage: Record<string, boolean> }>;

const card = 'rounded-2xl border bg-white p-6 shadow-sm';
const input = 'mt-1 block w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
    </button>
  );
}

export default function SettingsPage() {
  const { t, locale, setLocale, intl } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [integrations, setIntegrations] = useState<any>({});
  const [integrationMessage, setIntegrationMessage] = useState('');
  const [whatsapp, setWhatsapp] = useState<WhatsAppSettings | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [testResult, setTestResult] = useState('');
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsMessage, setPrefsMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [myLanguage, setMyLanguage] = useState<Locale | ''>('');
  const [showNewSettingModal, setShowNewSettingModal] = useState(false);
  const [editingSetting, setEditingSetting] = useState<Setting | null>(null);
  const [newSetting, setNewSetting] = useState({
    name: '',
    description: '',
    type: 'document' as 'document' | 'text' | 'boolean',
    value: '',
    file: null as File | null
  });

  const isAdmin = isAdminRole(user?.role);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const profileRes = await authedFetch('/api/auth/profile');
      let role = '';
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        const profile: User = profileData.user;
        role = profile.role;
        setUser(profile);
        setMyLanguage(profile.uiLanguageOverride || '');
        setIntegrations((current: any) => ({ ...current, companyName: profile.company.name, logoUrl: profile.company.logoUrl || '', primaryColor: profile.company.primaryColor || '#22c55e' }));
      }

      // Settings is admin-only (the APIs enforce it too); other roles see NoAccess.
      if (isAdminRole(role)) {
        const [settingsRes, integrationsRes, prefsRes] = await Promise.all([
          authedFetch('/api/settings'),
          authedFetch('/api/integration-settings'),
          authedFetch('/api/company-preferences'),
        ]);
        setSettings(settingsRes.ok ? (await settingsRes.json()).settings : []);
        if (integrationsRes.ok) {
          const integrationData = await integrationsRes.json();
          const saved = integrationData.settings || {};
          setIntegrations((current: any) => ({ ...current, llmProvider: saved.llmProvider || '', llmModel: saved.llmModel || '', llmBaseUrl: saved.llmBaseUrl || '', llmApiKeyMasked: saved.llmApiKeyMasked || null }));
          setWhatsapp(integrationData.settings);
          setWebhookInfo(integrationData.webhook);
        }
        if (prefsRes.ok) setPrefs(await prefsRes.json());
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updatePrefs = async (update: PrefsUpdate) => {
    setPrefsBusy(true);
    setPrefsMessage(null);
    try {
      const response = await authedFetch('/api/company-preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPrefsMessage({ ok: false, text: data.error === 'coverage_required' ? t('settings.coverage.required') : t('settings.prefs.error') });
        return null;
      }
      setPrefs(data);
      setPrefsMessage({ ok: true, text: t('settings.prefs.saved') });
      return data as Preferences;
    } catch {
      setPrefsMessage({ ok: false, text: t('common.networkError') });
      return null;
    } finally {
      setPrefsBusy(false);
    }
  };

  const changeCompanyLanguage = async (next: Locale) => {
    const saved = await updatePrefs({ uiLanguage: next });
    // Without a personal override the dashboard follows the company language.
    if (saved && !myLanguage) setLocale(next);
  };

  const changeMyLanguage = async (value: string) => {
    const next = normalizeLocale(value);
    setMyLanguage(next || '');
    const response = await authedFetch('/api/auth/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uiLanguage: next }) });
    if (!response.ok) {
      setPrefsMessage({ ok: false, text: t('settings.prefs.error') });
      return;
    }
    const data = await response.json();
    const effective = normalizeLocale(data.uiLanguage);
    if (effective && effective !== locale) setLocale(effective);
    setPrefsMessage({ ok: true, text: t('settings.prefs.saved') });
  };

  const saveIntegrations = async (event: React.FormEvent) => {
    event.preventDefault(); setIntegrationMessage(t('common.saving'));
    // Only this form's fields: the WhatsApp card saves its own fields separately.
    const payload: Record<string, string> = {};
    for (const key of ['llmProvider', 'llmModel', 'llmBaseUrl', 'llmApiKey', 'companyName', 'logoUrl', 'primaryColor']) {
      if (typeof integrations[key] === 'string') payload[key] = integrations[key];
    }
    const response = await authedFetch('/api/integration-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const key = `whatsapp.error.${data.error}`;
      const text = t(key as TranslationKey);
      return setIntegrationMessage(text === key ? t('settings.integrations.saveError') : text);
    }
    setIntegrations((current: any) => ({ ...current, llmApiKey: '', llmApiKeyMasked: data.settings?.llmApiKeyMasked || null }));
    setIntegrationMessage(t('settings.integrations.saved'));
  };

  const testBot = async () => {
    setTestResult(t('settings.integrations.testingBot'));
    const response = await authedFetch('/api/integration-settings/test', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    setTestResult(response.ok ? t('settings.integrations.extracted', { data: JSON.stringify(data.extracted) }) : (data.error || t('settings.integrations.botTestFailed')));
  };

  // Knowledge documents stored on the server need the bearer token: fetch them and open a blob.
  const openKnowledgeDocument = (e: React.MouseEvent, url?: string) => {
    if (!url || !url.startsWith('/api/')) return;
    e.preventDefault();
    openDocument(url).catch(() => alert(t('common.unknownError')));
  };

  const handleCreateSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let documentUrl = undefined;
      let documentContent = undefined;

      if (newSetting.type === 'document') {
        if (!newSetting.file) {
          alert(t('settings.alert.selectFile'));
          setLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', newSetting.file);

        try {
          const uploadRes = await authedFetch('/api/settings/upload', {
            method: 'POST',
            body: formData,
            // Do not set Content-Type header when sending FormData
          });

          if (!uploadRes.ok) {
            const errorData = await uploadRes.json().catch(() => ({}));
            throw new Error(errorData.error || t('common.unknownError'));
          }

          const uploadData = await uploadRes.json();
          documentUrl = uploadData.url;
          documentContent = uploadData.documentContent || undefined;

          if (!documentUrl) {
            throw new Error(t('settings.alert.noUrl'));
          }

          if (!documentContent) {
            alert(t('settings.alert.noTextExtracted'));
          }
        } catch (uploadError: any) {
          alert(t('settings.alert.uploadFailed', { error: uploadError.message }));
          setLoading(false);
          return;
        }
      }

      const settingData = {
        name: newSetting.name,
        description: newSetting.description,
        type: newSetting.type,
        value: newSetting.type === 'text' ? newSetting.value : undefined,
        documentUrl: documentUrl,
        documentContent: documentContent
      };

      const response = await authedFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingData)
      });

      if (response.ok) {
        const result = await response.json();
        setSettings([...settings, result.setting]);
        setShowNewSettingModal(false);
        setNewSetting({ name: '', description: '', type: 'document', value: '', file: null });
        alert(t('settings.alert.created'));
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(t('settings.alert.createFailed', { error: errorData.error || t('common.unknownError') }));
      }
    } catch (error) {
      console.error('Failed to create setting:', error);
      alert(t('settings.alert.createFailed', { error: t('common.unknownError') }));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSetting = async (settingId: string) => {
    if (!confirm(t('settings.alert.confirmDelete'))) return;

    try {
      const response = await authedFetch(`/api/settings?id=${settingId}`, { method: 'DELETE' });
      if (response.ok) {
        setSettings(settings.filter(s => s.id !== settingId));
        alert(t('settings.alert.deleted'));
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(t('settings.alert.deleteFailed', { error: errorData.error || t('common.unknownError') }));
      }
    } catch (error) {
      console.error('Failed to delete setting:', error);
      alert(t('settings.alert.deleteFailed', { error: t('common.unknownError') }));
    }
  };

  const handleToggleSetting = async (settingId: string) => {
    const setting = settings.find(s => s.id === settingId);
    if (!setting) return;

    try {
      const response = await authedFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: settingId, isActive: !setting.isActive })
      });

      if (response.ok) {
        setSettings(settings.map(s => s.id === settingId ? { ...s, isActive: !s.isActive } : s));
        alert(t('settings.alert.toggled', { state: !setting.isActive ? t('settings.alert.enabled') : t('settings.alert.disabled') }));
      } else {
        alert(t('settings.alert.updateFailed'));
      }
    } catch (error) {
      console.error('Failed to toggle setting:', error);
      alert(t('settings.alert.updateFailed'));
    }
  };

  const handleUpdateSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSetting) return;
    setLoading(true);
    try {
      // Editing supports name/description/text; documents are replaced by re-creating them.
      const updateData = {
        id: editingSetting.id,
        name: editingSetting.name,
        description: editingSetting.description,
        value: editingSetting.type === 'text' ? editingSetting.value : undefined,
        isActive: editingSetting.isActive,
        documentUrl: editingSetting.documentUrl
      };
      const response = await authedFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      if (response.ok) {
        const result = await response.json();
        setSettings(settings.map(s => s.id === editingSetting.id ? result.setting : s));
        setEditingSetting(null);
        alert(t('settings.alert.updated'));
      } else {
        alert(t('settings.alert.updateFailed'));
      }
    } catch (error) {
      console.error('Failed to update setting:', error);
      alert(t('settings.alert.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (loading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-transparent mx-auto" style={{ borderTopColor: 'rgb(32, 33, 36)' }}></div>
          <p className="mt-6 text-lg font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('settings.loading')}</p>
        </div>
      </div>
    );
  }

  if (user && !isAdmin) return <NoAccess role={user.role} />;

  // Behaviour toggles have their own section; keep them out of the knowledge lists.
  const knowledge = settings.filter(s => !isBehaviorToggleKey(s.name));
  const documents = knowledge.filter(s => s.type === 'document');
  const texts = knowledge.filter(s => s.type === 'text' || s.type === 'boolean');
  const langName = (code: Locale) => localeLabel(code);
  const machineNote = (code: Locale | '' | undefined) => (code && !getLocale(code).reviewed
    ? <span className="mt-1 block text-xs font-normal text-amber-700">{t('common.language.machineTranslated')}</span>
    : null);
  const companyName = user?.company?.name || '';

  const renderActions = (setting: Setting) => (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => handleToggleSetting(setting.id)} className="rounded-lg bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800 hover:bg-orange-100">
        {setting.isActive ? t('common.disable') : t('common.enable')}
      </button>
      <button onClick={() => setEditingSetting(setting)} className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100">{t('common.edit')}</button>
      <button onClick={() => handleDeleteSetting(setting.id)} className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100">{t('common.delete')}</button>
    </div>
  );

  const statusBadge = (active: boolean) => (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
      {active ? t('common.active') : t('common.inactive')}
    </span>
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      <div className="px-6 py-10" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
        <div className="mx-auto max-w-6xl">
          <h1 className="text-4xl font-black tracking-tight text-white">{t('settings.title')}</h1>
          <p className="mt-2 text-gray-300">{t('settings.subtitle', { company: companyName })}</p>
          <p className="mt-3 text-sm text-gray-400">{t('settings.activeCount', { count: knowledge.filter(s => s.isActive).length })}</p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {prefsMessage && (
          <p role="status" className={`rounded-lg px-4 py-2 text-sm ${prefsMessage.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{prefsMessage.text}</p>
        )}

        {/* Language */}
        <section className={card} aria-labelledby="lang-title">
          <h2 id="lang-title" className="text-xl font-bold text-gray-900">{t('settings.language.title')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('settings.language.intro')}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {isAdmin && prefs && (
              <label className="block text-sm font-medium text-gray-800">{t('settings.language.company')}
                <LanguageSelect className={input} value={prefs.uiLanguage} disabled={prefsBusy} data-testid="company-language" onChange={(code) => { if (code) void changeCompanyLanguage(code); }} />
                {machineNote(prefs.uiLanguage)}
              </label>
            )}
            <label className="block text-sm font-medium text-gray-800">{t('settings.language.mine')}
              <LanguageSelect
                className={input}
                value={normalizeLocale(myLanguage) || ''}
                data-testid="my-language"
                emptyLabel={t('settings.language.useCompany', { language: langName(prefs?.uiLanguage || user?.companyUiLanguage || 'en') })}
                onChange={(code) => void changeMyLanguage(code)}
              />
            </label>
            {isAdmin && prefs && (
              <label className="block text-sm font-medium text-gray-800">{t('settings.language.bot')}
                <LanguageSelect className={input} value={prefs.botLanguage} disabled={prefsBusy} data-testid="bot-language" onChange={(code) => { if (code) void updatePrefs({ botLanguage: code }); }} />
                <span className="mt-1 block text-xs font-normal text-gray-500">{t('settings.language.botHelp')}</span>
                {prefs.botLanguage !== 'en' && prefs.botLanguage !== 'fr' && (
                  <span className="mt-1 block text-xs font-normal text-gray-500">{t('settings.language.botBase', { language: getLocale(prefs.botLanguage).nativeName })}</span>
                )}
              </label>
            )}
          </div>
        </section>

        {isAdmin && prefs && (
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Behaviour toggles */}
            <section className={card} aria-labelledby="behavior-title">
              <h2 id="behavior-title" className="text-xl font-bold text-gray-900">{t('settings.behavior.title')}</h2>
              <p className="mt-1 text-sm text-gray-600">{t('settings.behavior.intro')}</p>
              <ul className="mt-4 divide-y">
                {BEHAVIOR_TOGGLES.map((toggle) => {
                  const key = toggle.key as BehaviorToggleKey;
                  return (
                    <li key={key} className="flex items-start justify-between gap-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{t(`catalog.toggle.${key}` as TranslationKey)}</p>
                        <p className="text-xs text-gray-600">{t(`catalog.toggle.${key}.desc` as TranslationKey)}</p>
                      </div>
                      <Switch label={t(`catalog.toggle.${key}` as TranslationKey)} checked={prefs.toggles[key]} disabled={prefsBusy} onChange={(v) => updatePrefs({ toggles: { [key]: v } })} />
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Coverage */}
            <section className={card} aria-labelledby="coverage-title">
              <h2 id="coverage-title" className="text-xl font-bold text-gray-900">{t('settings.coverage.title')}</h2>
              <p className="mt-1 text-sm text-gray-600">{t('settings.coverage.intro')}</p>
              <ul className="mt-4 divide-y">
                {prefs.coverage.map((cov) => {
                  const def = coverageDefinition(cov.type);
                  return (
                    <li key={cov.type} className="flex items-center justify-between gap-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl" aria-hidden>{def?.icon || '📁'}</span>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{cov.configured || !def ? cov.displayName : t(`catalog.coverage.${def.type}` as TranslationKey)}</p>
                          <p className="text-xs text-gray-600">
                            {cov.configured ? t('settings.coverage.fields', { count: cov.fieldCount }) : t('settings.coverage.notSetUp')}
                            {!cov.inCatalog && ` · ${t('settings.coverage.custom')}`}
                          </p>
                        </div>
                      </div>
                      <Switch label={cov.displayName} checked={cov.isActive} disabled={prefsBusy || (!cov.configured && !cov.inCatalog)} onChange={(v) => updatePrefs({ coverage: { [cov.type]: v } })} />
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}

        {/* WhatsApp integration */}
        {isAdmin && webhookInfo && <WhatsAppIntegrationCard initial={whatsapp} webhook={webhookInfo} />}

        {/* AI provider and company profile */}
        {isAdmin && (
          <form onSubmit={saveIntegrations} className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className={card}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold">{t('settings.integrations.chatbot')}</h2>
                  <HelpLink href={HELP_LINKS.aiProvider} testId="help-ai" />
                </div>
                <div className="mt-4 space-y-3">
                  <label className="block text-sm font-medium">{t('settings.integrations.provider')}
                    <select className={input} value={integrations.llmProvider || 'gemini'} onChange={e => setIntegrations({ ...integrations, llmProvider: e.target.value })}>
                      {['gemini', 'openai', 'deepseek', 'qwen', 'openai-compatible'].map(x => <option key={x}>{x}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium">{t('settings.integrations.model')}<input className={input} value={integrations.llmModel || ''} onChange={e => setIntegrations({ ...integrations, llmModel: e.target.value })} /></label>
                  {['openai-compatible', 'deepseek', 'qwen'].includes(integrations.llmProvider) && (
                    <label className="block text-sm font-medium">{t('settings.integrations.baseUrl')}<input className={input} value={integrations.llmBaseUrl || ''} onChange={e => setIntegrations({ ...integrations, llmBaseUrl: e.target.value })} /></label>
                  )}
                  <label className="block text-sm font-medium">{t('settings.integrations.apiKey')} <span className="text-xs font-normal text-gray-500">{integrations.llmApiKeyMasked || t('settings.integrations.keep')}</span>
                    <input type="password" autoComplete="off" placeholder={t('settings.integrations.keep')} className={input} value={integrations.llmApiKey || ''} onChange={e => setIntegrations({ ...integrations, llmApiKey: e.target.value })} />
                  </label>
                </div>
              </div>
              <div className={card}>
                <h2 className="text-xl font-bold">{t('settings.integrations.profile')}</h2>
                <div className="mt-4 grid gap-3">
                  {([['companyName', t('settings.integrations.name')], ['logoUrl', t('settings.integrations.logoUrl')], ['primaryColor', t('settings.integrations.primaryColor')]] as const).map(([key, label]) => (
                    <label key={key} className="block text-sm font-medium">{label}<input type={key === 'primaryColor' ? 'color' : 'text'} className={`${input} ${key === 'primaryColor' ? 'h-10' : ''}`} value={integrations[key] || ''} onChange={e => setIntegrations({ ...integrations, [key]: e.target.value })} /></label>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <button className="rounded-lg bg-black px-4 py-2 text-white">{t('common.save')}</button>
              <button type="button" onClick={testBot} className="ms-2 rounded-lg border bg-white px-4 py-2">{t('settings.integrations.testBot')}</button>
              <p className="mt-2 text-sm" role="status">{integrationMessage || testResult}</p>
            </div>
          </form>
        )}

        {/* Knowledge */}
        <section aria-labelledby="knowledge-title">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="knowledge-title" className="text-2xl font-bold text-gray-900">{t('settings.knowledge.title')}</h2>
              <p className="mt-1 text-sm text-gray-600">{t('settings.knowledge.intro')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <HelpLink href={HELP_LINKS.knowledge} testId="help-knowledge" />
                <HelpLink href={HELP_LINKS.apiSettings} icon="api" label={t('help.apiReference')} testId="help-api-settings" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setNewSetting({ ...newSetting, type: 'text' }); setShowNewSettingModal(true); }} className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white shadow hover:bg-emerald-700">+ {t('settings.knowledge.addText')}</button>
              <button onClick={() => { setNewSetting({ ...newSetting, type: 'document' }); setShowNewSettingModal(true); }} className="rounded-xl bg-gray-900 px-4 py-2 font-semibold text-white shadow hover:bg-gray-800">+ {t('settings.knowledge.addDocument')}</button>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-12">
            <div className={`${card} lg:col-span-7`}>
              <h3 className="text-lg font-bold">📄 {t('settings.knowledge.documents')}</h3>
              <p className="mt-1 text-sm text-gray-600">{t('settings.knowledge.documentsIntro')}</p>
              <div className="mt-4 space-y-4">
                {documents.length === 0 && <p className="text-sm text-gray-500">{t('settings.knowledge.empty')}</p>}
                {documents.map((setting) => (
                  <div key={setting.id} className={`rounded-xl border-2 p-4 ${setting.isActive ? 'border-emerald-400' : 'border-gray-200 bg-gray-50'}`}>
                    <h4 className="font-bold text-gray-900">{setting.name}</h4>
                    <p className="text-sm text-gray-600">{setting.description}</p>
                    {setting.documentUrl && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <a href={setting.documentUrl} onClick={(e) => openKnowledgeDocument(e, setting.documentUrl)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-700 hover:underline">{t('settings.knowledge.viewDocument')}</a>
                        {(!setting.documentContent || setting.documentContent.length < 50) && (
                          <span className="rounded-lg bg-red-100 px-3 py-1 text-xs font-bold text-red-800">{t('settings.knowledge.noText')}</span>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        {statusBadge(setting.isActive)}
                        <span className="text-xs text-gray-500">{t('common.updatedOn', { date: new Date(setting.updatedAt).toLocaleDateString(intl) })}</span>
                      </div>
                      {renderActions(setting)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${card} lg:col-span-5`}>
              <h3 className="text-lg font-bold">💬 {t('settings.knowledge.texts')}</h3>
              <div className="mt-4 space-y-4">
                {texts.length === 0 && <p className="text-sm text-gray-500">{t('settings.knowledge.empty')}</p>}
                {texts.map((setting) => (
                  <div key={setting.id} className={`rounded-xl border p-4 ${setting.isActive ? 'border-emerald-400 bg-emerald-50/30' : 'border-gray-200 bg-gray-50'}`}>
                    <h4 className="font-bold text-gray-900">{setting.name}</h4>
                    <p className="text-sm text-gray-600">{setting.description}</p>
                    <div className="mt-2 whitespace-pre-wrap break-words rounded-lg border bg-white px-3 py-2 font-mono text-sm text-gray-900">
                      {setting.type === 'boolean' ? (setting.value === 'true' ? t('settings.knowledge.boolOn') : t('settings.knowledge.boolOff')) : setting.value}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {statusBadge(setting.isActive)}
                      {renderActions(setting)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* New Setting Modal */}
      {showNewSettingModal && (
        <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-gray-600 bg-opacity-50" role="dialog" aria-modal="true">
          <div className="relative top-20 mx-auto max-w-2xl rounded-2xl border bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{newSetting.type === 'document' ? t('settings.modal.newDocument') : t('settings.modal.newText')}</h3>
                <p className="mt-1 text-sm text-gray-600">{newSetting.type === 'document' ? t('settings.modal.newDocumentIntro') : t('settings.modal.newTextIntro')}</p>
              </div>
              <button onClick={() => setShowNewSettingModal(false)} aria-label={t('common.close')} className="text-2xl text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <form onSubmit={handleCreateSetting} className="space-y-6">
              <label className="block text-sm font-semibold text-gray-900">{t('settings.modal.name')}
                <input type="text" required value={newSetting.name} onChange={(e) => setNewSetting({ ...newSetting, name: e.target.value })} className={input}
                  placeholder={newSetting.type === 'document' ? t('settings.modal.namePlaceholderDoc') : t('settings.modal.namePlaceholderText')} />
              </label>
              <label className="block text-sm font-semibold text-gray-900">{t('settings.modal.description')}
                <textarea required rows={3} value={newSetting.description} onChange={(e) => setNewSetting({ ...newSetting, description: e.target.value })} className={input}
                  placeholder={newSetting.type === 'document' ? t('settings.modal.descriptionPlaceholderDoc') : t('settings.modal.descriptionPlaceholderText')} />
              </label>
              {newSetting.type === 'document' && (
                <label className="block text-sm font-semibold text-gray-900">{t('settings.modal.file')}
                  <input type="file" accept=".pdf,.txt,.md,.csv,.json,.xml" onChange={(e) => setNewSetting({ ...newSetting, file: e.target.files?.[0] || null })} className={input} />
                  <span className="mt-2 block text-xs font-normal text-gray-500">{t('settings.modal.fileHelp')}</span>
                </label>
              )}
              {newSetting.type === 'text' && (
                <label className="block text-sm font-semibold text-gray-900">{t('settings.modal.content')}
                  <textarea required rows={4} value={newSetting.value} onChange={(e) => setNewSetting({ ...newSetting, value: e.target.value })} className={input} placeholder={t('settings.modal.contentPlaceholder')} />
                </label>
              )}
              <div className="flex justify-end gap-4 pt-4">
                <button type="button" onClick={() => setShowNewSettingModal(false)} className="rounded-xl border px-6 py-3 font-semibold text-gray-600">{t('common.cancel')}</button>
                <button type="submit" disabled={loading} className={`rounded-xl px-6 py-3 font-semibold text-white shadow ${newSetting.type === 'document' ? 'bg-gray-900' : 'bg-emerald-600'}`}>
                  {newSetting.type === 'document' ? t('settings.modal.addDocument') : t('settings.modal.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Setting Modal */}
      {editingSetting && (
        <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-gray-600 bg-opacity-50" role="dialog" aria-modal="true">
          <div className="relative top-20 mx-auto max-w-2xl rounded-2xl border bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{t('settings.modal.editTitle')}</h3>
                <p className="mt-1 text-sm text-gray-600">{t('settings.modal.editIntro')}</p>
              </div>
              <button onClick={() => setEditingSetting(null)} aria-label={t('common.close')} className="text-2xl text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <form onSubmit={handleUpdateSetting} className="space-y-6">
              <label className="block text-sm font-semibold text-gray-900">{t('settings.modal.name')}
                <input type="text" required value={editingSetting.name} onChange={(e) => setEditingSetting({ ...editingSetting, name: e.target.value })} className={input} />
              </label>
              <label className="block text-sm font-semibold text-gray-900">{t('settings.modal.description')}
                <textarea required rows={3} value={editingSetting.description} onChange={(e) => setEditingSetting({ ...editingSetting, description: e.target.value })} className={input} />
              </label>
              {editingSetting.type === 'text' && (
                <label className="block text-sm font-semibold text-gray-900">{t('settings.modal.content')}
                  <textarea required rows={8} value={editingSetting.value || ''} onChange={(e) => setEditingSetting({ ...editingSetting, value: e.target.value })} className={input} />
                </label>
              )}
              {editingSetting.type === 'document' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="mb-2 text-sm text-gray-600">{t('settings.modal.currentDocument')}</p>
                  <a href={editingSetting.documentUrl} onClick={(e) => openKnowledgeDocument(e, editingSetting.documentUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{t('settings.knowledge.viewDocument')}</a>
                  <p className="mt-2 text-xs italic text-gray-500">{t('settings.modal.replaceDocument')}</p>
                </div>
              )}
              <div className="flex justify-end gap-4 pt-4">
                <button type="button" onClick={() => setEditingSetting(null)} className="rounded-xl px-6 py-3 font-bold text-gray-600 hover:bg-gray-100">{t('common.cancel')}</button>
                <button type="submit" disabled={loading} className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white shadow">{loading ? t('settings.modal.updating') : t('settings.modal.update')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
