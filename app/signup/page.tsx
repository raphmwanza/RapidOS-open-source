'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/components/I18nProvider';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import LanguageSelect from '@/components/LanguageSelect';
import { getLocale, localeLabel, type Locale, type TranslationKey } from '@/lib/i18n';
import { BEHAVIOR_TOGGLES, COVERAGE_CATALOG, defaultBehaviorToggles, type BehaviorToggleKey, type CoverageType } from '@/lib/company/catalog';
import { parseSignupInput, slugify, type SignupErrorCode, type SignupErrors, type SignupField } from '@/lib/company/signupInput';

type TextField = Exclude<SignupField, 'coverage' | 'toggles' | 'language'>;

interface FormState {
  companyName: string; slug: string; domain: string; country: string; city: string; address: string;
  contactEmail: string; contactPhone: string; claimsEmail: string; businessHours: string; whatsappDisplayNumber: string; logoUrl: string; primaryColor: string;
  adminFirstName: string; adminLastName: string; adminEmail: string;
  coverage: CoverageType[];
  toggles: Record<BehaviorToggleKey, boolean>;
  language: Locale;
}

interface SignupResult {
  company: { name: string; language: Locale };
  admin: { email: string };
  coverage: string[];
  password: string;
}

const STEPS = [
  { id: 'company', fields: ['companyName', 'slug', 'domain', 'country', 'city', 'address'] },
  { id: 'contact', fields: ['contactEmail', 'contactPhone', 'claimsEmail', 'businessHours', 'whatsappDisplayNumber', 'logoUrl', 'primaryColor'] },
  { id: 'admin', fields: ['adminFirstName', 'adminLastName', 'adminEmail'] },
  { id: 'coverage', fields: ['coverage'] },
  { id: 'assistant', fields: ['language', 'toggles'] },
  { id: 'review', fields: [] },
] as const satisfies ReadonlyArray<{ id: string; fields: readonly SignupField[] }>;

type StepId = (typeof STEPS)[number]['id'];

const inputCls = (invalid: boolean) =>
  `mt-1.5 block w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:ring-4 ${invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-gray-300 focus:border-emerald-500 focus:ring-emerald-100'}`;

