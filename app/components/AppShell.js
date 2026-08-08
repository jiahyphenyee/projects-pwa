'use client';

// Auth gate + header for every signed-in screen. Future dashboard sections drop in here
// rather than each page re-implementing the gate and chrome.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, clearUser } from '@/lib/session';
import { color, font, space } from '@/lib/theme';

export default function AppShell({ title, subtitle, onBack, actions, children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const u = getUser();
    if (!u) { router.replace('/'); return; }
    setUser(u);
    setReady(true);
  }, [router]);

  function handleLogout() {
    clearUser();
    router.replace('/');
  }

  // Render nothing until the session is confirmed, so protected content never flashes
  if (!ready) {
    return <main style={{ minHeight: '100svh', background: color.bg }} />;
  }

  return (
    <div style={{
      minHeight:  '100svh',
      background: color.bg,
      fontFamily: font.stack,
      color:      color.text,
    }}>
      <header style={{
        position:     'sticky',
        top:          0,
        zIndex:       10,
        background:   color.primary,
        color:        '#fff',
        padding:      `calc(${space.md}px + env(safe-area-inset-top)) ${space.lg}px ${space.md}px`,
        display:      'flex',
        alignItems:   'center',
        gap:          space.md,
      }}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >←</button>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: font.size.lg, fontWeight: 600, lineHeight: 1.2 }}>{title}</div>
          {subtitle && (
            <div style={{
              fontSize: font.size.xs, opacity: 0.85, marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{subtitle}</div>
          )}
        </div>

        {actions}

        <button
          onClick={handleLogout}
          style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
            padding: '7px 11px', borderRadius: 8, fontSize: font.size.xs,
            cursor: 'pointer', flexShrink: 0, fontFamily: font.stack,
          }}
        >{user?.name || 'Log out'}</button>
      </header>

      <main style={{
        padding: `${space.lg}px`,
        paddingBottom: `calc(${space.xxl}px + env(safe-area-inset-bottom))`,
        maxWidth: 720,
        margin: '0 auto',
      }}>
        {children}
      </main>
    </div>
  );
}
