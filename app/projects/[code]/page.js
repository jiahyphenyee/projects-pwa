'use client';

// A project's Summary view — the dashboard. Wide, read-only, laid out after the build
// spec's Project page mock-up: the verdict and next action, six headline figures, where
// the cost went, quoted against spent per service, billing and Xero side by side, and
// the newest costs. Every action leaves for the screen where the change is made.
//
// Admins only (the SUMMARY permission). Everyone else, and GEN-000 (no quote, no
// invoices), is sent to the Costs view, so a bookmark or a link from Home still lands
// somewhere useful.

import { use, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import { DashboardStack, PanelGrid } from '@/app/components/dashboard/Grid';
import SummaryHeader from '@/app/components/project/SummaryHeader';
import SummaryTiles from '@/app/components/project/SummaryTiles';
import CostSplitPanel from '@/app/components/project/CostSplitPanel';
import ServiceBreakdownCard from '@/app/components/project/ServiceBreakdownCard';
import XeroInvoicesCard from '@/app/components/project/XeroInvoicesCard';
import LatestCostsPanel from '@/app/components/project/LatestCostsPanel';
import QuoteBillingCard from '@/app/components/quote/QuoteBillingCard';
import XeroQuotesCard from '@/app/components/project/XeroQuotesCard';
import { useProjects } from '@/lib/useProjects';
import { useProjectCosts } from '@/lib/useProjectCosts';
import { useProjectDashboard } from '@/lib/useProjectDashboard';
import { useViewer } from '@/lib/useViewer';
import { recordRecent } from '@/lib/recents';
import { GENERAL_PROJECT_CODE } from '@/lib/constants';
import { PERMISSIONS } from '@/lib/roles.mjs';
import { describeAge } from '@/lib/localCache';
import { costSplit, serviceBreakdown, projectFigures, possibleDuplicates } from '@/lib/projectFigures.mjs';
import { card, color, font, radius, space } from '@/lib/theme';

const banner = tone => ({
  margin: 0, padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md, fontSize: font.size.xs,
  background: tone === 'danger' ? color.dangerLight : color.accentLight,
  color: tone === 'danger' ? color.danger : color.accent,
});

export default function ProjectSummaryPage({ params }) {
  // Next 16: params is a Promise, unwrapped with use() in client components
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);
  const router = useRouter();

  const { projects, loading: projectsLoading } = useProjects();
  const { userName, can, ready } = useViewer();
  const isGeneral = code === GENERAL_PROJECT_CODE;
  const showSummary = ready && can(PERMISSIONS.SUMMARY) && !isGeneral;

  // Wait for the session before routing: until it is read, every viewer looks like they
  // have no Summary, and an admin would be bounced to Costs.
  useEffect(() => {
    if (ready && !showSummary) router.replace(`/projects/${encodeURIComponent(code)}/costs`);
  }, [ready, showSummary, code, router]);

  const project = useMemo(() => projects.find(p => p.code === code) || null, [projects, code]);

  useEffect(() => {
    if (showSummary && userName && project) recordRecent(userName, project.code);
  }, [showSummary, userName, project]);

  const { lines, loading, error, stale } = useProjectCosts(code);
  const dash = useProjectDashboard(code, showSummary);

  const split      = useMemo(() => costSplit(lines), [lines]);
  const duplicates = useMemo(() => possibleDuplicates(lines), [lines]);
  const breakdown  = useMemo(
    () => serviceBreakdown(lines, dash.quote?.hasQuote ? dash.quote.byService : null),
    [lines, dash.quote]
  );
  const figures = dash.loaded && project
    ? projectFigures({
        cost:     split.total,
        quoted:   dash.quote?.quoted ?? null,
        invoices: dash.invoiceSummary,
        status:   project.status,
        settings: dash.settings,
      })
    : null;

  return (
    <AppShell
      title={project?.address || code}
      subtitle={project ? project.code : undefined}
      onBack={() => router.push('/home')}
      layout="dashboard"
    >
      {(!showSummary || (projectsLoading && !project)) && (
        <p style={{ fontSize: font.size.sm, color: color.muted }}>Loading…</p>
      )}

      {showSummary && !projectsLoading && !project && (
        <div style={{ ...card, padding: space.xl }}>
          <p style={{ margin: 0, fontSize: font.size.md, fontWeight: 500 }}>Project not found</p>
          <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.sm, color: color.muted }}>
            No project with code {code}.
          </p>
        </div>
      )}

      {showSummary && project && (
        <DashboardStack>
          <SummaryHeader project={project} figures={figures} billing={dash.billing} staleAt={dash.staleAt} />

          {error && <p style={banner('danger')}>{error}</p>}
          {stale && (
            <p style={banner()}>
              {stale.offline ? 'Offline — costs' : 'Costs'} saved {describeAge(stale.at)}. The figures may have moved on.
            </p>
          )}

          {/* Priority order: on a phone these stack exactly as written */}
          <SummaryTiles
            cost={split.total}
            figures={loading ? null : figures}
            quote={dash.quote}
            quoteError={dash.quoteError}
            invoicesError={dash.invoices?.error || null}
          />

          <CostSplitPanel split={split} />

          {!loading && <ServiceBreakdownCard breakdown={breakdown} settings={dash.settings} />}

          <PanelGrid>
            <QuoteBillingCard projectCode={project.code} summary={dash.billing} projectInvoiced={dash.invoiceSummary?.invoiced ?? null} />
            <XeroInvoicesCard code={project.code} address={project.address} summary={dash.invoiceSummary} invoices={dash.invoices} />
            <XeroQuotesCard code={project.code} />
          </PanelGrid>

          {!loading && <LatestCostsPanel code={project.code} lines={lines} duplicates={duplicates} />}
        </DashboardStack>
      )}
    </AppShell>
  );
}
