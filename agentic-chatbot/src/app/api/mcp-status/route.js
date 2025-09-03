import { NextResponse } from 'next/server';
import { loadAllMCPTools } from '../../../lib/mcp.js';

export const runtime = 'nodejs';

export async function GET() {
  let resources = null;
  try {
    const { tools, closeAll } = await loadAllMCPTools();
    resources = { closeAll };

    const providers = {};
    for (const full of Object.keys(tools)) {
      const [provider, tool] = full.split('.');
      if (!providers[provider]) providers[provider] = [];
      providers[provider].push(tool);
    }

    return NextResponse.json({
      ok: true,
      providers,
      totalTools: Object.keys(tools).length,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally {
    if (resources?.closeAll) {
      try { await resources.closeAll(); } catch {}
    }
  }
}