export default function SignupPage() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<SignupErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SignupResult | null>(null);
  const [form, setForm] = useState<FormState>(() => ({
    companyName: '', slug: '', domain: '', country: '', city: '', address: '',
    contactEmail: '', contactPhone: '', claimsEmail: '', businessHours: '', whatsappDisplayNumber: '', logoUrl: '', primaryColor: '#16a34a',
    adminFirstName: '', adminLastName: '', adminEmail: '',
    coverage: ['AUTO'],
    toggles: defaultBehaviorToggles(),
    language: locale,
  }));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [languageTouched, setLanguageTouched] = useState(false);

  // Until the language is picked explicitly, the company language follows the page language switcher.
  useEffect(() => {
    if (!languageTouched) setForm((prev) => (prev.language === locale ? prev : { ...prev, language: locale }));
  }, [locale, languageTouched]);

  const current: StepId = STEPS[step].id;
  const companyLabel = form.companyName.trim() || t('signup.field.companyName.placeholder');

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'companyName' && !slugTouched) next.slug = slugify(String(value));
      return next;
    });
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const copy = { ...prev };
      delete copy[key as SignupField];
      return copy;
    });
  };

  const errorText = (field: SignupField, code: SignupErrorCode | undefined): string => {
    if (!code) return '';
    if (code === 'taken') {
      const specific = `signup.error.taken.${field}` as TranslationKey;
      return ['companyName', 'slug', 'domain', 'adminEmail'].includes(field) ? t(specific) : t('signup.error.taken');
    }
    return t(`signup.error.${code}` as TranslationKey);
  };

  const stepErrors = (index: number, all: SignupErrors): SignupErrors => {
    const fields = STEPS[index].fields as readonly SignupField[];
    return Object.fromEntries(Object.entries(all).filter(([k]) => fields.includes(k as SignupField))) as SignupErrors;
  };

  const focusTop = () => requestAnimationFrame(() => headingRef.current?.focus());

  const goTo = (index: number) => { setStep(index); setFormError(''); focusTop(); };

  const next = () => {
    const { errors: all } = parseSignupInput(form);
    const mine = stepErrors(step, all);
    if (Object.keys(mine).length > 0) {
      setErrors((prev) => ({ ...prev, ...mine }));
      setFormError(t('signup.error.fixFields'));
      return;
    }
    goTo(Math.min(step + 1, STEPS.length - 1));
  };

  const firstStepWithError = (errs: SignupErrors) =>
    STEPS.findIndex((s) => (s.fields as readonly SignupField[]).some((f) => f in errs));

  const submit = async () => {
    const { errors: all } = parseSignupInput(form);
    if (Object.keys(all).length > 0) {
      setErrors(all);
      setFormError(t('signup.error.fixFields'));
      const idx = firstStepWithError(all);
      if (idx >= 0) goTo(idx);
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.password) {
        setResult(data as SignupResult);
        focusTop();
        return;
      }
      if ((response.status === 400 || response.status === 409) && data?.fields) {
        setErrors(data.fields);
        const idx = firstStepWithError(data.fields);
        setFormError(t('signup.error.fixFields'));
        if (idx >= 0) goTo(idx);
        return;
      }
      setFormError(response.status === 429 ? t('signup.error.rate_limited') : t('signup.error.generic'));
    } catch {
      setFormError(t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const toggleCoverage = (type: CoverageType) =>
    set('coverage', form.coverage.includes(type) ? form.coverage.filter((c) => c !== type) : [...form.coverage, type]);

  const renderField = (field: TextField, opts: { type?: string; optional?: boolean; help?: TranslationKey; placeholder?: boolean; autoComplete?: string; className?: string } = {}) => {
    const code = errors[field];
    const id = `f-${field}`;
    const placeholderKey = `signup.field.${field}.placeholder` as TranslationKey;
    return (
      <div className={opts.className}>
        <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-gray-800">
          <span>{t(`signup.field.${field}` as TranslationKey)}{!opts.optional && <span className="text-red-500"> *</span>}</span>
          {opts.optional && <span className="text-xs font-normal text-gray-400">{t('common.optional')}</span>}
        </label>
        <input
          id={id}
          name={field}
          type={opts.type || 'text'}
          autoComplete={opts.autoComplete}
          value={form[field] as string}
          placeholder={opts.placeholder === false ? undefined : t(placeholderKey)}
          aria-invalid={Boolean(code)}
          aria-describedby={code ? `${id}-err` : opts.help ? `${id}-help` : undefined}
          onChange={(e) => {
            if (field === 'slug') setSlugTouched(true);
            set(field, field === 'slug' ? e.target.value.toLowerCase() : e.target.value);
          }}
          className={inputCls(Boolean(code))}
        />
        {code ? (
          <p id={`${id}-err`} className="mt-1.5 text-xs font-medium text-red-600">{errorText(field, code)}</p>
        ) : opts.help ? (
          <p id={`${id}-help`} className="mt-1.5 text-xs text-gray-500">{t(opts.help)}</p>
        ) : null}
      </div>
    );
  };

  const reviewRows = useMemo(() => {
    const none = t('signup.review.none');
    const v = (s: string) => s.trim() || none;
    return [
      { step: 0, title: t('signup.step.company'), rows: [
        [t('signup.field.companyName'), v(form.companyName)], [t('signup.field.slug'), v(form.slug)], [t('signup.field.domain'), v(form.domain)],
        [t('signup.field.country'), v(form.country)], [t('signup.field.city'), v(form.city)], [t('signup.field.address'), v(form.address)],
      ] },
      { step: 1, title: t('signup.step.contact'), rows: [
        [t('signup.field.contactEmail'), v(form.contactEmail)], [t('signup.field.contactPhone'), v(form.contactPhone)],
        [t('signup.field.claimsEmail'), v(form.claimsEmail)], [t('signup.field.businessHours'), v(form.businessHours)],
        [t('signup.field.whatsappDisplayNumber'), v(form.whatsappDisplayNumber)], [t('signup.field.logoUrl'), v(form.logoUrl)], [t('signup.field.primaryColor'), form.primaryColor || none],
      ] },
      { step: 2, title: t('signup.step.admin'), rows: [
        [t('signup.field.adminFirstName'), v(form.adminFirstName)], [t('signup.field.adminLastName'), v(form.adminLastName)], [t('signup.field.adminEmail'), v(form.adminEmail)],
      ] },
      { step: 3, title: t('signup.step.coverage'), rows: [
        [t('signup.step.coverage'), COVERAGE_CATALOG.filter((c) => form.coverage.includes(c.type)).map((c) => t(`catalog.coverage.${c.type}` as TranslationKey)).join(', ') || none],
      ] },
      { step: 4, title: t('signup.step.assistant'), rows: [
        [t('signup.assistant.languageTitle'), localeLabel(form.language)],
        ...BEHAVIOR_TOGGLES.map((tg) => [t(`catalog.toggle.${tg.key}` as TranslationKey), form.toggles[tg.key] ? t('signup.review.on') : t('signup.review.off')]),
      ] },
    ];
  }, [form, t]);

  if (result) {
    return <SuccessScreen result={result} headingRef={headingRef} onLogin={() => {
      // The dashboard opens in the company's language; clear the password from memory.
      setLocale(result.company.language);
      const email = result.admin.email;
      setResult(null);
      router.push(`/login?created=1&email=${encodeURIComponent(email)}`);
    }} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <img src="/assets/images/icon.png" alt="Rapidos" className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-4">
          <p className="hidden text-sm text-gray-600 sm:block">
            {t('signup.haveAccount')}{' '}
            <Link href="/login" className="font-semibold text-emerald-700 hover:text-emerald-600">{t('signup.signIn')}</Link>
          </p>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[280px_1fr]">
        {/* Stepper */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{t('signup.pageTitle')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('signup.pageSubtitle')}</p>
          <ol className="mt-8 hidden space-y-1 lg:block">
            {STEPS.map((s, i) => {
              const state = i < step ? 'done' : i === step ? 'current' : 'todo';
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={i > step}
                    onClick={() => goTo(i)}
                    aria-current={state === 'current' ? 'step' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition ${state === 'current' ? 'bg-white shadow-sm ring-1 ring-gray-200' : 'hover:bg-white/60 disabled:hover:bg-transparent'}`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${state === 'done' ? 'bg-emerald-600 text-white' : state === 'current' ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500'}`}>
                      {state === 'done' ? '✓' : i + 1}
                    </span>
                    <span>
                      <span className={`block text-sm font-semibold ${state === 'todo' ? 'text-gray-500' : 'text-gray-900'}`}>{t(`signup.step.${s.id}` as TranslationKey)}</span>
                      <span className="block text-xs text-gray-500">{t(`signup.step.${s.id}.hint` as TranslationKey)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* Form card */}
        <section className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-gray-100 sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">{t('signup.stepOf', { current: step + 1, total: STEPS.length })}</p>
            <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-bold text-gray-900 outline-none">{t(`signup.step.${current}` as TranslationKey)}</h2>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
          </div>

          <form
            noValidate
            onSubmit={(e) => { e.preventDefault(); if (current === 'review') submit(); else next(); }}
            className="space-y-6"
          >
            {current === 'company' && (
              <div className="grid gap-5 sm:grid-cols-2">
                {renderField('companyName', { autoComplete: 'organization', className: 'sm:col-span-2' })}
                {renderField('slug', { help: 'signup.field.slug.help', placeholder: false })}
                {renderField('domain', { optional: true, autoComplete: 'url' })}
                {renderField('country', { autoComplete: 'country-name' })}
                {renderField('city', { autoComplete: 'address-level2' })}
                {renderField('address', { optional: true, autoComplete: 'street-address', className: 'sm:col-span-2' })}
              </div>
            )}

            {current === 'contact' && (
              <div className="space-y-5">
                <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{t('signup.contact.knowledgeNote')}</p>
                <div className="grid gap-5 sm:grid-cols-2">
                  {renderField('contactEmail', { type: 'email', autoComplete: 'email' })}
                  {renderField('contactPhone', { type: 'tel', autoComplete: 'tel' })}
                  {renderField('claimsEmail', { type: 'email', optional: true })}
                  {renderField('businessHours', { optional: true })}
                  {renderField('whatsappDisplayNumber', { type: 'tel', optional: true, help: 'signup.field.whatsappDisplayNumber.help', className: 'sm:col-span-2' })}
                  {renderField('logoUrl', { type: 'url', optional: true })}
                  <div>
                    <label htmlFor="f-primaryColor" className="flex items-baseline justify-between text-sm font-medium text-gray-800">
                      <span>{t('signup.field.primaryColor')}</span>
                      <span className="text-xs font-normal text-gray-400">{t('common.optional')}</span>
                    </label>
                    <div className="mt-1.5 flex items-center gap-3">
                      <input id="f-primaryColor" type="color" value={form.primaryColor || '#16a34a'} onChange={(e) => set('primaryColor', e.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border border-gray-300 bg-white p-1" />
                      <span className="font-mono text-sm text-gray-600">{form.primaryColor}</span>
                      {form.logoUrl && /^https?:\/\//i.test(form.logoUrl) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.logoUrl} alt="" className="ms-auto h-11 w-11 rounded-lg border border-gray-200 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                    </div>
                    {errors.primaryColor && <p className="mt-1.5 text-xs font-medium text-red-600">{errorText('primaryColor', errors.primaryColor)}</p>}
                  </div>
                </div>
              </div>
            )}

            {current === 'admin' && (
              <div className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  {renderField('adminFirstName', { autoComplete: 'given-name', placeholder: false })}
                  {renderField('adminLastName', { autoComplete: 'family-name', placeholder: false })}
                  {renderField('adminEmail', { type: 'email', autoComplete: 'email', className: 'sm:col-span-2' })}
                </div>
                <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                  <span aria-hidden>🔐</span>
                  <div className="space-y-1"><p>{t('signup.admin.passwordNote')}</p><p className="text-sky-800/80">{t('signup.admin.roleNote')}</p></div>
                </div>
              </div>
            )}

            {current === 'coverage' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{t('signup.coverage.title')}</p>
                    <p className="mt-1 text-sm text-gray-600">{t('signup.coverage.subtitle')}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500">{t('signup.coverage.selected', { count: form.coverage.length })}</span>
                    <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => set('coverage', COVERAGE_CATALOG.map((c) => c.type))}>{t('signup.coverage.selectAll')}</button>
                    <button type="button" className="font-semibold text-gray-500 hover:underline" onClick={() => set('coverage', [])}>{t('signup.coverage.clear')}</button>
                  </div>
                </div>
                <div role="group" aria-label={t('signup.step.coverage')} className="grid gap-3 sm:grid-cols-2">
                  {COVERAGE_CATALOG.map((c) => {
                    const on = form.coverage.includes(c.type);
                    return (
                      <label key={c.type} className={`relative flex cursor-pointer gap-3 rounded-2xl border-2 p-4 transition ${on ? 'border-emerald-500 bg-emerald-50/60' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleCoverage(c.type)} name="coverage" value={c.type} />
                        <span className="text-2xl" aria-hidden>{c.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-gray-900">{t(`catalog.coverage.${c.type}` as TranslationKey)}</span>
                          <span className="mt-0.5 block text-xs text-gray-600">{t(`catalog.coverage.${c.type}.desc` as TranslationKey)}</span>
                          <span className="mt-2 flex gap-2 text-[11px] font-medium text-gray-500">
                            <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200">{t('signup.coverage.fields', { count: c.fields.length })}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200">{t('signup.coverage.documents', { count: c.documents.length })}</span>
                          </span>
                        </span>
                        <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-xs font-bold ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-transparent'}`}>✓</span>
                      </label>
                    );
                  })}
                </div>
                {errors.coverage && <p className="text-sm font-medium text-red-600">{errorText('coverage', errors.coverage)}</p>}
              </div>
            )}

            {current === 'assistant' && (
              <div className="space-y-8">
                <fieldset>
                  <legend className="font-semibold text-gray-900">{t('signup.assistant.languageTitle')}</legend>
                  <p className="mt-1 text-sm text-gray-600">{t('signup.assistant.languageSubtitle')}</p>
                  <div className="mt-3 max-w-md">
                    <LanguageSelect
                      id="signup-language"
                      name="language"
                      aria-label={t('signup.assistant.languageTitle')}
                      value={form.language}
                      onChange={(code) => { if (!code) return; setLanguageTouched(true); set('language', code); }}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 font-semibold text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                    {!getLocale(form.language).reviewed && (
                      <p className="mt-2 text-xs text-amber-700">{t('common.language.machineTranslated')}</p>
                    )}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="font-semibold text-gray-900">{t('signup.assistant.togglesTitle')}</legend>
                  <p className="mt-1 text-sm text-gray-600">{t('signup.assistant.togglesSubtitle')}</p>
                  <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200">
                    {BEHAVIOR_TOGGLES.map((tg) => {
                      const on = form.toggles[tg.key];
                      const id = `toggle-${tg.key}`;
                      return (
                        <li key={tg.key} className="flex items-start justify-between gap-4 p-4">
                          <div>
                            <label htmlFor={id} className="block text-sm font-semibold text-gray-900">{t(`catalog.toggle.${tg.key}` as TranslationKey)}</label>
                            <p className="mt-0.5 text-xs text-gray-600">{t(`catalog.toggle.${tg.key}.desc` as TranslationKey)}</p>
                          </div>
                          <button
                            id={id}
                            type="button"
                            role="switch"
                            aria-checked={on}
                            onClick={() => set('toggles', { ...form.toggles, [tg.key]: !on })}
                            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-emerald-600' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>

                <p className="flex gap-3 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900"><span aria-hidden>✨</span>{t('signup.assistant.promptNote', { company: companyLabel })}</p>
              </div>
            )}

            {current === 'review' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">{t('signup.review.title')}</p>
                {reviewRows.map((section) => (
                  <div key={section.title} className="rounded-2xl border border-gray-200">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                      <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>
                      <button type="button" onClick={() => goTo(section.step)} className="text-xs font-semibold text-emerald-700 hover:underline">{t('signup.review.edit')}</button>
                    </div>
                    <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
                      {section.rows.map(([k, val]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-xs text-gray-500">{k}</dt>
                          <dd className="truncate font-medium text-gray-900" title={val}>{val}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            )}

            {formError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>}

            <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-6">
              <button type="button" onClick={() => goTo(Math.max(0, step - 1))} disabled={step === 0 || busy}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:invisible">
                <span aria-hidden="true" className="inline-block rtl:-scale-x-100">←</span> {t('common.back')}
              </button>
              <button type="submit" disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60">
                {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {current === 'review' ? (busy ? t('signup.submitting') : t('signup.submit')) : <>{t('common.continue')} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span></>}
              </button>
            </div>
          </form>
          <p className="mt-6 text-center text-sm text-gray-600 sm:hidden">
            {t('signup.haveAccount')}{' '}
            <Link href="/login" className="font-semibold text-emerald-700">{t('signup.signIn')}</Link>
          </p>
        </section>
      </main>
    </div>
  );
}

function SuccessScreen({ result, onLogin, headingRef }: { result: SignupResult; onLogin: () => void; headingRef: React.RefObject<HTMLHeadingElement> }) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirmed, setConfirmed] = useState(false);
  const passwordRef = useRef<HTMLElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.password);
      setCopyState('copied');
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS origin): select the text instead.
      const el = passwordRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setCopyState('failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-emerald-50 px-4 py-10">
      <div className="absolute end-4 top-4"><LanguageSwitcher /></div>
      <main className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-xl ring-1 ring-gray-100">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden>✓</div>
        <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-center text-2xl font-bold text-gray-900 outline-none">{t('signup.success.title')}</h1>
        <p className="mt-2 text-center text-sm text-gray-600">{t('signup.success.subtitle', { company: result.company.name, count: result.coverage.length })}</p>

        <div role="alert" className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">⚠️ {t('signup.success.warningTitle')}</p>
          <p className="mt-1">{t('signup.success.warning')}</p>
        </div>

        <dl className="mt-6 space-y-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('signup.success.email')}</dt>
            <dd className="mt-1 break-all rounded-xl bg-gray-50 px-4 py-3 font-mono text-sm text-gray-900" data-testid="admin-email">{result.admin.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('signup.success.password')}</dt>
            <dd className="mt-1 flex items-stretch gap-2">
              <code ref={passwordRef} data-testid="generated-password" className="flex-1 select-all break-all rounded-xl bg-gray-900 px-4 py-3 font-mono text-sm text-emerald-300">{result.password}</code>
              <button type="button" onClick={copy} className="shrink-0 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                {copyState === 'copied' ? `✓ ${t('common.copied')}` : t('common.copy')}
              </button>
            </dd>
            <p className="mt-1.5 text-xs text-gray-500" role="status">
              {copyState === 'copied' ? t('signup.success.copied') : copyState === 'failed' ? t('signup.success.copyFailed') : ''}
            </p>
          </div>
        </dl>

        <label className="mt-4 flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          {t('signup.success.confirm')}
        </label>

        <button type="button" onClick={onLogin} disabled={!confirmed}
          className="mt-6 w-full rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40">
          {t('signup.success.goToLogin')}
        </button>
        <p className="mt-4 text-center text-xs text-gray-500">{t('signup.success.next')}</p>
      </main>
    </div>
  );
}
