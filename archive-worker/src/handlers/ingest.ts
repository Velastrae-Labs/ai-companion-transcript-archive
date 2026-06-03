import { parse as parseChatGPT } from '../parsers/chatgpt';
import { parse as parseClaude } from '../parsers/claude';
import { parse as parseVSCode } from '../parsers/vscode';
import { parse as parseGemini } from '../parsers/gemini';
import { parse as parseGrok } from '../parsers/grok';
import { parse as parseMistral } from '../parsers/mistral';
import { parse as parseOpenClaw } from '../parsers/openclaw';
import { parse as parseContinuity } from '../parsers/continuity';

export async function ingestMessages(db: any, args: any) {
  const { platform, filename, content_base64 } = args || {};
  if (!platform || !filename || !content_base64) return { error: 'missing args' };

  const content = atob(content_base64);

  let rows: any[] = [];
  switch (platform) {
    case 'chatgpt':
      try { rows = await parseChatGPT(JSON.parse(content)); } catch (e) { return { error: String(e) }; }
      break;
    case 'claude':
      try { rows = await parseClaude(JSON.parse(content)); } catch (e) { return { error: String(e) }; }
      break;
    case 'vscode':
      try { rows = await parseVSCode(content, filename); } catch (e) { return { error: String(e) }; }
      break;
    case 'gemini':
      try { rows = await parseGemini(content); } catch (e) { return { error: String(e) }; }
      break;
    case 'grok':
      try { rows = await parseGrok(content); } catch (e) { return { error: String(e) }; }
      break;
    case 'mistral':
      try { rows = await parseMistral(content); } catch (e) { return { error: String(e) }; }
      break;
    case 'openclaw':
      try { rows = await parseOpenClaw(content, filename); } catch (e) { return { error: String(e) }; }
      break;
    case 'continuity':
      try { rows = await parseContinuity(content); } catch (e) { return { error: String(e) }; }
      break;
    default:
      return { error: `No parser for platform: ${platform}` };
  }

  if (!rows.length) return { inserted: 0, skipped: 0, message: 'No messages parsed from file' };

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
      batch.map((r: any) => stmt.bind(r.id, r.timestamp, r.date, r.llm_platform, r.companion_id, r.role, r.sender, r.content, r.conversation_id, r.conversation_title, r.metadata))
    );
    inserted += results.filter((r: any) => r?.meta?.changes > 0).length;
    skipped += results.filter((r: any) => r?.meta?.changes === 0).length;
  }

  return { inserted, skipped, total_parsed: rows.length, platform, filename };
}
