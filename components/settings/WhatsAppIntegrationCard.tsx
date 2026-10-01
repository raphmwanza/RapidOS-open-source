'use client';

import { useEffect, useMemo, useState } from 'react';
import { authedFetch } from '@/lib/authedFetch';
import { copyText } from '@/lib/clipboard';
import { useI18n } from '@/components/I18nProvider';
import HelpLink from '@/components/HelpLink';
import { HELP_LINKS } from '@/lib/helpLinks';
import type { TranslationKey } from '@/lib/i18n';
import { WEBHOOK_PATH, isPublicHttpsUrl, isValidVerifyToken, normalizePublicBaseUrl, webhookCallbackUrl } from '@/lib/whatsapp/webhook';

export interface WhatsAppSettings {
  whatsappDisplayNumber?: string | null;
  whatsappPhoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  publicBaseUrl?: string | null;
  whatsappAccessTokenMasked?: string | null;
  metaAppSecretMasked?: string | null;
  webhookVerifyTokenMasked?: string | null;
}

export interface WebhookInfo {
  path: string;
  defaultBaseUrl: string;
}

type Form = {
  whatsappDisplayNumber: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  publicBaseUrl: string;
  whatsappAccessToken: string;
  metaAppSecret: string;
  webhookVerifyToken: string;
};

type Message = { tone: 'ok' | 'error' | 'info'; text: string } | null;

const input = 'mt-1 block w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';
const buttonGhost = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50';
const sectionTitle = 'text-xs font-bold uppercase tracking-wide text-gray-500';

function formFrom(settings: WhatsAppSettings | null): Form {
  return {
    whatsappDisplayNumber: settings?.whatsappDisplayNumber || '',
    whatsappPhoneNumberId: settings?.whatsappPhoneNumberId || '',
    whatsappBusinessAccountId: settings?.whatsappBusinessAccountId || '',
    publicBaseUrl: settings?.publicBaseUrl || '',
    whatsappAccessToken: '',
    metaAppSecret: '',
    webhookVerifyToken: '',
  };
}

