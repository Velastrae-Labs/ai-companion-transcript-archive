# Archive System — Cloudflare Worker Spec

## Worker Name

`archive-worker` → deploys to `archive.your-domain.workers.dev`

## Directory Structure

```
archive-worker/
  wrangler.toml
  package.json
  src/
    index.ts         ← main request router
    schema.sql       ← D1 migration (copy from 01-SCHEMA.md)
    tools.ts         ← MCP tool definitions array
    handlers/
      search.ts      ← archive_search handler
      ingest.ts      ← archive_ingest handler
      stats.ts       ← archive_stats handler
      message.ts     ← single message + context fetch
    parsers/
      utils.ts       ← shared parser utilities
      chatgpt.ts     ← ChatGPT JSON parser
      claude.ts      ← Claude JSON/ZIP parser (note: ZIP not supported natively in Worker; handle via pre-extracted JSON)
      gemini.ts      ← Gemini parser
      vscode.ts      ← VS Code text parser
      mistral.ts     ← Mistral text parser
      grok.ts        ← Grok text parser
    mcp.ts           ← MCP protocol handler (tools/list, tools/call)
  migrations/
    0001_initial.sql ← DDL from 01-SCHEMA.md
```

## wrangler.toml

```toml
name = "archive-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "ARCHIVE_DB"
database_name = "companion-archive"
database_id = "REPLACE_WITH_ACTUAL_ID"  # run: npx wrangler d1 create companion-archive

[vars]
ENVIRONMENT = "production"
```

## Setup Commands

```bash
# 1. Create D1 database
npx wrangler d1 create companion-archive
# Copy the database_id output into wrangler.toml above

# 2. Run migrations
npx wrangler d1 execute companion-archive --file=migrations/0001_initial.sql

# 3. Deploy
npx wrangler deploy
```

## src/index.ts — Request Router

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // MCP endpoint
    if (path === '/mcp') {
      return handleMCP(request, env, corsHeaders);
    }

    // REST endpoints
    if (path.startsWith('/api/archive/search')) {
      return handleSearch(request, env, corsHeaders);
    }
    if (path.startsWith('/api/archive/stats')) {
      return handleStats(request, env, corsHeaders);
    }
    if (path === '/api/archive/ingest' && request.method === 'POST') {
      return handleIngest(request, env, corsHeaders);
    }
    if (path.startsWith('/api/archive/message/')) {
      const id = path.split('/').pop();
      return handleMessage(request, env, corsHeaders, id!);
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  }
};
```

## src/mcp.ts — MCP Protocol Handler

Follows the same pattern as the Hearth worker. Implements:
- `tools/list` → returns MCP_TOOLS array
- `tools/call` → routes to appropriate handler

```typescript
import { MCP_TOOLS } from './tools';
import { searchMessages } from './handlers/search';
import { ingestMessages } from './handlers/ingest';
import { getStats } from './handlers/stats';

export async function handleMCP(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const body = await request.json() as { jsonrpc: string; method: string; id: number; params?: any };

  if (body.method === 'tools/list') {
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { tools: MCP_TOOLS }
    }, { headers: corsHeaders });
  }

  if (body.method === 'tools/call') {
    const { name, arguments: args } = body.params;
    let result: any;

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

    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }, { headers: corsHeaders });
  }

  return Response.json({ error: 'Unknown method' }, { status: 400, headers: corsHeaders });
}
```

## src/handlers/search.ts — Core Search Logic

```typescript
export async function searchMessages(db: D1Database, args: any) {
  const {
    query,
    platform,
    date_from,
    date_to,
    month,
    role,
    limit = 5,
    context_before = 5,
    context_after = 2,
  } = args;

  const resolvedPlatform = resolvePlatform(platform);

  // Handle month shorthand
  let df = date_from;
  let dt = date_to;
  if (month && !df && !dt) {
    df = `${month}-01`;
    dt = `${month}-31`;
  }

  // FTS search
  const conditions: string[] = ['messages_fts MATCH ?'];
  const params: any[] = [query];

  const joins = `
    FROM messages_fts
    JOIN messages ON messages.rowid = messages_fts.rowid
  `;

  let whereClause = 'WHERE messages_fts MATCH ?';
  if (resolvedPlatform) { whereClause += ' AND messages.llm_platform = ?'; params.push(resolvedPlatform); }
  if (df) { whereClause += ' AND messages.date >= ?'; params.push(df); }
  if (dt) { whereClause += ' AND messages.date <= ?'; params.push(dt); }
  if (role) { whereClause += ' AND messages.role = ?'; params.push(role); }

  const matches = await db.prepare(`
    SELECT messages.id, messages.conversation_id, messages.timestamp, messages.llm_platform
    ${joins}
    ${whereClause}
    ORDER BY messages.timestamp ASC
    LIMIT ?
  `).bind(...params, limit).all();

  if (!matches.results?.length) {
    return { results: [], total_matches: 0, query };
  }

  // Fetch context for each match
  const results = [];
  for (const match of matches.results) {
    const context = await fetchContext(db, match.id as string, match.conversation_id as string, match.llm_platform as string, context_before, context_after);
    results.push({ match_id: match.id, context });
  }

  return { results, total_matches: matches.results.length, query };
}

