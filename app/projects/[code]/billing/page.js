'use client';

// A project's Billing view — for the office role, who quote and bill but do not see the
// Summary's profit and margin. The same two panels the Summary shows side by side: the
// quote's stages and VOs (linking to the quote screen), and the project's Xero invoices.
//
// Admins have both panels on the Summary and are sent there; anyone with neither
// permission, and GEN-000 (no quote, no invoices), is sent to Costs.

import { use, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import { DashboardStack, PanelGrid } from '@/app/components/dashboard/Grid';
import ViewSwitch from '@/app/components/project/ViewSwitch';
import XeroInvoicesCard from '@/app/components/project/XeroInvoicesCard';
import QuoteBillingCard from '@/app/components/quote/QuoteBillingCard';
import { useProjects } from '@/lib/useProjects';
import { useProjectDashboard } from '@/lib/useProjectDashboard';
import { useViewer } from '@/lib/useViewer';
import { recordRecent } from '@/lib/recents';
import { GENERAL_PROJECT_CODE } from '@/lib/constants';
import { PERMISSIONS } from '@/lib/roles.mjs';
import { card, color, font, radius, space } from '@/lib/theme';

export default function ProjectBillingPage({ params }) {
  // Next 16: params is a Promise, unwrapped with use() in client components
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);
  const router = useRouter();

  const { projects, loading: projectsLoading } = useProjects();
  const { userName, can, ready } = useViewer();
  const base = `/projects/${encodeURIComponent(code)}`;
  const isGeneral = code === GENERAL_PROJECT_CODE;
  const canQuote = can(PERMISSIONS.QUOTES);
  const canSeeInvoices = can(PERMISSIONS.INVOICES);
  const toSummary = ready && can(PERMISSIONS.SUMMARY) && !isGeneral;
  const show = ready && !toSummary && !isGeneral && (canQuote || canSeeInvoices);

  // Wait for the session before routing, as the Summary does
  useEffect(() => {
    if (!ready) return;
    if (toSummary) router.replace(base);
    else if (!show) router.replace(`${base}/costs`);
  }, [ready, toSummary, show, base, router]);

  const project = useMemo(() => projects.find(p => p.code === code) || null, [projects, code]);

  useEffect(() => {
    if (show && userName && project) recordRecent(userName, project.code);
  }, [show, userName, project]);

  const dash = useProjectDashboard(code, show);

  return (
    <AppShell
      title={project?.address || code}
      subtitle={project ? project.code : undefined}
      onBack={() => router.push('/home')}
      layout="dashboard"
    >
      {(!show || (projectsLoading && !project)) && (
        <p style={{ fontSize: font.size.sm, color: color.muted }}>Loading…</p>
      )}

      {show && !projectsLoading && !project && (
        <div style={{ ...card, padding: space.xl }}>
          <p style={{ margin: 0, fontSize: font.size.md, fontWeight: 500 }}>Project not found</p>
          <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.sm, color: color.muted }}>
            No project with code {code}.
          </p>
        </div>
      )}

      {show && project && (
        <DashboardStack>
          <ViewSwitch code={project.code} current="billing" />

          {dash.staleAt && (
            <p style={{
              margin: 0, padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md, fontSize: font.size.xs,
              background: color.accentLight, color: color.accent,
            }}>
              Xero invoices from {dash.staleAt}. They may have moved on.
            </p>
          )}

          <PanelGrid>
            {canQuote && <QuoteBillingCard projectCode={project.code} summary={dash.billing} />}
            {canSeeInvoices && (
              <XeroInvoicesCard code={project.code} address={project.address} summary={dash.invoiceSummary} invoices={dash.invoices} />
            )}
          </PanelGrid>
        </DashboardStack>
      )}
    </AppShell>
  );
}
