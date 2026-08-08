'use client';

// Auth gate + header for every signed-in screen. Future dashboard sections drop in here
// rather than each page re-implementing the gate and chrome.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, clearUser, daysRemaining } from '@/lib/session';
import { card, color, font, radius, shadow, space } from '@/lib/theme';

export default function AppShell({ title, subtitle, onBack, actions, children }) {
  const [user, setUser]       = useState(null);
  const [ready, setReady]     = useState(false);
  const [menuOpen, setMenu]   = useState(false);
  const [daysLeft, setDays]   = useState(null);
  const menuRef = useRef(null);
  const router  = useRouter();

  useEffect(() => {
    const u = getUser();
    if (!u) { router.replace('/'); return; }
    setUser(u);
    setDays(daysRemaining());
    setReady(true);
  }, [router]);

  // Close the menu on an outside tap or Escape
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false);
    }
    function onKey(e) { if (e.key === 'Escape') setMenu(false); }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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

        {/* The name opens a menu — logging out on a single tap of your own name
            is far too easy to do by accident */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenu(o => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              padding: '7px 11px', borderRadius: 8, fontSize: font.size.xs,
              cursor: 'pointer', fontFamily: font.stack,
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            {user?.name || 'Account'}
            <span style={{ fontSize: 9, opacity: 0.8 }}>▾</span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                ...card,
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                minWidth: 190, padding: space.sm, boxShadow: shadow.lift,
                zIndex: 20, color: color.text,
              }}
            >
              <div style={{ padding: `${space.sm}px ${space.md}px` }}>
                <div style={{ fontSize: font.size.sm, fontWeight: 600 }}>{user?.name}</div>
                <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: 2 }}>
                  {user?.role}
                  {daysLeft != null && ` · signed in for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}`}
                </div>
              </div>

              <div style={{ height: 1, background: color.border, margin: `${space.xs}px 0` }} />

              <button
                role="menuitem"
                onClick={handleLogout}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none',
                  padding: `${space.md}px`, borderRadius: radius.sm,
                  fontSize: font.size.sm, color: color.danger,
                  cursor: 'pointer', fontFamily: font.stack,
                }}
              >Log out</button>
            </div>
          )}
        </div>
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
