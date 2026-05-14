import { fetchContext } from './search';

export async function handleMessage(request: Request, env: any, headers: any, id: string) {
  const msg = await env.ARCHIVE_DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
  if (!msg) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  const ctx = await fetchContext(env.ARCHIVE_DB, id, (msg as any).conversation_id, (msg as any).llm_platform, 5, 2);
  return new Response(JSON.stringify({ message: msg, context: ctx }), { headers });
}
