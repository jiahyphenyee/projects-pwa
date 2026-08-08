'use client';

import { useEffect, useState } from 'react';
import { COST_TYPES, DEFAULT_COST_TYPE } from '@/lib/constants';
import { todayLocal } from '@/lib/dates';
import { button, color, font, input, radius, space } from '@/lib/theme';

export default function CostForm({ project, userName, onSaved, onCancel }) {
  const [date, setDate]         = useState(todayLocal);
  const [costType, setCostType] = useState(DEFAULT_COST_TYPE);
  const [category, setCategory] = useState('');
  const [description, setDesc]  = useState('');
  const [amount, setAmount]     = useState('');
  const [categories, setCats]   = useState([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    fetch('/api/reference')
      .then(r => r.json())
      .then(d => setCats(d.categories || []))
      .catch(() => setCats([]));
  }, []);

  const amountValue = parseFloat(String(amount).replace(/,/g, ''));
  const canSave = costType && category && Number.isFinite(amountValue) && amountValue > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/costs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectCode:    project.code,
          displayAddress: project.address,
          date, costType, categoryCode: category,
          description, amount: amountValue,
          createdBy: userName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save the cost');
        setSaving(false);
        return;
      }
      onSaved(data.cost);
    } catch {
      setError('No connection. The cost was not saved.');
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: space.lg }}>
      <Field label="Date">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />
      </Field>

      <Field label="Type">
        <div style={{ display: 'flex', gap: space.sm }}>
          {COST_TYPES.map(t => {
            const on = costType === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setCostType(t.value)}
                style={{
                  flex: 1, padding: `${space.md}px ${space.xs}px`,
                  borderRadius: radius.md, cursor: 'pointer',
                  fontSize: font.size.sm, fontWeight: on ? 600 : 400,
                  fontFamily: font.stack,
                  border: `1.5px solid ${on ? color.primary : color.border}`,
                  background: on ? color.primaryLight : color.surface,
                  color: on ? color.primaryDark : color.text,
                }}
              >{t.label}</button>
            );
          })}
        </div>
      </Field>

      <Field label="Category">
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{ ...input, appearance: 'none' }}
        >
          <option value="">Select a category…</option>
          {categories.map(c => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Amount">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
          style={{ ...input, fontVariantNumeric: 'tabular-nums' }}
        />
      </Field>

      <Field label="Description" hint="Optional.">
        <input
          value={description}
          onChange={e => setDesc(e.target.value)}
          placeholder="e.g. 2 workers, half day"
          autoComplete="off"
          style={input}
        />
      </Field>

      {error && (
        <p style={{
          margin: 0, padding: `${space.sm}px ${space.md}px`,
          background: color.dangerLight, color: color.danger,
          borderRadius: radius.md, fontSize: font.size.sm,
        }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: space.md }}>
        <button onClick={onCancel} disabled={saving} style={{ ...button.secondary, flex: 1 }}>
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!canSave}
          style={{ ...button.primary, flex: 2, opacity: canSave ? 1 : 0.45 }}
        >{saving ? 'Saving…' : 'Add cost'}</button>
      </div>
    </div>
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
