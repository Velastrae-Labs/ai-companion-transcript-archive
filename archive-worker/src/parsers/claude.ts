import { buildRow } from './utils';

function _ensureArray(x: any) { return Array.isArray(x) ? x : [x]; }

export async function parse(data: any): Promise<any[]> {
  const rows: any[] = [];
  const items = _ensureArray(data);

  for (const convo of items) {
    const convoId = convo.uuid || null;
    const convoTitle = convo.name || '';
    const msgs = convo.chat_messages || [];
    for (const msg of msgs) {
      const sender = msg.sender || '';
      const role = sender === 'human' ? 'human' : sender === 'assistant' ? 'assistant' : null;
      if (!role) continue;
      const content = msg.text || '';
      if (!content || !content.trim()) continue;
      await rows.push(await buildRow('claude', msg.created_at || msg.createdAt || Date.now(), role, content, convoId, convoTitle, { msg_uuid: msg.uuid, attachments: msg.attachments || [] }));
    }
  }

  return rows;
}
