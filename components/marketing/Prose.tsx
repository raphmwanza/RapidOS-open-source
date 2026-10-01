import type { ReactNode } from 'react';

// Small building blocks for the docs pages (server components).

export function DocTitle({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header className="mb-8 border-b border-gray-200 pb-6">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{title}</h1>
      {lead && <p className="mt-3 text-lg text-gray-600">{lead}</p>}
    </header>
  );
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group mt-12 scroll-mt-24 text-2xl font-bold tracking-tight text-gray-900">
      <a href={`#${id}`} className="no-underline">
        {children}
        <span className="ml-2 text-gray-300 opacity-0 group-hover:opacity-100" aria-hidden="true">#</span>
      </a>
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return <h3 id={id} className="mt-8 scroll-mt-24 text-lg font-semibold text-gray-900">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-7 text-gray-700">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-gray-700">{children}</ul>;
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className="mt-4 list-decimal space-y-2 pl-6 leading-7 text-gray-700">{children}</ol>;
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800 [overflow-wrap:anywhere]">{children}</code>;
}

export function Callout({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'tip'; title?: string; children: ReactNode }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    tip: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[kind];
  return (
    <div className={`mt-6 rounded-lg border px-4 py-3 text-sm leading-6 ${styles}`} role="note">
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
        <thead className="bg-gray-50">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold text-gray-900">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top text-gray-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NextLink({ href, title }: { href: string; title: string }) {
  return (
    <div className="mt-16 border-t border-gray-200 pt-6">
      <a href={href} className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-600">
        Next: {title} <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}
