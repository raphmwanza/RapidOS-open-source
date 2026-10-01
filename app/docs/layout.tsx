import type { ReactNode } from 'react';
import MarketingShell from '@/components/marketing/MarketingShell';
import DocsSidebar from '@/components/marketing/DocsSidebar';
import { API_GROUPS } from '@/lib/marketing/api';

export default function DocsLayout({ children }: { children: ReactNode }) {
  const apiSections = API_GROUPS.map((g) => ({ id: g.id, title: g.title }));
  return (
    <MarketingShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <aside>
          <DocsSidebar apiSections={[...apiSections, { id: 'webhook-signature', title: 'Webhook signatures' }]} />
        </aside>
        <article className="min-w-0 max-w-4xl pb-16">{children}</article>
      </div>
    </MarketingShell>
  );
}