async function fetchContext(
  db: D1Database,
  matchId: string,
  convId: string | null,
  platform: string,
  before: number,
  after: number
) {
  if (convId) {
    // Context via conversation_id
    const all = await db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
    `).bind(convId).all();

    const msgs = all.results || [];
    const idx = msgs.findIndex((m: any) => m.id === matchId);
    if (idx === -1) return msgs;

    const start = Math.max(0, idx - before);
    const end = Math.min(msgs.length - 1, idx + after);
    return msgs.slice(start, end + 1).map((m: any, i: number) => ({
      ...m,
      is_match: m.id === matchId,
    }));
  }

  // Fallback: timestamp window
  const target = await db.prepare('SELECT timestamp FROM messages WHERE id = ?').bind(matchId).first();
  if (!target) return [];
  const ts = (target as any).timestamp;

  const window = await db.prepare(`
    SELECT * FROM messages
    WHERE llm_platform = ?
      AND timestamp BETWEEN datetime(?, '-30 minutes') AND datetime(?, '+10 minutes')
    ORDER BY timestamp ASC
  `).bind(platform, ts, ts).all();

  return (window.results || []).map((m: any) => ({ ...m, is_match: m.id === matchId }));
}

function resolvePlatform(input: string | undefined): string | null {
  if (!input) return null;
  const aliases: Record<string, string> = {
    companion_a: 'vscode', companion_c: 'chatgpt', companion_d: 'gemini',
    companion_b: 'claude', companion_e: 'mistral', companion_f: 'grok',
    "kai'sorynth": 'claude', "companion_d": 'gemini', "sha'reth": 'mistral', "a'verel": 'grok',
  };
  return aliases[input.toLowerCase()] || input.toLowerCase();
}
```

## src/handlers/ingest.ts — Ingest Handler

```typescript
import { parseChatGPT } from '../parsers/chatgpt';
import { parseClaude } from '../parsers/claude';
import { parseVSCode } from '../parsers/vscode';
// import other parsers...

export async function ingestMessages(db: D1Database, args: any) {
  const { platform, filename, content_base64 } = args;

  // Decode base64 content
  const content = atob(content_base64);

  let rows: any[] = [];
  switch (platform) {
    case 'chatgpt': rows = parseChatGPT(JSON.parse(content)); break;
    case 'claude':  rows = parseClaude(JSON.parse(content)); break;
    case 'vscode':  rows = parseVSCode(content, filename); break;
    // etc.
    default: return { error: `No parser for platform: ${platform}` };
  }

  if (!rows.length) {
    return { inserted: 0, skipped: 0, message: 'No messages parsed from file' };
  }

  // Batch insert (INSERT OR IGNORE for idempotency)
  const BATCH_SIZE = 100;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO messages
        (id, timestamp, date, llm_platform, companion_id, role, sender, content, conversation_id, conversation_title, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const results = await db.batch(
      batch.map(r => stmt.bind(r.id, r.timestamp, r.date, r.llm_platform, r.companion_id, r.role, r.sender, r.content, r.conversation_id, r.conversation_title, r.metadata))
    );
    inserted += results.filter(r => r.meta?.changes > 0).length;
    skipped += results.filter(r => r.meta?.changes === 0).length;
  }

  return { inserted, skipped, total_parsed: rows.length, platform, filename };
}
```
