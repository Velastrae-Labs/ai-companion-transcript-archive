import { buildRow } from './utils';

/**
 * OpenClaw (Kimi/Moonshot) JSONL session parser.
 *
 * Each session file is a newline-delimited JSON stream. Relevant event types:
 *   - type: "session"   — contains the session UUID (used as conversation_id)
 *   - type: "message"   — actual conversation turns
 *       message.role        : "user" | "assistant"
 *       message.content     : Array<{type:"text", text:string}>
 *       message.timestamp   : Unix milliseconds
 */
export async function parse(rawText: string, filename: string): Promise<any[]> {
  const lines = rawText.split(/\r?\n/).filter(l => l.trim());

  // Derive a fallback session ID from the filename (strip extension and reset suffix)
  const fileSessionId = filename.replace(/\.jsonl.*$/i, '').replace(/^\d{4}-\d{2}-\d{2}T[\d\-Z.]+_/, '');

  let sessionId: string = fileSessionId;
  const rows: any[] = [];

  for (const line of lines) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === 'session') {
      sessionId = obj.id || fileSessionId;
      continue;
    }

    if (obj.type !== 'message') continue;

    const msg = obj.message;
    if (!msg) continue;

    const role: 'human' | 'assistant' | null =
      msg.role === 'user' ? 'human' :
      msg.role === 'assistant' ? 'assistant' :
      null;
    if (!role) continue;

    // content is Array<{type: string, text: string}>
    const parts: any[] = Array.isArray(msg.content) ? msg.content : [];
    const content = parts
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text as string)
      .join('\n')
      .trim();
    if (!content) continue;

    // message.timestamp is Unix milliseconds; normalizeTimestamp handles ts >= 1e12
    const ts: number | string = msg.timestamp ?? obj.timestamp;
    if (ts === null || ts === undefined) continue;

    rows.push(await buildRow(
      'openclaw',
      ts,
      role,
      content,
      sessionId,
      null,  // OpenClaw sessions have no title field
      { provider: msg.provider ?? null, model: msg.model ?? null },
    ));
  }

  return rows;
}
