'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authedFetch } from '@/lib/authedFetch';
import { copyText } from '@/lib/clipboard';
import { useI18n } from '@/components/I18nProvider';
import NoAccess from '@/components/NoAccess';
import HelpLink from '@/components/HelpLink';
import { HELP_LINKS } from '@/lib/helpLinks';
import LanguageSelect from '@/components/LanguageSelect';
import { normalizeLocale, type TranslationKey } from '@/lib/i18n';
import { USER_ROLES, canManageAccount, isAdminRole, type UserRole } from '@/lib/users/roles';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  uiLanguage: string | null;
  createdBy: { firstName: string; lastName: string } | null;
}

type FormState = { firstName: string; lastName: string; email: string; role: UserRole; uiLanguage: string };
type FieldErrors = Partial<Record<keyof FormState, string>>;
type Credentials = { title: 'created' | 'reset'; name: string; email: string; password: string };
type Confirm = { kind: 'deactivate' | 'reset'; user: UserRow };

const input = 'mt-1 block w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';
const roleBadge: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-800',
  ADMIN: 'bg-blue-100 text-blue-800',
  MODERATOR: 'bg-amber-100 text-amber-800',
  AGENT: 'bg-emerald-100 text-emerald-800',
  VIEWER: 'bg-gray-100 text-gray-700',
};

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const initials = (u: { firstName: string; lastName: string }) => `${u.firstName.charAt(0)}${u.lastName.charAt(0)}`.toUpperCase() || '?';

