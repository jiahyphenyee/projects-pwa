// The full cost picture for one project: costs this app owns, plus a read-only view of
// receipted expenses from the Expenses tab, plus the totals derived from both.
// Returned together so the detail screen needs a single round trip.
//
// Both kinds carry `invoiced` / `invoicedDate`, but from different places — a project
// cost holds its own in `Project costs` J:K, while a receipted expense's is joined in
// from the `Receipted expense invoicing` tab, because `Receipted expenses` itself is
// read-only to this app. Normalised here so the client never has to know the difference.

import { listCosts, createCost, updateCost, deleteCost, setInvoiced, setInvoicedForProject } from '@/lib/costs';
import { listReceiptedExpenses } from '@/lib/expenses';
import { readInvoicingMap, setExpenseInvoiced, setExpenseInvoicedForProject } from '@/lib/receiptedInvoicing';
import { summariseProject } from '@/lib/rollups';

const EXPENSE_ID = /^EXP-/;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectCode = searchParams.get('project') || '';
    if (!projectCode) {
      return Response.json({ error: 'project is required' }, { status: 400 });
    }

    const [costs, expenses, invoicing] = await Promise.all([
      listCosts(projectCode),
      listReceiptedExpenses(projectCode),
      readInvoicingMap(),
    ]);

    // An expense with no row in the invoicing tab has simply never been ticked
    const receipted = expenses.map(e => {
      const entry = invoicing.get(e.id);
      return { ...e, invoiced: entry?.invoiced === true, invoicedDate: entry?.invoicedDate || '' };
    });

    // Newest first. Dates are ISO here, so string comparison is chronological;
    // ties break by cost_id, which is insertion order.
    costs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));

    return Response.json({ costs, receipted, totals: summariseProject(costs, receipted) });

  } catch (err) {
    console.error('Costs read error:', err.message);
    return Response.json({ error: 'Could not load costs' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body   = await req.json();
    const result = await createCost(body);

    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);

  } catch (err) {
    console.error('Cost create error:', err.message);
    return Response.json({ error: 'Could not save the cost' }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const { id, invoiced, projectCode, all } = await req.json();
    const wants = invoiced === true;

    // ── Bulk: every line on the project, of both kinds ────────────────────────
    if (all) {
      const expenses = await listReceiptedExpenses(projectCode);

      // Two different tabs, so these cannot contend with each other. Rows already in the
      // target state are skipped by both, so re-running restamps nothing.
      const [own, receipted] = await Promise.all([
        setInvoicedForProject(projectCode, wants),
        setExpenseInvoicedForProject(expenses.map(e => e.id), wants),
      ]);

      const failed = [own, receipted].find(r => !r.ok);
      if (failed) {
        const { status, ...rest } = failed;
        return Response.json(rest, { status: status || 400 });
      }
      return Response.json({ ok: true, changed: own.changed + receipted.changed });
    }

    // ── Single: the id says which tab holds the state ─────────────────────────
    const lineId = String(id || '').trim();
    const result = EXPENSE_ID.test(lineId)
      ? await setExpenseInvoiced(lineId, wants)
      : await setInvoiced(lineId, wants);

    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }

    // One shape for both, so the client patches its list without branching. `entry` comes
    // back from the invoicing tab, `cost` from the re-read Project costs row.
    const saved = result.entry || result.cost;
    return Response.json({
      ok: true,
      line: {
        id:           saved.id,
        receipted:    EXPENSE_ID.test(lineId),
        invoiced:     saved.invoiced === true,
        invoicedDate: saved.invoicedDate || '',
      },
    });

  } catch (err) {
    console.error('Cost update error:', err.message);
    return Response.json({ error: 'Could not update the cost' }, { status: 500 });
  }
}

// The two lists are merged on screen, so this is the boundary that keeps a receipted
// expense read-only. The UI also withholds the edit affordance, but that is a courtesy —
// this is the enforcement. Editing one here would desync the row from its Xero bill.
const RECEIPTED_READ_ONLY =
  'Receipted expenses are managed in the expense app and cannot be changed here.';

export async function PUT(req) {
  try {
    const { id, ...fields } = await req.json();
    if (EXPENSE_ID.test(String(id || '').trim())) {
      return Response.json({ error: RECEIPTED_READ_ONLY }, { status: 403 });
    }
    const result = await updateCost(id, fields);

    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);

  } catch (err) {
    console.error('Cost edit error:', err.message);
    return Response.json({ error: 'Could not save the changes' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (EXPENSE_ID.test(String(id || '').trim())) {
      return Response.json({ error: RECEIPTED_READ_ONLY }, { status: 403 });
    }
    const result = await deleteCost(id);

    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);

  } catch (err) {
    console.error('Cost delete error:', err.message);
    return Response.json({ error: 'Could not delete the cost' }, { status: 500 });
  }
}
