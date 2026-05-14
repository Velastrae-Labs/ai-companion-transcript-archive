import { buildRow } from './utils';

export async function parse(rawText: string, filename: string): Promise<any[]> {
  // Prefer date in transcript header: '# Date: YYYY-MM-DD'
  let dateHint: string | null = null;
  const headerDate = rawText.match(/^#\s*Date:\s*(\d{4}-\d{2}-\d{2})/m);
  if (headerDate) dateHint = headerDate[1];
  if (!dateHint && filename) {
    const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) dateHint = m[1];
  }
  if (!dateHint) dateHint = '1970-01-01';

  // Extract optional title from '# Title' or first header line
  const titleMatch = rawText.match(/^#\s*(?!Date:)(.+)$/m);
  const convoTitle = titleMatch ? titleMatch[1].trim() : null;

  // Split into turn blocks using the '--- Turn N ---' separators
  const blocks = rawText.split(/---\s*Turn\s*\d+\s*---/i).map(b => b.trim()).filter(Boolean);
  const rows: any[] = [];
  let seq = 0;

  for (const block of blocks) {
    // For each block, collect HUMAN, THINKING (can be multiple), ASSISTANT (can be multiple)
    const lines = block.split(/\r?\n/);
    let humanText: string | null = null;
    const thinkingParts: string[] = [];
    const assistantParts: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trimEnd();
      if (!line) { i += 1; continue; }

      if (line.startsWith('HUMAN:')) {
        humanText = line.replace(/^HUMAN:\s*/i, '').trim();
        i += 1;
        continue;
      }

      if (line.startsWith('THINKING:')) {
        // Collect indented lines following THINKING:
        let buf = '';
        // If the thinking label has content on same line
        const after = line.replace(/^THINKING:\s*/i, '');
        if (after) buf += after + '\n';
        i += 1;
        while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() !== '' && !lines[i].match(/^(HUMAN:|ASSISTANT:)/i))) {
          buf += lines[i].replace(/^\s+/, '') + '\n';
          i += 1;
        }
        thinkingParts.push(buf.trim());
        continue;
      }

      if (line.startsWith('ASSISTANT:')) {
        const part = line.replace(/^ASSISTANT:\s*/i, '').trim();
        assistantParts.push(part);
        i += 1;
        continue;
      }

      // Unlabeled line — treat as continuation of last section (assistant preferred)
      if (assistantParts.length) {
        assistantParts[assistantParts.length - 1] += '\n' + line.trim();
      } else if (thinkingParts.length) {
        thinkingParts[thinkingParts.length - 1] += '\n' + line.trim();
      } else if (!humanText) {
        humanText = line.trim();
      } else {
        assistantParts.push(line.trim());
      }
      i += 1;
    }

    // Build rows: human first, then thinking parts as assistant with metadata, then assistant parts
    const makeTs = () => {
      const hh = Math.floor(seq / 3600) % 24;
      const mm = Math.floor((seq % 3600) / 60);
      const ss = seq % 60;
      seq += 1;
      return `${dateHint}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}Z`;
    };

    if (humanText) {
      rows.push(await buildRow('vscode', makeTs(), 'human', humanText, null, convoTitle, { source: 'cleaned_vscode' }));
    }

    for (const t of thinkingParts) {
      rows.push(await buildRow('vscode', makeTs(), 'assistant', t, null, convoTitle, { source: 'cleaned_vscode', thinking: true }));
    }

    for (const a of assistantParts) {
      rows.push(await buildRow('vscode', makeTs(), 'assistant', a, null, convoTitle, { source: 'cleaned_vscode' }));
    }
  }

  return rows;
}
