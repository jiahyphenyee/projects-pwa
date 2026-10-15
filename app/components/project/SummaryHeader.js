'use client';

// The top of the Summary: the verdict (status flag) and the facts that frame it on the
// left; switching view and the one next action on the right. The address and code are
// already in the app bar above, so they are not repeated here.
//
// The primary action is the next thing money-wise — billing the next stage — and like
// every dashboard action it leaves for the screen where that happens (the quote screen,
// with its own confirm step and PIN). Nothing is billed from here.

import Link from 'next/link';
import Tag from '@/app/components/Tag';
import { FLAG_LABELS } from '@/lib/projectFigures.mjs';
import { formatIsoDate } from '@/lib/dates';
import { button, color, font, space } from '@/lib/theme';
import { money, FLAG_VARIANT } from './format';
import ViewSwitch from './ViewSwitch';

export default function SummaryHeader({ project, figures, billing, staleAt }) {
  const nextStage = billing?.items?.find(i => i.kind === 'stage' && !i.billed) || null;
  const quoteHref = `/projects/${encodeURIComponent(project.code)}/quote`;

  const facts = [
    project.propertyType || null,
    project.clientName || 'Direct job',
    project.startDate ? `Started ${formatIsoDate(project.startDate) || project.startDate}` : null,
    figures ? (figures.completed ? 'Completed' : 'Ongoing') : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
      gap: `${space.md}px ${space.lg}px`,
    }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.xs }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
          {figures?.flag && <Tag variant={FLAG_VARIANT[figures.flag]}>{FLAG_LABELS[figures.flag]}</Tag>}
          <span style={{ fontSize: font.size.sm, color: color.muted }}>{facts}</span>
        </div>
        {staleAt && (
          <span style={{ fontSize: font.size.xs, color: color.accent }}>
            Quote and Xero figures from {staleAt}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
        <ViewSwitch code={project.code} current="summary" />
        <Link href={quoteHref} style={{
          ...button.primary, display: 'inline-flex', alignItems: 'center', minHeight: 44,
          padding: `0 ${space.lg}px`, fontSize: font.size.sm, textDecoration: 'none', whiteSpace: 'nowrap',
        }}>
          {nextStage ? `Bill next stage · ${money(nextStage.amount)}` : billing?.quoteId ? 'Open quote' : 'Write the quote'}
        </Link>
      </div>
    </div>
  );
}
