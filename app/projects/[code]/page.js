'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import { useProjects } from '@/lib/useProjects';
import { recordRecent } from '@/lib/recents';
import { getUser } from '@/lib/session';
import { GENERAL_PROJECT_CODE } from '@/lib/constants';
import { card, color, font, radius, space } from '@/lib/theme';

export default function ProjectDetailPage({ params }) {
  // Next 16: params is a Promise, unwrapped with use() in client components
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);

  const { projects, loading, error } = useProjects();
  const [userName, setUserName] = useState('');
  const router = useRouter();

  const project = useMemo(
    () => projects.find(p => p.code === code) || null,
    [projects, code]
  );

  useEffect(() => { setUserName(getUser()?.name || ''); }, []);

  // Also record here so a direct link or refresh still counts as "opened"
  useEffect(() => {
    if (userName && project) recordRecent(userName, project.code);
  }, [userName, project]);

  const isGeneral = code === GENERAL_PROJECT_CODE;

  return (
    <AppShell
      title={project?.address || code}
      subtitle={project ? project.code : undefined}
      onBack={() => router.back()}
    >
      {loading && !project && (
        <p style={{ fontSize: font.size.sm, color: color.muted }}>Loading…</p>
      )}

      {!loading && !project && (
        <div style={{ ...card, padding: space.xl }}>
          <p style={{ margin: 0, fontSize: font.size.md, fontWeight: 500 }}>Project not found</p>
          <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.sm, color: color.muted }}>
            No project with code {code}. It may have been renamed or removed.
          </p>
        </div>
      )}

      {project && (
        <>
          <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
            {isGeneral && (
              <div style={{
                background: color.accentLight, color: color.accent,
                padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
                fontSize: font.size.xs, marginBottom: space.md,
              }}>
                General company costs. Excluded from cross-project totals.
              </div>
            )}
            <Detail label="Address" value={project.address} />
            <Detail label="Client"  value={project.clientName || '—'} />
            <Detail label="Status"  value={project.status || '—'} />
            <Detail label="Started" value={project.startDate || '—'} />
            {project.endDate && <Detail label="Target end" value={project.endDate} />}
          </section>

          <section style={{ ...card, padding: space.xl, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: font.size.md, fontWeight: 500 }}>Costs</p>
            <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.sm, color: color.muted }}>
              Cost entry and totals arrive in the next phase.
            </p>
          </section>
        </>
      )}

      {error && (
        <p style={{ marginTop: space.lg, fontSize: font.size.sm, color: color.accent }}>{error}</p>
      )}
    </AppShell>
  );
}

function Detail({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: space.md, padding: `${space.sm}px 0` }}>
      <span style={{ fontSize: font.size.sm, color: color.muted, width: 90, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: font.size.sm, flex: 1, minWidth: 0 }}>{value}</span>
    </div>
  );
}
