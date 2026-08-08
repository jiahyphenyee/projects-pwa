'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/app/components/AppShell';
import { invalidateProjectsCache } from '@/lib/useProjects';
import { recordRecent } from '@/lib/recents';
import { getUser } from '@/lib/session';
import { todayLocal } from '@/lib/dates';
import { button, card, color, font, input, radius, space } from '@/lib/theme';

export default function NewProjectPage() {
  const [address, setAddress]     = useState('');
  const [clientName, setClient]   = useState('');
  const [startDate, setStartDate] = useState(todayLocal);
  const [clients, setClients]     = useState([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const [userName, setUserName]   = useState('');
  const router = useRouter();

  useEffect(() => { setUserName(getUser()?.name || ''); }, []);

  useEffect(() => {
    fetch('/api/reference')
      .then(r => r.json())
      .then(d => setClients(d.clients || []))
      .catch(() => setClients([]));
  }, []);

  async function submit(force = false) {
    if (!address.trim() || saving) return;
    setSaving(true);
    setError('');
    if (force) setDuplicate(null);

    try {
      const res = await fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ displayAddress: address, clientName, startDate, force }),
      });
      const data = await res.json();

      if (res.status === 409 && data.duplicate) {
        setDuplicate(data.duplicate);
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Could not create the project');
        setSaving(false);
        return;
      }

      // Warnings mean the row was written but something looks off — surface, don't hide
      if (data.warnings?.length) {
        alert(`Project created, but:\n\n${data.warnings.join('\n')}`);
      }

      invalidateProjectsCache();
      recordRecent(userName, data.project.code);
      router.replace(`/projects/${encodeURIComponent(data.project.code)}`);

    } catch {
      setError('No connection. The project was not created.');
      setSaving(false);
    }
  }

  const canSave = address.trim().length > 0 && !saving;

  return (
    <AppShell title="New project" onBack={() => router.back()}>
      <div style={{ ...card, padding: space.lg, display: 'grid', gap: space.lg }}>
        <Field label="Address" hint="Also used as the project name. Cannot be changed later.">
          <input
            value={address}
            onChange={e => { setAddress(e.target.value); setDuplicate(null); }}
            placeholder="e.g. 297 Tampines St 22 #11-576"
            autoComplete="off"
            style={input}
          />
        </Field>

        <Field label="Client" hint="Optional.">
          <select
            value={clientName}
            onChange={e => setClient(e.target.value)}
            style={{ ...input, appearance: 'none', background: color.surface }}
          >
            <option value="">No client</option>
            {clients.map(c => (
              <option key={c.id} value={c.companyName}>{c.companyName}</option>
            ))}
          </select>
        </Field>

        <Field label="Start date">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={input}
          />
        </Field>

        <p style={{ margin: 0, fontSize: font.size.xs, color: color.muted }}>
          Status will be set to <strong>active</strong>.
        </p>
      </div>

      {duplicate && (
        <div style={{
          ...card, padding: space.lg, marginTop: space.lg,
          borderColor: color.accent, background: color.accentLight,
        }}>
          <p style={{ margin: 0, fontSize: font.size.sm, fontWeight: 600, color: color.accent }}>
            Already exists
          </p>
          <p style={{ margin: `${space.sm}px 0 ${space.md}px`, fontSize: font.size.sm, color: color.text }}>
            {duplicate.code} — {duplicate.address}
            {duplicate.clientName && ` (${duplicate.clientName})`}
          </p>
          <p style={{ margin: `0 0 ${space.md}px`, fontSize: font.size.xs, color: color.muted }}>
            Two projects can share an address if they are for different clients.
          </p>
          <div style={{ display: 'flex', gap: space.md }}>
            <button
              onClick={() => router.replace(`/projects/${encodeURIComponent(duplicate.code)}`)}
              style={{ ...button.secondary, flex: 1 }}
            >Open existing</button>
            <button
              onClick={() => submit(true)}
              disabled={saving}
              style={{ ...button.primary, flex: 1, background: color.accent }}
            >Create anyway</button>
          </div>
        </div>
      )}

      {error && (
        <p style={{
          marginTop: space.lg, padding: `${space.sm}px ${space.md}px`,
          background: color.dangerLight, color: color.danger,
          borderRadius: radius.md, fontSize: font.size.sm,
        }}>{error}</p>
      )}

      {!duplicate && (
        <button
          onClick={() => submit(false)}
          disabled={!canSave}
          style={{
            ...button.primary,
            width: '100%', marginTop: space.lg,
            opacity: canSave ? 1 : 0.45,
          }}
        >{saving ? 'Creating…' : 'Create project'}</button>
      )}
    </AppShell>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: font.size.sm, fontWeight: 600, marginBottom: space.xs }}>{label}</div>
      {children}
      {hint && (
        <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: space.xs }}>{hint}</div>
      )}
    </label>
  );
}
