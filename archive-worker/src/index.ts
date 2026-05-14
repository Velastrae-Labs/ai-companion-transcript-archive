import { searchMessages } from './handlers/search';
import { getStats } from './handlers/stats';
import { ingestMessages } from './handlers/ingest';
import { handleMessage } from './handlers/message';
import { handleMCP } from './mcp';

export interface Env {
  ARCHIVE_DB: D1Database;
  MCP_SECRET?: string;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (path === '/mcp' || path.startsWith('/mcp/')) {
      return handleMCP(request, env, corsHeaders, path);
    }

    if (path.startsWith('/api/archive/search')) {
      const q: Record<string, any> = {};
      url.searchParams.forEach((value, key) => { q[key] = value; });
      const result = await searchMessages(env.ARCHIVE_DB, q);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (path.startsWith('/api/archive/stats')) {
      const result = await getStats(env.ARCHIVE_DB);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (path === '/api/archive/ingest' && request.method === 'POST') {
      const body = await request.json() as any;
      const result = await ingestMessages(env.ARCHIVE_DB, body);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (path.startsWith('/api/archive/message/')) {
      const id = path.split('/').pop()!;
      return handleMessage(request, env, corsHeaders, id);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  },
};
