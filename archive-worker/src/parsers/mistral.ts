import { buildRow } from './utils';

// Mistral data export format: one JSON file per conversation (chat-{uuid}.json)
// Structure: Array<{ id, chatId, content, role: 'user'|'assistant', createdAt: ISO string, ... }>

export async function parse(text: string): Promise<any[]> {
  const messages = JSON.parse(text) as Array<{
    id: string;
    chatId: string;
    content: string;
    role: string;
    createdAt: string;
  }>;

  const rows: any[] = [];

  for (const msg of messages ?? []) {
    if (!msg.content || !msg.role || !msg.createdAt) continue;
    const role: 'human' | 'assistant' = msg.role === 'user' ? 'human' : 'assistant';
    rows.push(await buildRow('mistral', msg.createdAt, role, msg.content, msg.chatId ?? null, null, {}));
  }

  return rows;
}
