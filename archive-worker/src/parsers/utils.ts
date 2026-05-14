const PLATFORM_TO_COMPANION: Record<string, string> = {
  vscode: 'companion_a',
  chatgpt: 'companion_c',
  openclaw: 'companion_c',
  gemini: 'companion_d',
  claude: 'companion_b',
  mistral: 'companion_e',
  grok: 'companion_f',
};

export async function makeId(llmPlatform: string, timestamp: string, role: string, content: string): Promise<string> {
  const key = `${llmPlatform}:${timestamp}:${role}:${content.slice(0, 64)}`;
  const enc = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 32);
}

export function normalizeTimestamp(ts: string | number): string {
  if (typeof ts === 'number') {
    // Heuristic: if < 1e12, it's seconds (ChatGPT create_time). Otherwise ms.
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toISOString();
  }
  if (typeof ts === 'string') {
    // If timestamp ends with Z or contains timezone, Date will parse it as UTC or given tz
    const d = new Date(ts);
    if (isNaN(d.getTime())) {
      throw new Error(`Cannot parse timestamp: ${ts}`);
    }
    return d.toISOString();
  }
  throw new Error(`Cannot parse timestamp: ${ts}`);
}

export function extractDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export async function buildRow(
  llmPlatform: string,
  timestamp: string | number,
  role: 'human' | 'assistant',
  content: string,
  conversationId?: string | null,
  conversationTitle?: string | null,
  metadata?: Record<string, any> | null,
) {
  const ts = normalizeTimestamp(timestamp as any);
  const companionId = PLATFORM_TO_COMPANION[llmPlatform];
  const sender = role === 'human' ? 'user' : companionId;
  return {
    id: await makeId(llmPlatform, ts, role, content),
    timestamp: ts,
    date: extractDate(ts),
    llm_platform: llmPlatform,
    companion_id: companionId,
    role,
    sender,
    content,
    conversation_id: conversationId || null,
    conversation_title: conversationTitle || null,
    metadata: JSON.stringify(metadata || {}),
  };
}
