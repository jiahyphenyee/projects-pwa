'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { saveUser, getUser } from '@/lib/session';
import { color, font, radius, space, shadow } from '@/lib/theme';

export default function LoginPage() {
  const [pin, setPin]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const router   = useRouter();

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
        inputRef.current?.focus();
      }
    } catch {
      setError('No connection. Check your internet.');
      setPin('');
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [router]);

  function handleChange(e) {
    if (loading) return;
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    setError('');
    if (digits.length === 4) submit(digits);
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

      {/* The boxes are only a display. A real input sits invisibly on top so both the
          on-screen keyboard and a physical keyboard work, and tapping focuses it. */}
      <label
        style={{ position: 'relative', display: 'block', cursor: 'text' }}
        aria-label="PIN"
      >
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={loading}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            opacity: 0, border: 'none', background: 'transparent',
            // >=16px stops iOS zooming the page on focus
            fontSize: 16, color: 'transparent', caretColor: 'transparent',
          }}
        />
        <div style={{ display: 'flex', gap: space.md, pointerEvents: 'none' }}>
          {[0, 1, 2, 3].map(i => {
            const filled = i < pin.length;
            const active = focused && i === pin.length && !loading;
            return (
              <span key={i} style={{
                width: 52, height: 60,
                borderRadius: radius.md,
                background: color.surface,
                border: `2px solid ${active ? color.primary : filled ? color.primary : color.border}`,
                boxShadow: shadow.card,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color 120ms ease',
              }}>
                {filled && (
                  <span style={{
                    width: 12, height: 12, borderRadius: '50%', background: color.primary,
                  }} />
                )}
              </span>
            );
          })}
        </div>
      </label>

      <div style={{
        height: 22, marginTop: space.lg, fontSize: font.size.sm,
        color: error ? color.danger : color.muted, textAlign: 'center',
      }}>
        {loading ? 'Checking…' : error}
      </div>

      {!focused && !loading && (
        <button
          onClick={() => inputRef.current?.focus()}
          style={{
            marginTop: space.sm, background: 'transparent', border: 'none',
            color: color.primary, fontSize: font.size.sm, cursor: 'pointer',
            fontFamily: font.stack, padding: space.sm,
          }}
        >
          Tap to enter PIN
        </button>
      )}
    </main>
  );
}
