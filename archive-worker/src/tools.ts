export const MCP_TOOLS = [
  {
    name: 'archive_search',
    description: 'Search the conversation archive by keyword, date, and/or LLM platform. Returns matching messages with context window (5 before, 2 after).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or phrase to search for (FTS5 full-text search)' },
        platform: { type: 'string', enum: ['vscode', 'chatgpt', 'gemini', 'claude', 'mistral', 'grok', 'continuity'], description: 'Filter by LLM platform. Also accepts companion names (companion_a, companion_c, companion_d, companion_b, companion_e, companion_f, kaisoryth, morzar, lucien, kethtahl)' },
        date_from: { type: 'string', description: 'Start date filter (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'End date filter (YYYY-MM-DD)' },
        month: { type: 'string', description: 'Month shorthand (e.g. "jan", "feb 2026")' },
        role: { type: 'string', enum: ['human', 'assistant'], description: 'Filter by speaker role' },
        limit: { type: 'integer', default: 5, description: 'Max results to return (default 5)' },
        context_before: { type: 'integer', default: 5, description: 'Messages before match to include (default 5)' },
        context_after: { type: 'integer', default: 2, description: 'Messages after match to include (default 2)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'archive_stats',
    description: 'Get statistics about the archive: message counts by platform, date range covered, total size.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'archive_ingest',
    description: 'Ingest a transcript file into the archive. Accepts base64-encoded file content.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['vscode', 'chatgpt', 'gemini', 'claude', 'mistral', 'grok', 'continuity'], description: 'Source platform of the transcript file' },
        filename: { type: 'string', description: 'Original filename (used for metadata/logging)' },
        content_base64: { type: 'string', description: 'Base64-encoded file content' },
      },
      required: ['platform', 'filename', 'content_base64'],
    },
  },
];
