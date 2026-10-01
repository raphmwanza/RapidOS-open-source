'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SITE } from '@/config/site';
import {
  CLAIMS_PER_MONTH_RANGES,
  COMPANY_TYPES,
  COVERAGE_OPTIONS,
  DEPLOYMENT_OPTIONS,
  EMPLOYEE_RANGES,
  HEARD_FROM_OPTIONS,
  HONEYPOT_FIELD,
  INSURED_CUSTOMER_RANGES,
} from '@/config/contact';
import {
  CONTACT_ERROR_TEXT,
  CONTACT_LIMITS,
  normalizeContact,
  validateContact,
  type ContactFieldError,
  type ContactInput,
} from '@/lib/contact/validate';

type Errors = Partial<Record<keyof ContactInput, ContactFieldError>>;

const EMPTY: ContactInput = {
  fullName: '', workEmail: '', phone: '', companyName: '', country: '', companyType: '', employees: '',
  insuredCustomers: '', claimsPerMonth: '', coverages: [], deployment: '', desiredStart: '', heardFrom: '', message: '',
};

const inputClass = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';

function Field({ id, label, required, error, children, hint }: { id: string; label: string; required?: boolean; error?: ContactFieldError; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {label}{required && <span className="text-red-600" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-600">{CONTACT_ERROR_TEXT[error]}</p>}
    </div>
  );
}

/** The /contact form. Posts to /api/contact; nothing is e-mailed. */
export default function ContactForm() {
  const [values, setValues] = useState<ContactInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'rate_limited'>('idle');
  const startedAt = useRef<number>(0);
  const honeypot = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const set = <K extends keyof ContactInput>(key: K, value: ContactInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const toggleCoverage = (c: string) => {
    set('coverages', values.coverages.includes(c) ? values.coverages.filter((x) => x !== c) : [...values.coverages, c]);
  };

  const aria = (field: keyof ContactInput) => (errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` } : {});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = normalizeContact(values as unknown as Record<string, unknown>);
    const found = validateContact(input);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      const first = Object.keys(found)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, [HONEYPOT_FIELD]: honeypot.current?.value || '', startedAt: startedAt.current }),
      });
      if (res.status === 201) {
        setStatus('sent');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (res.status === 429) {
        setStatus('rate_limited');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && data?.fields) setErrors(data.fields);
      setStatus('error');
    } catch {
      setStatus('error');
    }
  }

  const mailto = (
    <a href={`mailto:${SITE.contactEmail}`} className="font-semibold text-emerald-700 underline">{SITE.contactEmail}</a>
  );

  if (status === 'sent') {
    return (
      <div role="status" data-testid="contact-success" className="rounded-2xl border border-emerald-300 bg-emerald-50 p-8 text-center">
        <h2 className="text-2xl font-bold text-emerald-900">Thank you, your request was sent</h2>
        <p className="mt-3 text-emerald-900">
          We read every request and reply by email or WhatsApp, usually within two business days.
        </p>
        <p className="mt-3 text-sm text-emerald-900">Prefer email? Write to {mailto}.</p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-8 rounded-2xl border border-gray-200 p-6 shadow-sm sm:p-8" data-testid="contact-form">
      {/* Anti-spam field: hidden from people and screen readers, bots fill it. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor={HONEYPOT_FIELD}>Website</label>
        <input ref={honeypot} id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-gray-900">About you</legend>
        <Field id="fullName" label="Full name" required error={errors.fullName}>
          <input id="fullName" name="fullName" className={inputClass} autoComplete="name" maxLength={CONTACT_LIMITS.fullName} value={values.fullName} onChange={(e) => set('fullName', e.target.value)} {...aria('fullName')} />
        </Field>
        <Field id="workEmail" label="Work email" required error={errors.workEmail}>
          <input id="workEmail" name="workEmail" type="email" className={inputClass} autoComplete="email" maxLength={CONTACT_LIMITS.workEmail} value={values.workEmail} onChange={(e) => set('workEmail', e.target.value)} {...aria('workEmail')} />
        </Field>
        <Field id="phone" label="Phone / WhatsApp" required error={errors.phone} hint="With the country code, e.g. +243 81 000 0000">
          <input id="phone" name="phone" type="tel" className={inputClass} autoComplete="tel" maxLength={CONTACT_LIMITS.phone} value={values.phone} onChange={(e) => set('phone', e.target.value)} {...aria('phone')} />
        </Field>
        <Field id="heardFrom" label="How did you hear about us?" error={errors.heardFrom}>
          <select id="heardFrom" name="heardFrom" className={inputClass} value={values.heardFrom} onChange={(e) => set('heardFrom', e.target.value)}>
            <option value="">Choose…</option>
            {HEARD_FROM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-lg font-semibold text-gray-900">Your company</legend>
        <Field id="companyName" label="Company name" required error={errors.companyName}>
          <input id="companyName" name="companyName" className={inputClass} autoComplete="organization" maxLength={CONTACT_LIMITS.companyName} value={values.companyName} onChange={(e) => set('companyName', e.target.value)} {...aria('companyName')} />
        </Field>
        <Field id="country" label="Country" required error={errors.country}>
          <input id="country" name="country" className={inputClass} autoComplete="country-name" maxLength={CONTACT_LIMITS.country} value={values.country} onChange={(e) => set('country', e.target.value)} {...aria('country')} />
        </Field>
        <Field id="companyType" label="Company type" required error={errors.companyType}>
          <select id="companyType" name="companyType" className={inputClass} value={values.companyType} onChange={(e) => set('companyType', e.target.value)} {...aria('companyType')}>
            <option value="">Choose…</option>
            {COMPANY_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field id="employees" label="Number of employees" required error={errors.employees}>
          <select id="employees" name="employees" className={inputClass} value={values.employees} onChange={(e) => set('employees', e.target.value)} {...aria('employees')}>
            <option value="">Choose…</option>
            {EMPLOYEE_RANGES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field id="insuredCustomers" label="Estimated insured customers" required error={errors.insuredCustomers}>
          <select id="insuredCustomers" name="insuredCustomers" className={inputClass} value={values.insuredCustomers} onChange={(e) => set('insuredCustomers', e.target.value)} {...aria('insuredCustomers')}>
            <option value="">Choose…</option>
            {INSURED_CUSTOMER_RANGES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field id="claimsPerMonth" label="Estimated claims per month" required error={errors.claimsPerMonth}>
          <select id="claimsPerMonth" name="claimsPerMonth" className={inputClass} value={values.claimsPerMonth} onChange={(e) => set('claimsPerMonth', e.target.value)} {...aria('claimsPerMonth')}>
            <option value="">Choose…</option>
            {CLAIMS_PER_MONTH_RANGES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </fieldset>

      <fieldset>
        <legend className="text-lg font-semibold text-gray-900">Your project</legend>
        <div className="mt-4">
          <p className="block text-sm font-medium text-gray-800" id="coverages-label">
            Coverage types of interest<span className="text-red-600" aria-hidden="true"> *</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="coverages-label">
            {COVERAGE_OPTIONS.map((c) => {
              const on = values.coverages.includes(c);
              return (
                <label key={c} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${on ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-gray-300 text-gray-700 hover:border-emerald-400'}`}>
                  <input type="checkbox" name="coverages" value={c} checked={on} onChange={() => toggleCoverage(c)} className="h-4 w-4 accent-emerald-600" />
                  {c}
                </label>
              );
            })}
          </div>
          {errors.coverages && <p id="coverages-error" className="mt-1 text-xs font-medium text-red-600">{errors.coverages === 'required' ? 'Choose at least one coverage type.' : CONTACT_ERROR_TEXT[errors.coverages]}</p>}
        </div>

        <div className="mt-6">
          <p className="block text-sm font-medium text-gray-800" id="deployment-label">
            Deployment preference<span className="text-red-600" aria-hidden="true"> *</span>
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="deployment-label">
            {DEPLOYMENT_OPTIONS.map((d) => (
              <label key={d.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${values.deployment === d.value ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-gray-300 text-gray-700 hover:border-emerald-400'}`}>
                <input type="radio" name="deployment" value={d.value} checked={values.deployment === d.value} onChange={() => set('deployment', d.value)} className="h-4 w-4 accent-emerald-600" />
                {d.label}
              </label>
            ))}
          </div>
          {errors.deployment && <p id="deployment-error" className="mt-1 text-xs font-medium text-red-600">{CONTACT_ERROR_TEXT[errors.deployment]}</p>}
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field id="desiredStart" label="Desired start date" error={errors.desiredStart}>
            <input id="desiredStart" name="desiredStart" type="date" className={inputClass} value={values.desiredStart} onChange={(e) => set('desiredStart', e.target.value)} {...aria('desiredStart')} />
          </Field>
        </div>

        <div className="mt-6">
          <Field id="message" label="Message" required error={errors.message}>
            <textarea id="message" name="message" rows={5} className={inputClass} maxLength={CONTACT_LIMITS.message} placeholder="What would you like RapidOS to do for your claims team?" value={values.message} onChange={(e) => set('message', e.target.value)} {...aria('message')} />
          </Field>
        </div>
      </fieldset>

      {status === 'error' && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Your request could not be sent. Check the fields above and try again, or write to {mailto}.
        </p>
      )}
      {status === 'rate_limited' && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Too many requests were sent from your network. Please try again later, or write to {mailto}.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-500">Fields marked * are required. We only use your details to answer your request.</p>
        <button type="submit" disabled={status === 'sending'} className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
          {status === 'sending' ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </form>
  );
}
