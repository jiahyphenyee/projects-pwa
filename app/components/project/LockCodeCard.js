'use client';

import { useEffect, useState } from 'react';
import LockCodeInput from '@/app/components/LockCodeInput';
import { button, card, color, font, radius, space } from '@/lib/theme';

/**
 * The site's door or gate code — the one thing on a project row worth editing from a
 * phone, and usually needed while standing at the door. Shown plainly rather than
 * masked: anyone who can open the project already has the job.
 */
export default function LockCodeCard({ project, onSaved }) {
  const saved = project.lockCode || '';
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(saved);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // The project list revalidates in the background, so the field follows what the
  // sheet says — except while it is being typed in.
  useEffect(() => { if (!editing) setValue(saved); }, [saved, editing]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res  = await fetch('/api/projects', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: project.code, lockCode: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the lock code');
      setValue(data.lockCode);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Offline — the lock code was not saved' : err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ ...card, padding: space.lg, marginBottom: space.lg }}>
      {editing ? (
        <>
          <LockCodeInput value={value} onChange={setValue} autoFocus />
          <div style={{ display: 'flex', gap: space.md, marginTop: space.md }}>
            <button
              onClick={() => { setEditing(false); setValue(saved); setError(''); }}
              disabled={saving}
              style={{ ...button.secondary, flex: 1, fontSize: font.size.sm, padding: '11px 14px' }}
            >Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              style={{ ...button.primary, flex: 1, fontSize: font.size.sm, padding: '11px 14px', opacity: saving ? 0.5 : 1 }}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
          <p style={{ margin: `${space.sm}px 0 0`, fontSize: font.size.xs, color: color.muted }}>
            Leave it empty to clear the code.
          </p>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: font.size.xs, color: color.muted }}>Lock code</div>
            <div style={{
              fontSize: saved ? font.size.md : font.size.sm,
              fontWeight: saved ? 600 : 400,
              color: saved ? color.text : color.muted,
              marginTop: 2,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',     // a sentence may carry its own line breaks
              overflowWrap: 'anywhere',   // …and an unbroken code must not widen the card
            }}>{saved || 'Not set'}</div>
          </div>
          <button
            onClick={() => { setEditing(true); setError(''); }}
            style={{ ...button.secondary, flexShrink: 0, fontSize: font.size.sm, padding: '9px 14px' }}
          >{saved ? 'Edit' : 'Add'}</button>
        </div>
      )}

      {error && (
        <p style={{
          margin: `${space.md}px 0 0`, padding: `${space.sm}px ${space.md}px`,
          background: color.dangerLight, color: color.danger,
          borderRadius: radius.md, fontSize: font.size.sm,
        }}>{error}</p>
      )}
    </section>
  );
}
