import { buildRow } from './utils';

export async function parse(mdTextOrArray: any, filename?: string): Promise<any[]> {
  const text = typeof mdTextOrArray === 'string' ? mdTextOrArray : String(mdTextOrArray);
  
  // Try to extract date from:
  // 1. Filename (e.g., "2024-01-15_conversation.md")
  // 2. Exported metadata line (e.g., "**Exported:** 3/12/2026 16:06:42")
  let dateHint = '1970-01-01';
  const filenameDateMatch = filename && filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (filenameDateMatch) {
    dateHint = filenameDateMatch[1];
  } else {
    // Try to find **Exported:** line in content
    const exportMatch = text.match(/\*\*Exported:\*\*\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (exportMatch) {
      const [, month, day, year] = exportMatch;
      dateHint = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  const lines = text.split(/\r?\n/);
  const rows: any[] = [];
  let buffer = '';
  let currentSpeaker: 'human' | 'assistant' | null = null;
  let seq = 0;

  function flush() {
    if (!currentSpeaker || !buffer.trim()) return;
    const role = currentSpeaker;
    const fakeTs = `${dateHint}T00:00:${String(seq % 60).padStart(2,'0')}Z`;
    rows.push({ promise: buildRow('gemini', fakeTs, role, buffer.trim(), null, null, { source: 'markdown' }) });
    seq += 1;
    buffer = '';
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    
    // Skip metadata lines
    if (line.startsWith('**Exported:**') || line.startsWith('**Link:**') || line.match(/^#\s+[^#]/)) {
      continue;
    }
    
    // Format 1: **User:** / **You:** / **Gemini:** / **Model:**
    const mUser = line.match(/^\*\*User:\*\*\s*(.*)$/i);
    const mYou = line.match(/^\*\*You:\*\*\s*(.*)$/i);
    const mGem = line.match(/^\*\*Gemini:\*\*\s*(.*)$/i);
    const mModel = line.match(/^\*\*Model:\*\*\s*(.*)$/i);
    
    // Format 2: ## Prompt: / ## Response:
    const mPrompt = line.match(/^##\s*Prompt:\s*$/i);
    const mResponse = line.match(/^##\s*Response:\s*$/i);
    
    if (mUser || mYou || mPrompt) {
      flush();
      currentSpeaker = 'human';
      buffer = (mUser ? mUser[1] : mYou ? mYou![1] : '') || '';
      continue;
    }
    if (mGem || mModel || mResponse) {
      flush();
      currentSpeaker = 'assistant';
      buffer = (mGem ? mGem[1] : mModel ? mModel![1] : '') || '';
      continue;
    }
    // continuation line
    buffer += '\n' + line;
  }
  flush();

  // resolve promises via await
  const built: any[] = [];
  for (const item of rows) {
    if (item.promise) built.push(await (item.promise as Promise<any>));
  }
  return built;
}
