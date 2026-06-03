import { extractDate, makeId, normalizeTimestamp } from './utils';

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function archiveRole(role: unknown): 'human' | 'assistant' {
  return role === 'human' ? 'human' : 'assistant';
}

function eventList(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw.filter(item => item && typeof item === 'object') as Record<string, any>[];
  const root = asRecord(raw);
  if (Array.isArray(root.events)) return root.events.filter(item => item && typeof item === 'object') as Record<string, any>[];
  if (root.event && typeof root.event === 'object') return [root.event as Record<string, any>];
  return [];
}

export async function parse(rawText: string): Promise<any[]> {
  const parsed = JSON.parse(rawText);
  const rows: any[] = [];

  for (const event of eventList(parsed)) {
    const content = String(event.content || '').trim();
    if (!content) continue;

    const timestamp = normalizeTimestamp(String(event.created_at || event.inserted_at || new Date().toISOString()));
    const role = archiveRole(event.role);
    const companionId = String(event.companion_id || 'unknown_companion');
    const conversationId = event.conversation_id ? String(event.conversation_id) : null;
    const conversationTitle = [event.source, conversationId].filter(Boolean).join(':') || null;
    const metadata = {
      source: event.source || null,
      external_message_id: event.external_message_id || null,
      reply_to: event.reply_to || null,
      author: event.author || null,
      raw_role: event.role || null,
      continuity_event_id: event.id || null,
      metadata: event.metadata || null,
      raw: event.raw || null,
    };

    rows.push({
      id: event.id ? String(event.id) : await makeId('continuity', timestamp, role, content),
      timestamp,
      date: extractDate(timestamp),
      llm_platform: 'continuity',
      companion_id: companionId,
      role,
      sender: role === 'human' ? 'user' : companionId,
      content,
      conversation_id: conversationId,
      conversation_title: conversationTitle,
      metadata: JSON.stringify(metadata),
    });
  }

  return rows;
}
