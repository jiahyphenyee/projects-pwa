'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { saveUser, getUser } from '@/lib/session';
import { color, font, radius, space, shadow } from '@/lib/theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function LoginPage() {
  const [pin, setPin]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (getUser()) router.replace('/home');
  }, [router]);

  const submit = useCallback(async (value) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin: value }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        saveUser(data.user);
        router.replace('/home');
      } else {
        setError(data.error || 'Incorrect PIN');
        setPin('');
        setLoading(false);
      }
    } catch {
      setError('No connection. Check your internet.');
      setPin('');
      setLoading(false);
    }
  }, [router]);

  function press(key) {
    if (loading) return;
    setError('');
    if (key === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (!key || pin.length >= 4) return;

    const next = pin + key;
    setPin(next);
    if (next.length === 4) submit(next);
  }

  return (
    <main style={{
      minHeight:      '100svh',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        space.xl,
      background:     color.bg,
      fontFamily:     font.stack,
      color:          color.text,
    }}>
      <div style={{ textAlign: 'center', marginBottom: space.xl }}>
        <div style={{
          width: 60, height: 60, borderRadius: radius.lg,
          background: color.primary, boxShadow: shadow.lift,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          gap: 4, margin: '0 auto', padding: 14, boxSizing: 'border-box',
        }}>
          <span style={{ width: 6, height: 12, background: '#fff', borderRadius: 2, opacity: 0.6 }} />
          <span style={{ width: 6, height: 22, background: '#fff', borderRadius: 2, opacity: 0.8 }} />
          <span style={{ width: 6, height: 32, background: '#fff', borderRadius: 2 }} />
        </div>
        <h1 style={{ fontSize: font.size.xl, fontWeight: 600, margin: `${space.lg}px 0 ${space.xs}px` }}>
          Projects
        </h1>
        <p style={{ fontSize: font.size.sm, color: color.muted, margin: 0 }}>
          Enter your 4-digit PIN
        </p>
      </div>

      {/* PIN dots */}
      <div style={{ display: 'flex', gap: space.md, marginBottom: space.lg }} aria-live="polite">
        {[0, 1, 2, 3].map(i => (
          <span key={i} style={{
            width: 14, height: 14, borderRadius: '50%',
            background: i < pin.length ? color.primary : 'transparent',
            border: `2px solid ${i < pin.length ? color.primary : color.border}`,
            transition: 'background 120ms ease',
          }} />
        ))}
      </div>

      <div style={{
        height: 20, marginBottom: space.md, fontSize: font.size.sm,
        color: error ? color.danger : color.muted,
      }}>
        {loading ? 'Checking…' : error}
      </div>

      {/* Keypad */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: space.md,
      }}>
        {KEYS.map((key, i) => key === '' ? <span key={i} /> : (
          <button
            key={i}
            onClick={() => press(key)}
            disabled={loading}
            style={{
              height:       72,
              borderRadius: '50%',
              border:       `1px solid ${color.border}`,
              background:   key === '⌫' ? 'transparent' : color.surface,
              boxShadow:    key === '⌫' ? 'none' : shadow.card,
              fontSize:     key === '⌫' ? 20 : 26,
              fontWeight:   400,
              color:        color.text,
              cursor:       loading ? 'default' : 'pointer',
              opacity:      loading ? 0.5 : 1,
              fontFamily:   font.stack,
              WebkitTapHighlightColor: 'transparent',
            }}
          >{key}</button>
        ))}
      </div>
    </main>
  );
}
