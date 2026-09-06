'use client';

import { useEffect, useState } from 'react';
import { COST_TYPES, DEFAULT_COST_TYPE } from '@/lib/constants';
import { todayLocal } from '@/lib/dates';
import { button, color, dateInput, font, input, radius, space } from '@/lib/theme';

/**
 * Add or edit a cost. Passing `cost` switches to edit mode, which also offers delete.
 *
 * Edit deliberately does not expose the invoiced state — that has its own control on
 * the row, and burying it here would make "fix a typo in the amount" a way to
 * accidentally un-bill a line.
 */
export default function CostForm({ project, userName, cost, onSaved, onCancel, onDeleted }) {
  const editing = Boolean(cost);

  const [date, setDate]         = useState(cost?.date || todayLocal());
  const [costType, setCostType] = useState(cost?.costType || DEFAULT_COST_TYPE);
  const [category, setCategory] = useState(cost?.categoryCode || '');
  const [description, setDesc]  = useState(cost?.description || '');
  // `?? ''` not String(cost.amount): an unreadable amount arrives as null, and
  // String(null) would prefill the field with the word "null"
  const [amount, setAmount]     = useState(cost?.amount ?? '');
  const [categories, setCats]   = useState([]);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    fetch('/api/reference')
      .then(r => r.json())
      .then(d => setCats(d.categories || []))
      .catch(() => setCats([]));
  }, []);

  const amountValue = parseFloat(String(amount).replace(/,/g, ''));
  const busy = saving || deleting;
  const canSave = costType && category && Number.isFinite(amountValue) && amountValue > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/costs', {
        method:  editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(editing
          ? { id: cost.id, date, costType, categoryCode: category, description, amount: amountValue }
          : {
              projectCode: project.code,
              projectName: project.address,
              date, costType, categoryCode: category,
              description, amount: amountValue,
              createdBy: userName,
            }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save');
        setSaving(false);
        return;
      }
      onSaved(data.cost);
    } catch {
      setError('No connection. Nothing was saved.');
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete this ${amountValue ? `$${amountValue} ` : ''}cost? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      const res  = await fetch(`/api/costs?id=${encodeURIComponent(cost.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not delete');
        setDeleting(false);
        return;
      }
      onDeleted(cost.id);
    } catch {
      setError('No connection. Nothing was deleted.');
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: space.lg }}>
      <Field label="Date">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={dateInput} />
      </Field>

      <Field label="Type">
        {/* Two columns, not one row: four labels as long as "External Labour" cannot sit
            side by side on a phone without wrapping mid-word or shrinking below the
            type scale. minWidth:0 lets each cell shrink inside the grid. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.sm }}>
          {COST_TYPES.map(t => {
            const on = costType === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setCostType(t.value)}
                style={{
                  minWidth: 0, padding: `${space.md}px ${space.sm}px`,
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

      <Field label="Description" hint="Optional. Shown as the row's main label.">
        <input
          value={description}
          onChange={e => setDesc(e.target.value)}
          placeholder="e.g. 2 workers, half day"
          autoComplete="off"
          style={input}
        />
      </Field>

      {editing && cost.invoiced && (
        <p style={{ margin: 0, fontSize: font.size.xs, color: color.muted }}>
          This cost is marked invoiced. Editing it here won&apos;t change that.
        </p>
      )}

      {error && (
        <p style={{
          margin: 0, padding: `${space.sm}px ${space.md}px`,
          background: color.dangerLight, color: color.danger,
          borderRadius: radius.md, fontSize: font.size.sm,
        }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: space.md }}>
        <button onClick={onCancel} disabled={busy} style={{ ...button.secondary, flex: 1 }}>
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!canSave}
          style={{ ...button.primary, flex: 2, opacity: canSave ? 1 : 0.45 }}
        >{saving ? 'Saving…' : editing ? 'Save changes' : 'Add cost'}</button>
      </div>

      {editing && (
        <button
          onClick={remove}
          disabled={busy}
          style={{
            ...button.secondary,
            color: color.danger, borderColor: color.dangerLight,
            fontSize: font.size.sm, opacity: busy ? 0.5 : 1,
          }}
        >{deleting ? 'Deleting…' : 'Delete this cost'}</button>
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <div style={{ fontSize: font.size.sm, fontWeight: 600, marginBottom: space.xs }}>{label}</div>
      {children}
      {hint && (
        <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: space.xs }}>{hint}</div>
      )}
    </label>
  );
}
