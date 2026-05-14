import { buildRow } from './utils';

// Grok data export format: prod-grok-backend.json
// Structure: { conversations: [{ conversation: {id, title, ...}, responses: [{response: {_id, message, sender, create_time, model}}] }] }

export async function parse(text: string): Promise<any[]> {
  const data = JSON.parse(text) as {
    conversations: Array<{
      conversation: { id: string; title?: string };
      responses: Array<{
        response: {
          _id: string;
          conversation_id: string;
          message: string;
          sender: string;
          // BSON extended JSON format
          create_time: { $date: { $numberLong: string } };
          model?: string;
        };
      }>;
    }>;
  };

  const rows: any[] = [];

  for (const convo of data.conversations ?? []) {
    const convId = convo.conversation?.id ?? null;
    const convTitle = convo.conversation?.title ?? null;

    for (const item of convo.responses ?? []) {
      const r = item?.response;
      if (!r?.message) continue;

      // BSON extended JSON: { $date: { $numberLong: "1763147453123" } } — milliseconds
      const ms = parseInt(r.create_time?.$date?.$numberLong ?? '0', 10);
      if (!ms) continue;

      const role: 'human' | 'assistant' = r.sender === 'human' ? 'human' : 'assistant';
      const metadata: Record<string, any> = {};
      if (r.model) metadata.model = r.model;

      rows.push(await buildRow('grok', ms, role, r.message, convId, convTitle, metadata));
    }
  }

  return rows;
}
