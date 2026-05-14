import { buildRow } from './utils';

export async function parse(data: any): Promise<any[]> {
  const conversations = Array.isArray(data) ? data : [data];
  const rows: any[] = [];

  for (const convo of conversations) {
    const convoId = convo.id || convo.conversation_id || null;
    const convoTitle = convo.title || '';
    const mapping = convo.mapping || {};

    const nodes = Object.values(mapping as any).filter((v: any) => v && v.message);
    nodes.sort((a: any, b: any) => (a.message?.create_time || 0) - (b.message?.create_time || 0));

    for (const node of nodes as any[]) {
      const msg = (node as any).message;
      const authorRole = msg?.author?.role || '';
      if (authorRole === 'system') continue;
      const role = authorRole === 'user' ? 'human' : authorRole === 'assistant' ? 'assistant' : null;
      if (!role) continue;
      const parts = msg?.content?.parts || [];
      const content = parts.filter((p: any) => p && typeof p === 'string').join('\n');
      if (!content.trim() || !msg.create_time) continue;

      rows.push(await buildRow('chatgpt', msg.create_time, role, content, convoId, convoTitle, { model: msg?.metadata?.model_slug }));
    }
  }

  return rows;
}
