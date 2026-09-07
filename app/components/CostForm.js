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
              displayAddress: project.address,
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
      {/* First, not last: it is the row's label, so it is what the person is actually
          naming. The fields under it are all defaulted or picked. */}
      <Field label="Description" hint="Optional. Shown as the row's main label.">
        <input
          value={description}
          onChange={e => setDesc(e.target.value)}
          placeholder="e.g. 2 workers, half day"
          autoComplete="off"
          style={input}
        />
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

      <Field label="Date">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={dateInput} />
      </Field>

      <Field label="Category">
        {/* `appearance: none` is needed to stop iOS drawing its own oversized control,
            but it takes the disclosure arrow with it and leaves the field looking like a
            text input. The chevron is drawn back as a background image — an inline SVG so
            it needs no network request and no extra element inside the label. */}
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{
            ...input,
            appearance: 'none',
            WebkitAppearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%236B7280' stroke-width='1.75' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: `right ${space.md}px center`,
            // Room for the chevron, so a long category name never runs underneath it
            paddingRight: 38,
          }}
        >
          <option value="">Select a category…</option>
          {categories.map(c => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </Field>

      {/* Last: it is the only field already answered on arrival, and the one a person is
          least likely to change. */}
      <Field label="Cost type">
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