function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'} rounded-2xl bg-white p-6 shadow-2xl`}>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { t, intl } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [company, setCompany] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [assignable, setAssignable] = useState<UserRole[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [form, setForm] = useState<FormState>({ firstName: '', lastName: '', email: '', role: 'AGENT', uiLanguage: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const errorText = useCallback((code?: string) => {
    const key = `users.error.${code}`;
    const text = t(key as TranslationKey);
    return text === key ? t('users.error.generic') : text;
  }, [t]);
  const roleLabel = (role: string) => t(`users.role.${role}` as TranslationKey);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const profileRes = await authedFetch('/api/auth/profile');
      if (!profileRes.ok) throw new Error('profile');
      const profile = (await profileRes.json()).user;
      setMyRole(profile.role);
      setMyId(profile.id);
      setCompany(profile.company?.name || '');
      if (!isAdminRole(profile.role)) return;
      const res = await authedFetch('/api/users', { cache: 'no-store' });
      if (!res.ok) throw new Error('users');
      const data = await res.json();
      setUsers(data.users);
      setAssignable(data.assignableRoles);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(u => (status === 'all' || (status === 'active') === u.isActive)
      && (!q || fullName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
  }, [users, query, status]);
  const activeCount = users.filter(u => u.isActive).length;

  const openCreate = () => {
    setForm({ firstName: '', lastName: '', email: '', role: 'AGENT', uiLanguage: '' });
    setFieldErrors({}); setFormError(''); setEditing('new');
  };
  const openEdit = (user: UserRow) => {
    setForm({ firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, uiLanguage: user.uiLanguage || '' });
    setFieldErrors({}); setFormError(''); setEditing(user);
  };

  const replaceUser = (user: UserRow) => setUsers(list => list.map(u => (u.id === user.id ? user : u)));

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!form.firstName.trim()) errors.firstName = 'required';
    if (!form.lastName.trim()) errors.lastName = 'required';
    if (editing === 'new' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = form.email.trim() ? 'invalid_email' : 'required';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true); setFormError('');
    try {
      const isNew = editing === 'new';
      const target = editing as UserRow;
      const body = isNew
        ? { firstName: form.firstName, lastName: form.lastName, email: form.email, role: form.role, uiLanguage: form.uiLanguage || undefined }
        : { firstName: form.firstName, lastName: form.lastName, ...(form.role !== target.role ? { role: form.role } : {}) };
      const res = await authedFetch(isNew ? '/api/users' : `/api/users/${target.id}`, {
        method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setFieldErrors(data.fields);
        setFormError(errorText(data.fields ? Object.values(data.fields)[0] as string : data.error));
        return;
      }
      setEditing(null);
      if (isNew) {
        setUsers(list => [...list, data.user]);
        setSavedConfirmed(false); setCopied(false);
        setCredentials({ title: 'created', name: fullName(data.user), email: data.user.email, password: data.password });
      } else {
        replaceUser(data.user);
        setNotice({ ok: true, text: t('users.saved') });
      }
    } catch {
      setFormError(t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (user: UserRow, isActive: boolean) => {
    setBusy(true);
    try {
      const res = await authedFetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ ok: false, text: errorText(data.error) }); return; }
      replaceUser(data.user);
      setNotice({ ok: true, text: t(isActive ? 'users.reactivated' : 'users.deactivated', { name: fullName(user) }) });
    } catch {
      setNotice({ ok: false, text: t('common.networkError') });
    } finally {
      setBusy(false); setConfirm(null);
    }
  };

  const resetPassword = async (user: UserRow) => {
    setBusy(true);
    try {
      const res = await authedFetch(`/api/users/${user.id}/reset-password`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ ok: false, text: errorText(data.error) }); return; }
      setSavedConfirmed(false); setCopied(false);
      setCredentials({ title: 'reset', name: fullName(user), email: data.email, password: data.password });
    } catch {
      setNotice({ ok: false, text: t('common.networkError') });
    } finally {
      setBusy(false); setConfirm(null);
    }
  };

  const copyCredential = async (text: string) => {
    if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'short' }) : t('users.never'));

  if (loading && !myRole) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: '#F1F3F4' }}>
        <div className="text-center">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-transparent" style={{ borderTopColor: 'rgb(32, 33, 36)' }} />
          <p className="mt-6 text-lg font-semibold" style={{ color: 'rgb(32, 33, 36)' }}>{t('users.loading')}</p>
        </div>
      </div>
    );
  }
  if (myRole && !isAdminRole(myRole)) return <NoAccess role={myRole} />;

  const editingUser = editing && editing !== 'new' ? editing : null;
  const roleOptions = editingUser && !assignable.includes(editingUser.role) ? [editingUser.role, ...assignable] : assignable;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F3F4' }}>
      <div className="px-6 py-10" style={{ backgroundColor: 'rgb(32, 33, 36)' }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-white">{t('users.title')}</h1>
            <p className="mt-2 text-gray-300">{t('users.subtitle', { company })}</p>
            <p className="mt-3 text-sm text-gray-400">{t('users.count', { active: activeCount, total: users.length })}</p>
          </div>
          <button onClick={openCreate} className="rounded-xl bg-emerald-500 px-5 py-2.5 font-semibold text-white shadow hover:bg-emerald-600" data-testid="add-user">+ {t('users.add')}</button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 pb-32">
        {notice && (
          <div role="status" className={`flex items-center justify-between rounded-lg px-4 py-2 text-sm ${notice.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100" aria-label={t('common.close')}>✕</button>
          </div>
        )}
        {loadError && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{t('users.loadError')}</p>}

        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('users.searchPlaceholder')} aria-label={t('common.search')} className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none" />
            <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label={t('users.col.status')}>
              <option value="all">{t('users.filter.all')}</option>
              <option value="active">{t('users.filter.active')}</option>
              <option value="inactive">{t('users.filter.inactive')}</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm" data-testid="users-table">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('users.col.user')}</th>
                  <th className="px-4 py-3">{t('users.col.role')}</th>
                  <th className="px-4 py-3">{t('users.col.status')}</th>
                  <th className="px-4 py-3">{t('users.col.lastLogin')}</th>
                  <th className="px-4 py-3 text-end">{t('users.col.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map(user => {
                  const isMe = user.id === myId;
                  const manageable = canManageAccount(myRole, user.role);
                  return (
                    <tr key={user.id} className={user.isActive ? '' : 'bg-gray-50 text-gray-500'} data-testid={`user-row-${user.email}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: user.isActive ? 'linear-gradient(90deg,#34d399,#f59e0b)' : '#9ca3af' }}>{initials(user)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-gray-900">{fullName(user)}{isMe && <span className="ms-2 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{t('users.you')}</span>}</p>
                            <p className="truncate text-xs text-gray-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${roleBadge[user.role] || roleBadge.VIEWER}`}>{roleLabel(user.role)}</span></td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${user.isActive ? 'text-green-700' : 'text-gray-500'}`}>
                          <span className={`h-2 w-2 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {user.isActive ? t('users.status.active') : t('users.status.inactive')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{formatDate(user.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        {manageable ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button onClick={() => openEdit(user)} className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100">{t('users.action.edit')}</button>
                            {!isMe && (user.isActive
                              ? <button onClick={() => setConfirm({ kind: 'deactivate', user })} className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100">{t('users.action.deactivate')}</button>
                              : <button onClick={() => setActive(user, true)} disabled={busy} className="rounded-lg bg-green-50 px-3 py-1 text-xs font-semibold text-green-800 hover:bg-green-100">{t('users.action.reactivate')}</button>)}
                            {!isMe && <button onClick={() => setConfirm({ kind: 'reset', user })} className="rounded-lg bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800 hover:bg-orange-100">{t('users.action.resetPassword')}</button>}
                          </div>
                        ) : (
                          <p className="text-end text-xs text-gray-400">{t('users.protected')}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && !loading && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">{t('users.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <section className="rounded-2xl border bg-white p-6 shadow-sm" aria-labelledby="roles-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="roles-title" className="text-lg font-bold text-gray-900">{t('users.roles.title')}</h2>
            <div className="flex flex-wrap gap-2">
              <HelpLink href={HELP_LINKS.roles} testId="help-roles" />
              <HelpLink href={HELP_LINKS.apiUsers} icon="api" label={t('help.apiReference')} testId="help-api-users" />
            </div>
          </div>
          <dl className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {USER_ROLES.map(role => (
              <div key={role} className="rounded-xl border p-3">
                <dt><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${roleBadge[role]}`}>{roleLabel(role)}</span></dt>
                <dd className="mt-2 text-xs text-gray-600">{t(`users.roleHelp.${role}` as TranslationKey)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {editing && (
        <Modal title={editing === 'new' ? t('users.form.createTitle') : t('users.form.editTitle')} onClose={() => !busy && setEditing(null)} wide>
          {editing === 'new' && <p className="mt-1 text-sm text-gray-600">{t('users.form.createIntro')}</p>}
          <form onSubmit={submitForm} className="mt-4 space-y-4" noValidate data-testid="user-form">
            <div className="grid gap-4 sm:grid-cols-2">
              {(['firstName', 'lastName'] as const).map(key => (
                <label key={key} className="block text-sm font-medium text-gray-900">{t(`users.form.${key}`)}
                  <input name={key} className={`${input} ${fieldErrors[key] ? 'border-red-500' : ''}`} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} autoComplete="off" maxLength={60} />
                  {fieldErrors[key] && <span className="mt-1 block text-xs text-red-600">{errorText(fieldErrors[key])}</span>}
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium text-gray-900">{t('users.form.email')}
              <input name="email" type="email" className={`${input} ${fieldErrors.email ? 'border-red-500' : ''} ${editing !== 'new' ? 'bg-gray-50 text-gray-500' : ''}`} value={form.email} readOnly={editing !== 'new'} onChange={e => setForm({ ...form, email: e.target.value })} autoComplete="off" />
              {editing !== 'new' && <span className="mt-1 block text-xs font-normal text-gray-500">{t('users.form.emailLocked')}</span>}
              {fieldErrors.email && <span className="mt-1 block text-xs text-red-600">{errorText(fieldErrors.email)}</span>}
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-gray-900">{t('users.form.role')}</legend>
              {editingUser?.id === myId && <p className="mt-1 text-xs text-gray-500">{t('users.selfLocked')}</p>}
              <div className="mt-2 space-y-2">
                {roleOptions.map(role => (
                  <label key={role} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${form.role === role ? 'border-gray-900 bg-gray-50' : 'border-gray-200'} ${editingUser?.id === myId ? 'cursor-not-allowed opacity-60' : ''}`}>
                    <input type="radio" name="role" value={role} checked={form.role === role} disabled={editingUser?.id === myId} onChange={() => setForm({ ...form, role })} className="mt-1" />
                    <span>
                      <span className="block text-sm font-semibold text-gray-900">{roleLabel(role)}</span>
                      <span className="block text-xs text-gray-600">{t(`users.roleHelp.${role}` as TranslationKey)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {editing === 'new' && (
              <label className="block text-sm font-medium text-gray-900">{t('users.form.language')}
                <LanguageSelect className={input} value={normalizeLocale(form.uiLanguage) || ''} emptyLabel={t('users.form.languageCompany')} onChange={code => setForm({ ...form, uiLanguage: code })} />
              </label>
            )}
            {formError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">{t('common.cancel')}</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60" data-testid="user-form-submit">
                {editing === 'new' ? (busy ? t('users.form.creating') : t('users.form.create')) : (busy ? t('common.saving') : t('users.form.save'))}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <Modal title={confirm.kind === 'deactivate' ? t('users.action.deactivate') : t('users.action.resetPassword')} onClose={() => !busy && setConfirm(null)}>
          <p className="mt-3 text-sm text-gray-700">{t(confirm.kind === 'deactivate' ? 'users.confirm.deactivate' : 'users.confirm.reset', { name: fullName(confirm.user) })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">{t('common.cancel')}</button>
            <button
              onClick={() => (confirm.kind === 'deactivate' ? setActive(confirm.user, false) : resetPassword(confirm.user))} disabled={busy} data-testid="confirm-action"
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${confirm.kind === 'deactivate' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'}`}
            >
              {confirm.kind === 'deactivate' ? t('users.action.deactivate') : t('users.action.resetPassword')}
            </button>
          </div>
        </Modal>
      )}

      {credentials && (
        <Modal title={credentials.title === 'created' ? t('users.password.createdTitle') : t('users.password.resetTitle')} wide>
          <p className="mt-1 text-sm text-gray-600">{t('users.password.intro', { name: credentials.name })}</p>
          <dl className="mt-4 space-y-3 rounded-xl border bg-gray-50 p-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('users.password.email')}</dt>
              <dd className="mt-1 font-mono text-sm text-gray-900" data-testid="credential-email">{credentials.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('users.password.password')}</dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg border bg-white px-3 py-2 font-mono text-sm text-gray-900" data-testid="credential-password">{credentials.password}</code>
                <button onClick={() => copyCredential(credentials.password)} className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black">{copied ? t('common.copied') : t('users.password.copy')}</button>
              </dd>
            </div>
          </dl>
          <button onClick={() => copyCredential(`${credentials.email}\n${credentials.password}`)} className="mt-2 text-xs font-semibold text-gray-700 underline">{t('users.password.copyAll')}</button>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900" role="alert">⚠️ {t('users.password.warning')}</p>
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={savedConfirmed} onChange={e => setSavedConfirmed(e.target.checked)} data-testid="credential-confirm" />
            {t('users.password.confirm')}
          </label>
          <div className="mt-6 flex justify-end">
            <button onClick={() => setCredentials(null)} disabled={!savedConfirmed} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50" data-testid="credential-done">{t('users.password.done')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
