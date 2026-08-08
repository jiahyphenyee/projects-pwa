// The full cost picture for one project: costs this app owns, plus a read-only view of
// receipted expenses from the Expenses tab, plus the totals derived from both.
// Returned together so the detail screen needs a single round trip.

import { listCosts, createCost, setInvoiced } from '@/lib/costs';
import { listReceiptedExpenses } from '@/lib/expenses';
import { summariseProject } from '@/lib/rollups';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectCode = searchParams.get('project') || '';
    if (!projectCode) {
      return Response.json({ error: 'project is required' }, { status: 400 });
    }

    const [costs, receipted] = await Promise.all([
      listCosts(projectCode),
      listReceiptedExpenses(projectCode),
    ]);

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
    const { id, invoiced } = await req.json();
    const result = await setInvoiced(id, invoiced === true);

    if (!result.ok) {
      const { status, ...rest } = result;
      return Response.json(rest, { status: status || 400 });
    }
    return Response.json(result);

  } catch (err) {
    console.error('Cost update error:', err.message);
    return Response.json({ error: 'Could not update the cost' }, { status: 500 });
  }
}