/** 32 URL-safe random characters; getRandomValues works on plain-http LAN hosts too. */
function generateVerifyToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...Array.from(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function WhatsAppIntegrationCard({ initial, webhook }: { initial: WhatsAppSettings | null; webhook: WebhookInfo }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<WhatsAppSettings | null>(initial);
  const [form, setForm] = useState<Form>(() => formFrom(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [show, setShow] = useState({ whatsappAccessToken: false, metaAppSecret: false, webhookVerifyToken: false });
  const [tokenIsSaved, setTokenIsSaved] = useState(false);

  useEffect(() => { setSaved(initial); setForm(formFrom(initial)); setDirty(false); }, [initial]);

  /** Translates an API error/status code, falling back to a generic message. */
  const tr = (key: string, fallback: TranslationKey) => {
    const text = t(key as TranslationKey);
    return text === key ? t(fallback) : text;
  };

  const update = (key: keyof Form, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
    setDirty(true);
    if (key === 'webhookVerifyToken') setTokenIsSaved(false);
  };

  const base = useMemo(() => {
    const result = normalizePublicBaseUrl(form.publicBaseUrl);
    return { valid: result.ok, value: (result.ok && result.value) || webhook.defaultBaseUrl };
  }, [form.publicBaseUrl, webhook.defaultBaseUrl]);
  const callbackUrl = webhookCallbackUrl(base.value);
  const isPublic = isPublicHttpsUrl(base.value);
  const tokenInvalid = form.webhookVerifyToken !== '' && !isValidVerifyToken(form.webhookVerifyToken.trim());

  const copy = async (text: string, done: TranslationKey) => {
    const ok = await copyText(text);
    setMessage(ok ? { tone: 'ok', text: t(done) } : { tone: 'error', text: t('common.unknownError') });
  };

  const regenerate = () => {
    update('webhookVerifyToken', generateVerifyToken());
    setShow(current => ({ ...current, webhookVerifyToken: true }));
    setMessage({ tone: 'info', text: t('whatsapp.tokenGenerated') });
  };

  const revealSaved = async () => {
    const res = await authedFetch('/api/integration-settings/verify-token', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) { setMessage({ tone: 'error', text: t('common.unknownError') }); return; }
    setForm(current => ({ ...current, webhookVerifyToken: data.token }));
    setShow(current => ({ ...current, webhookVerifyToken: true }));
    setTokenIsSaved(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!base.valid) { setMessage({ tone: 'error', text: t('whatsapp.error.invalid_public_base_url') }); return; }
    if (tokenInvalid) { setMessage({ tone: 'error', text: t('whatsapp.error.invalid_verify_token') }); return; }
    setBusy(true);
    setMessage({ tone: 'info', text: t('common.saving') });
    try {
      const payload: Record<string, string> = {
        whatsappDisplayNumber: form.whatsappDisplayNumber,
        whatsappPhoneNumberId: form.whatsappPhoneNumberId,
        whatsappBusinessAccountId: form.whatsappBusinessAccountId,
        publicBaseUrl: form.publicBaseUrl,
      };
      // Blank secret fields keep their saved (encrypted) values.
      for (const key of ['whatsappAccessToken', 'metaAppSecret', 'webhookVerifyToken'] as const) {
        if (form[key].trim()) payload[key] = form[key].trim();
      }
      const res = await authedFetch('/api/integration-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage({ tone: 'error', text: tr(`whatsapp.error.${data.error}`, 'settings.integrations.saveError') }); return; }
      const typedToken = form.webhookVerifyToken.trim();
      setSaved(data.settings);
      setForm({ ...formFrom(data.settings), webhookVerifyToken: typedToken });
      setShow(current => ({ ...current, whatsappAccessToken: false, metaAppSecret: false }));
      if (typedToken) setTokenIsSaved(true);
      setDirty(false);
      setMessage({ tone: 'ok', text: t('settings.integrations.saved') });
    } catch {
      setMessage({ tone: 'error', text: t('common.networkError') });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setMessage({ tone: 'info', text: t('settings.integrations.testingConnection') });
    const res = await authedFetch('/api/integration-settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: 'connection' }) });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok
      ? { tone: 'ok', text: tr(`whatsapp.${data.message}`, 'settings.integrations.connectionOk') }
      : { tone: 'error', text: tr(`whatsapp.${data.error}`, 'settings.integrations.connectionFailed') });
  };

  const testWebhook = async () => {
    setMessage({ tone: 'info', text: t('whatsapp.testingWebhook') });
    const res = await authedFetch('/api/integration-settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: 'webhook' }) });
    const data = await res.json().catch(() => ({}));
    if (data.error === 'verify_token_missing') { setMessage({ tone: 'error', text: t('whatsapp.webhookNoToken') }); return; }
    if (!data.backend) { setMessage({ tone: 'error', text: tr(`whatsapp.${data.error}`, 'settings.integrations.connectionFailed') }); return; }
    if (!data.backend.ok) { setMessage({ tone: 'error', text: t('whatsapp.webhookBackendFail', { status: data.backend.status ?? '—' }) }); return; }
    if (data.public && !data.public.ok) { setMessage({ tone: 'error', text: t('whatsapp.webhookPublicFail', { status: data.public.status ?? '—' }) }); return; }
    setMessage({ tone: 'ok', text: data.public ? `${t('whatsapp.webhookOk')} ${t('whatsapp.webhookPublicOk', { url: data.public.url })}` : t('whatsapp.webhookOk') });
  };

  const savedHint = (masked?: string | null) => (
    <span className={`ms-2 text-xs font-normal ${masked ? 'text-green-700' : 'text-gray-500'}`}>{masked ? t('whatsapp.saved', { masked }) : t('whatsapp.notSet')}</span>
  );

  const toggleButton = (key: keyof typeof show) => (
    <button type="button" onClick={() => setShow(s => ({ ...s, [key]: !s[key] }))} className="rounded-e-lg border border-s-0 border-gray-300 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50">
      {show[key] ? t('whatsapp.hide') : t('whatsapp.show')}
    </button>
  );

  const secretInput = (key: 'whatsappAccessToken' | 'metaAppSecret', label: string, help: string, masked?: string | null) => (
    <div className="text-sm font-medium text-gray-900">
      <label htmlFor={key}>{label}</label>{savedHint(masked)}
      <div className="mt-1 flex">
        <input
          id={key} name={key} type={show[key] ? 'text' : 'password'} autoComplete="new-password" data-lpignore="true" data-1p-ignore spellCheck={false}
          placeholder={t('whatsapp.keepPlaceholder')} value={form[key]} onChange={e => update(key, e.target.value)}
          className="block w-full min-w-0 rounded-s-lg border border-gray-300 p-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        {toggleButton(key)}
      </div>
      <span className="mt-1 block text-xs font-normal text-gray-500">{help}</span>
    </div>
  );

  return (
    <form onSubmit={save} autoComplete="off" className="rounded-2xl border bg-white p-6 shadow-sm" data-testid="whatsapp-card" noValidate>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.4A8.4 8.4 0 1 1 21 11.5Z" /></svg>
            </span>
            {t('whatsapp.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('whatsapp.intro')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{t('whatsapp.unsaved')}</span>}
          <HelpLink href={HELP_LINKS.whatsapp} testId="help-whatsapp" />
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className={sectionTitle}>{t('whatsapp.section.number')}</h3>
          <label className="block text-sm font-medium text-gray-900">{t('whatsapp.displayNumber')}
            <input name="whatsappDisplayNumber" autoComplete="off" data-lpignore="true" className={input} value={form.whatsappDisplayNumber} onChange={e => update('whatsappDisplayNumber', e.target.value)} inputMode="tel" />
            <span className="mt-1 block text-xs font-normal text-gray-500">{t('whatsapp.displayNumberHelp')}</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-900">{t('whatsapp.phoneNumberId')}
              <input name="whatsappPhoneNumberId" autoComplete="off" data-lpignore="true" className={input} value={form.whatsappPhoneNumberId} onChange={e => update('whatsappPhoneNumberId', e.target.value.replace(/\s/g, ''))} inputMode="numeric" />
            </label>
            <label className="block text-sm font-medium text-gray-900">{t('whatsapp.businessAccountId')}
              <input name="whatsappBusinessAccountId" autoComplete="off" data-lpignore="true" className={input} value={form.whatsappBusinessAccountId} onChange={e => update('whatsappBusinessAccountId', e.target.value.replace(/\s/g, ''))} inputMode="numeric" />
            </label>
          </div>
          <p className="-mt-2 text-xs text-gray-500">{t('whatsapp.idHelp')}</p>

          <h3 className={`${sectionTitle} pt-2`}>{t('whatsapp.section.credentials')}</h3>
          {secretInput('whatsappAccessToken', t('whatsapp.accessToken'), t('whatsapp.accessTokenHelp'), saved?.whatsappAccessTokenMasked)}
          {secretInput('metaAppSecret', t('whatsapp.appSecret'), t('whatsapp.appSecretHelp'), saved?.metaAppSecretMasked)}
        </div>

        <div className="space-y-4">
          <h3 className={sectionTitle}>{t('whatsapp.section.webhook')}</h3>
          <label className="block text-sm font-medium text-gray-900">{t('whatsapp.publicBaseUrl')}
            <input
              name="publicBaseUrl" type="url" autoComplete="off" className={`${input} ${base.valid ? '' : 'border-red-500'}`} value={form.publicBaseUrl}
              placeholder={t('whatsapp.publicBaseUrlPlaceholder')} onChange={e => update('publicBaseUrl', e.target.value)} aria-invalid={!base.valid}
            />
            <span className="mt-1 block text-xs font-normal text-gray-500">{t('whatsapp.publicBaseUrlHelp', { default: webhook.defaultBaseUrl })}</span>
            {!base.valid && <span className="mt-1 block text-xs text-red-600">{t('whatsapp.error.invalid_public_base_url')}</span>}
          </label>

          <div className="text-sm font-medium text-gray-900">
            <label htmlFor="callbackUrl">{t('whatsapp.callbackUrl')}</label>
            <div className="mt-1 flex">
              <input id="callbackUrl" readOnly value={callbackUrl} data-testid="callback-url" className="block w-full min-w-0 rounded-s-lg border border-gray-300 bg-gray-50 p-2 font-mono text-xs" onFocus={e => e.currentTarget.select()} />
              <button type="button" onClick={() => copy(callbackUrl, 'whatsapp.copiedUrl')} className="rounded-e-lg border border-s-0 border-gray-900 bg-gray-900 px-3 text-xs font-semibold text-white hover:bg-black">{t('whatsapp.copyUrl')}</button>
            </div>
            <span className="mt-1 block text-xs font-normal text-gray-500">{t('whatsapp.callbackUrlHelp', { path: WEBHOOK_PATH })}</span>
            {!isPublic && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-normal text-amber-900">{t('whatsapp.notPublic')}</p>}
          </div>

          <div className="text-sm font-medium text-gray-900">
            <label htmlFor="webhookVerifyToken">{t('whatsapp.verifyToken')}</label>{savedHint(saved?.webhookVerifyTokenMasked)}
            {form.webhookVerifyToken && !tokenIsSaved && <span className="ms-2 text-xs font-normal text-amber-700">{t('whatsapp.tokenUnsaved')}</span>}
            <div className="mt-1 flex">
              <input
                id="webhookVerifyToken" name="webhookVerifyToken" type={show.webhookVerifyToken ? 'text' : 'password'} autoComplete="new-password" data-lpignore="true" data-1p-ignore spellCheck={false}
                placeholder={saved?.webhookVerifyTokenMasked ? t('whatsapp.keepPlaceholder') : t('whatsapp.verifyTokenPlaceholder')}
                value={form.webhookVerifyToken} onChange={e => update('webhookVerifyToken', e.target.value)} aria-invalid={tokenInvalid}
                className={`block w-full min-w-0 rounded-s-lg border p-2 font-mono text-xs focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${tokenInvalid ? 'border-red-500' : 'border-gray-300'}`}
              />
              {toggleButton('webhookVerifyToken')}
            </div>
            <span className="mt-1 block text-xs font-normal text-gray-500">{t('whatsapp.verifyTokenHelp')}</span>
            {tokenInvalid && <span className="mt-1 block text-xs text-red-600">{t('whatsapp.error.invalid_verify_token')}</span>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={regenerate} className={buttonGhost} data-testid="regenerate-token">↻ {t('whatsapp.regenerate')}</button>
              {saved?.webhookVerifyTokenMasked && !form.webhookVerifyToken && <button type="button" onClick={revealSaved} className={buttonGhost} data-testid="reveal-token">{t('whatsapp.revealSaved')}</button>}
              <button type="button" disabled={!form.webhookVerifyToken} onClick={() => copy(form.webhookVerifyToken, 'whatsapp.copiedToken')} className={buttonGhost}>{t('whatsapp.copyToken')}</button>
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-900">{t('whatsapp.steps.title')}</p>
            <ol className="mt-2 list-decimal space-y-1 ps-5 text-xs text-blue-900">
              {(['whatsapp.steps.1', 'whatsapp.steps.2', 'whatsapp.steps.3', 'whatsapp.steps.4', 'whatsapp.steps.5'] as const).map(key => <li key={key}>{t(key)}</li>)}
            </ol>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
        <button type="submit" disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60" data-testid="whatsapp-save">{busy ? t('common.saving') : t('common.save')}</button>
        <button type="button" onClick={testConnection} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50">{t('settings.integrations.testConnection')}</button>
        <button type="button" onClick={testWebhook} disabled={dirty} title={dirty ? t('whatsapp.unsaved') : undefined} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50" data-testid="test-webhook">{t('whatsapp.testWebhook')}</button>
        {message && (
          <p role="status" aria-live="polite" data-testid="whatsapp-status" className={`text-sm ${message.tone === 'ok' ? 'text-green-700' : message.tone === 'error' ? 'text-red-600' : 'text-gray-600'}`}>{message.text}</p>
        )}
      </div>
    </form>
  );
}
