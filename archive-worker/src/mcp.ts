import { MCP_TOOLS } from './tools';
import { searchMessages } from './handlers/search';
import { getStats } from './handlers/stats';
import { ingestMessages } from './handlers/ingest';

export async function handleMCP(request: Request, env: any, corsHeaders: Record<string, string>, path: string = '/mcp') {
  if (env.MCP_SECRET) {
    const pathSecret = path.startsWith('/mcp/') ? path.slice(5) : '';
    if (pathSecret !== env.MCP_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  if (request.method === 'GET') {
    return new Response(JSON.stringify({ tools: MCP_TOOLS }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  const body: any = await request.json();

  if (body.method === 'initialize') {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: body.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'archive-worker', version: '1.0.0' },
      },
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  if (body.method === 'notifications/initialized') {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  if (body.method === 'tools/list') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: MCP_TOOLS } }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (body.method === 'tools/call') {
    const { name, arguments: args } = body.params;
    let result: any;
    try {
      switch (name) {
        case 'archive_search':
          result = await searchMessages(env.ARCHIVE_DB, args);
          break;
        case 'archive_stats':
          result = await getStats(env.ARCHIVE_DB);
          break;
        case 'archive_ingest':
          result = await ingestMessages(env.ARCHIVE_DB, args);
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }
    } catch (err: any) {
      result = { error: err?.message || String(err) };
    }

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  return new Response(JSON.stringify({ error: 'Unknown method' }), { status: 400, headers: corsHeaders });
}
