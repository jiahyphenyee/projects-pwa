'use client';

// One cost, opened from the Costs list: the receipt behind it, everything the row has no
// room for, and how it was billed. Receipts come straight from the expense's Xero bill
// (lib/receipts.js); nothing is stored by this app.
//
// Billing, three ways:
//   Not billed yet
//   Billed in project invoice   — the tick, as on the list
//   Billed direct to client     — on its own Xero invoice (e.g. materials + delivery),
//                                 picked from this project's invoices; kept in invoice_ref

import { useEffect, useState } from 'react';
import Tag from '@/app/components/Tag';
import { billingMode } from '@/lib/costBilling.mjs';
import { formatRowAmount } from '@/app/components/TotalsCard';
import { formatIsoDate } from '@/lib/dates';
import { button, card, color, font, radius, space } from '@/lib/theme';

const fact = { display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: `4px ${space.md}px`, fontSize: font.size.sm, margin: 0 };
const dt = { color: color.muted };
const dd = { margin: 0, minWidth: 0, overflowWrap: 'anywhere' };

export default function CostDetail({ line, projectCode, busy, onClose, onBilling, onEdit }) {
  const [files, setFiles] = useState(null);       // null loading · [] none · { error }
  const [invoices, setInvoices] = useState(null);
  const mode = billingMode(line);
  const [pick, setPick] = useState(line.invoiceRef || '');

  // Escape closes, as any sheet should
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!line.receipted) return;
    let live = true;
    fetch(`/api/costs/receipt?expense=${encodeURIComponent(line.id)}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load the receipt'); return d.files; })
      .then(f => { if (live) setFiles(f); })
      .catch(err => { if (live) setFiles({ error: err instanceof TypeError ? 'Offline — the receipt cannot be loaded' : err.message }); });
    return () => { live = false; };
  }, [line.id, line.receipted]);

  // The project's Xero invoices, for "billed direct" — loaded only when that is chosen
  function loadInvoices() {
    if (invoices) return;
    setInvoices({ loading: true });
    fetch(`/api/invoices?project=${encodeURIComponent(projectCode)}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load invoices'); return d; })
      .then(d => setInvoices({ list: (d.matched || []).filter(x => x.kind === 'invoice' && !x.draft) }))
      .catch(err => setInvoices({ error: err.message }));
  }
  useEffect(() => { if (mode === 'direct') loadInvoices(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const fileUrl = f => `/api/costs/receipt?expense=${encodeURIComponent(line.id)}&file=${encodeURIComponent(f.id)}`;
  const [direct, setDirect] = useState(mode === 'direct');

  return (
    <div role="dialog" aria-modal="true" aria-label="Cost details" onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(16,24,40,0.45)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        ...card, width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto',
        borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: space.lg,
        display: 'flex', flexDirection: 'column', gap: space.md,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: space.md }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: font.size.md, fontWeight: 700, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
            {line.description || line.categoryName || line.id}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...button.secondary, minHeight: 40, padding: '0 12px' }}>Close</button>
        </div>

        <dl style={fact}>
          <dt style={dt}>Amount</dt><dd style={{ ...dd, fontWeight: 700 }}>{formatRowAmount(line.amount)}</dd>
          <dt style={dt}>Date</dt><dd style={dd}>{formatIsoDate(line.date) || '—'}</dd>
          <dt style={dt}>Category</dt><dd style={dd}>{line.categoryName || line.categoryCode || '—'}</dd>
          {line.payeeName && <><dt style={dt}>Paid to / by</dt><dd style={dd}>{line.payeeName}</dd></>}
          <dt style={dt}>Source</dt><dd style={dd}>{line.receipted ? `Expense app · ${line.id}` : `Typed in here · ${line.id}`}</dd>
          {line.receipted && <><dt style={dt}>Status</dt><dd style={dd}>{line.status === 'pending' ? <Tag variant="notInvoiced">Pending review</Tag> : (line.status || '—')}</dd></>}
        </dl>

        {line.receipted && (
          <section aria-label="Receipt" style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
            <span style={{ fontSize: font.size.sm, fontWeight: 600 }}>Receipt</span>
            {files === null && <span style={{ fontSize: font.size.xs, color: color.muted }}>Loading from Xero…</span>}
            {files?.error && <span style={{ fontSize: font.size.xs, color: color.danger }}>{files.error}</span>}
            {Array.isArray(files) && files.length === 0 && <span style={{ fontSize: font.size.xs, color: color.muted }}>No receipt is attached to this expense in Xero.</span>}
            {Array.isArray(files) && files.map(f => f.mime.startsWith('image/') ? (
              <a key={f.id} href={fileUrl(f)} target="_blank" rel="noopener noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(f)} alt={`Receipt: ${f.name}`} style={{ width: '100%', borderRadius: radius.md, border: `1px solid ${color.border}`, background: '#F3F5F6' }} />
              </a>
            ) : (
              <a key={f.id} href={fileUrl(f)} target="_blank" rel="noopener noreferrer" style={{ ...button.secondary, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                Open {f.name}
              </a>
            ))}
          </section>
        )}

        <section aria-label="Billing" style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
          <span style={{ fontSize: font.size.sm, fontWeight: 600 }}>Billing</span>
          <Choice checked={mode === 'none' && !direct} disabled={busy} onChange={() => { setDirect(false); setPick(''); onBilling(false, ''); }}>Not billed yet</Choice>
          <Choice checked={mode === 'project' && !direct} disabled={busy} onChange={() => { setDirect(false); setPick(''); onBilling(true, ''); }}>Billed in project invoice</Choice>
          <Choice checked={direct} disabled={busy} onChange={() => { setDirect(true); loadInvoices(); }}>Billed direct to client (its own invoice)</Choice>
          {direct && (
            <div style={{ paddingLeft: 30, display: 'flex', flexDirection: 'column', gap: space.xs }}>
              {invoices?.loading && <span style={{ fontSize: font.size.xs, color: color.muted }}>Loading this project&rsquo;s Xero invoices…</span>}
              {invoices?.error && <span style={{ fontSize: font.size.xs, color: color.danger }}>{invoices.error}</span>}
              {invoices?.list && (invoices.list.length === 0
                ? <span style={{ fontSize: font.size.xs, color: color.muted }}>No approved invoice on this project yet. Create it in Xero first, with this project&rsquo;s address as Reference.</span>
                : (
                  <select value={pick} disabled={busy} aria-label="Xero invoice"
                    onChange={e => { setPick(e.target.value); if (e.target.value) onBilling(true, e.target.value); }}
                    style={{ height: 44, fontSize: 16, borderRadius: radius.sm, border: `1px solid ${color.border}`, padding: '0 30px 0 10px', maxWidth: '100%', appearance: 'none', WebkitAppearance: 'none', background: `${color.surface} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23667085' stroke-width='1.6'/%3E%3C/svg%3E") no-repeat right 10px center` }}>
                    <option value="">Choose the invoice…</option>
                    {invoices.list.map(i => (
                      <option key={i.id} value={i.number}>{i.number} · {formatIsoDate(i.date)} · ${Number(i.total).toFixed(2)}</option>
                    ))}
                    {pick && !invoices.list.some(i => i.number === pick) && <option value={pick}>{pick}</option>}
                  </select>
                ))}
            </div>
          )}
        </section>

        {line.editable && onEdit && (
          <button type="button" onClick={onEdit} style={{ ...button.secondary, minHeight: 44 }}>Edit this cost</button>
        )}
      </div>
    </div>
  );
}

function Choice({ checked, disabled, onChange, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, minHeight: 40, fontSize: font.size.sm, cursor: disabled ? 'wait' : 'pointer' }}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} style={{ width: 20, height: 20, flexShrink: 0 }} />
      {children}
    </label>
  );
}
