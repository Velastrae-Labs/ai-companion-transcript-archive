export async function searchMessages(db: any, args: any) {
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
  } = args || {};

  const resolvedPlatform = resolvePlatform(platform);

  let df = date_from;
  let dt = date_to;
  if (month && !df && !dt) {
    df = `${month}-01`;
    dt = `${month}-31`;
  }

  const params: any[] = [query];
  let whereClause = 'WHERE messages_fts MATCH ?';
  if (resolvedPlatform) { whereClause += ' AND messages.llm_platform = ?'; params.push(resolvedPlatform); }
  if (df) { whereClause += ' AND messages.date >= ?'; params.push(df); }
  if (dt) { whereClause += ' AND messages.date <= ?'; params.push(dt); }
  if (role) { whereClause += ' AND messages.role = ?'; params.push(role); }

  const sql = `
    SELECT messages.id, messages.conversation_id, messages.timestamp, messages.llm_platform
    FROM messages_fts
    JOIN messages ON messages.rowid = messages_fts.rowid
    ${whereClause}
    ORDER BY messages.timestamp ASC
    LIMIT ?
  `;

  params.push(limit);
  const matches = await db.prepare(sql).bind(...params).all();

  if (!matches.results?.length) {
    return { results: [], total_matches: 0, query };
  }

  const results: any[] = [];
  for (const match of matches.results) {
    const context = await fetchContext(db, match.id as string, match.conversation_id as string, match.llm_platform as string, context_before, context_after);
    results.push({ match_id: match.id, context });
  }

  return { results, total_matches: matches.results.length, query };
}

async function fetchContext(db: any, matchId: string, convId: string | null, platform: string, before: number, after: number) {
  if (convId) {
    const all = await db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC`).bind(convId).all();
    const msgs = all.results || [];
    const idx = msgs.findIndex((m: any) => m.id === matchId);
    if (idx === -1) return msgs;
    const start = Math.max(0, idx - before);
    const end = Math.min(msgs.length - 1, idx + after);
    return msgs.slice(start, end + 1).map((m: any) => ({ ...m, is_match: m.id === matchId }));
  }

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
    "kai'sorynth": 'claude', "sha'reth": 'mistral', "a'verel": 'grok',
  };
  return aliases[(input as string).toLowerCase()] || (input as string).toLowerCase();
}

export { fetchContext };
