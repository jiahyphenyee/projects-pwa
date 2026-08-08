import { listCosts, createCost } from '@/lib/costs';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectCode = searchParams.get('project') || '';
    if (!projectCode) {
      return Response.json({ error: 'project is required' }, { status: 400 });
    }

    const costs = await listCosts(projectCode);
    // Newest first. Dates are ISO here, so string comparison is chronological;
    // ties break by cost_id, which is insertion order.
    costs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));

    return Response.json({ costs });

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
