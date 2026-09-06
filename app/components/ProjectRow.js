'use client';

import { useRouter } from 'next/navigation';
import { recordRecent } from '@/lib/recents';
import { GENERAL_PROJECT_CODE } from '@/lib/constants';
import { color, font, radius, space } from '@/lib/theme';

export default function ProjectRow({ project, userName, showCode = true }) {
  const router = useRouter();
  const isGeneral = project.code === GENERAL_PROJECT_CODE;

  function open() {
    recordRecent(userName, project.code);
    router.push(`/projects/${encodeURIComponent(project.code)}`);
  }

  return (
    <button
      onClick={open}
      style={{
        display:      'block',
        width:        '100%',
        textAlign:    'left',
        background:   'transparent',
        border:       'none',
        borderRadius: radius.md,
        padding:      `${space.md}px ${space.sm}px`,
        cursor:       'pointer',
        fontFamily:   font.stack,
        color:        color.text,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
        <span style={{
          fontSize:   font.size.md,
          fontWeight: 500,
          lineHeight: 1.35,
          flex:       1,
          minWidth:   0,
        }}>
          {project.address || project.code}
        </span>
        {showCode && (
          <span style={{
            fontSize: font.size.xs, color: color.subtle,
            fontVariantNumeric: 'tabular-nums', flexShrink: 0,
          }}>
            {project.code}
          </span>
        )}
      </div>

      <div style={{
        marginTop: 3, fontSize: font.size.xs, color: color.muted,
        display: 'flex', alignItems: 'center', gap: space.sm,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {isGeneral
          ? <span style={{ color: color.accent }}>General company costs</span>
          : <span>{project.clientName || 'No client'}</span>}
        {project.status && project.status !== 'active' && (
          <span style={{
            background: color.accentLight, color: color.accent,
            padding: '1px 7px', borderRadius: radius.pill, fontSize: 11,
          }}>{project.status}</span>
        )}
      </div>
    </button>
  );
}
