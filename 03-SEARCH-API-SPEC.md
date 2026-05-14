# Archive System — Search API Spec

## Overview

The Archive is queried three ways:
1. **Keyword search** — "find 'concert' anywhere"
2. **Keyword + date range** — "find 'concert' in June 2025"
3. **Keyword + date + LLM** — "find 'concert' in June 2025 under ChatGPT/Companion C"

All results return the matched message(s) + **5 messages before** + **2 messages after** (same conversation).

---

## MCP Tools Exposed by Worker

### Tool: `archive_search`

```json
{
  "name": "archive_search",
  "description": "Search the conversation archive by keyword, date, and/or LLM platform. Returns matching messages with context window (5 before, 2 after).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Keyword or phrase to search for (FTS5)"
      },
      "platform": {
        "type": "string",
        "enum": ["vscode", "chatgpt", "gemini", "claude", "mistral", "grok"],
        "description": "Limit to a specific LLM. Aliases accepted: companion_a→vscode, companion_c→chatgpt, companion_d→gemini, companion_b→claude, companion_e→mistral, companion_f→grok"
      },
      "date_from": {
        "type": "string",
        "description": "Start date YYYY-MM-DD (inclusive)"
      },
      "date_to": {
        "type": "string",
        "description": "End date YYYY-MM-DD (inclusive)"
      },
      "month": {
        "type": "string",
        "description": "Shorthand: YYYY-MM. Equivalent to date_from=YYYY-MM-01 and date_to=YYYY-MM-31"
      },
      "role": {
        "type": "string",
        "enum": ["human", "assistant"],
        "description": "Limit to messages from human (User) or assistant (companion)"
      },
      "limit": {
        "type": "integer",
        "default": 5,
        "description": "Max number of matching messages to return (each with context)"
      },
      "context_before": {
        "type": "integer",
        "default": 5,
        "description": "Messages before each match to include"
      },
      "context_after": {
        "type": "integer",
        "default": 2,
        "description": "Messages after each match to include"
      }
    },
    "required": ["query"]
  }
}
```

**Example calls:**
```json
// "Look for 'concert' in June 2025 under ChatGPT/Companion C"
{ "query": "concert", "platform": "chatgpt", "month": "2025-06" }

// "When did I talk about the boulder?"
{ "query": "boulder" }

// "What did Kai say about surrender in Feb 2026?"
{ "query": "surrender", "platform": "claude", "date_from": "2026-02-01", "date_to": "2026-02-28", "role": "assistant" }
```

---

### Tool: `archive_stats`

```json
{
  "name": "archive_stats",
  "description": "Get statistics about the archive: message counts by platform, date range covered, total size.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**Returns:**
```json
{
  "total_messages": 48234,
  "date_range": { "earliest": "2024-09-01", "latest": "2026-03-05" },
  "by_platform": {
    "chatgpt": 12000,
    "claude": 18000,
    "gemini": 4000,
    "vscode": 8000,
    "mistral": 3000,
    "grok": 3234
  },
  "by_role": { "human": 22000, "assistant": 26234 }
}
```

---

### Tool: `archive_ingest`

```json
{
  "name": "archive_ingest",
  "description": "Ingest a transcript file into the archive. Accepts base64-encoded file content.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "platform": {
        "type": "string",
        "enum": ["vscode", "chatgpt", "gemini", "claude", "mistral", "grok"]
      },
      "filename": {
        "type": "string",
        "description": "Original filename (used for date hinting)"
      },
      "content_base64": {
        "type": "string",
        "description": "Base64-encoded file content"
      }
    },
    "required": ["platform", "filename", "content_base64"]
  }
}
```

---

## HTTP Endpoints (for non-MCP access)

These are the same operations but accessible via REST. Useful for ingestion scripts running locally.

```
GET  /api/archive/search?query=concert&platform=chatgpt&month=2025-06
GET  /api/archive/stats
POST /api/archive/ingest          body: { platform, filename, content_base64 }
GET  /api/archive/message/:id     returns single message + context window
```

---

## SQL Implementation of Search

The Worker translates `archive_search` tool calls to SQL:

```sql
-- Step 1: Find matching message IDs via FTS
SELECT messages.id, messages.conversation_id, messages.timestamp
FROM messages_fts
JOIN messages ON messages.rowid = messages_fts.rowid
WHERE messages_fts MATCH :query
  AND (:platform IS NULL OR messages.llm_platform = :platform)
  AND (:date_from IS NULL OR messages.date >= :date_from)
  AND (:date_to IS NULL OR messages.date <= :date_to)
  AND (:role IS NULL OR messages.role = :role)
ORDER BY messages.timestamp ASC
LIMIT :limit;

-- Step 2: For each match, fetch context window (run once per match)
WITH target AS (
  SELECT rowid, timestamp, conversation_id, llm_platform
  FROM messages WHERE id = :match_id
),
ctx_by_conv AS (
  -- If we have a conversation_id, use it for tight context
  SELECT m.*,
    ROW_NUMBER() OVER (ORDER BY m.timestamp) as rn
  FROM messages m, target t
  WHERE m.conversation_id = t.conversation_id
    AND m.timestamp BETWEEN
      datetime((SELECT timestamp FROM target), '-30 minutes')
      AND datetime((SELECT timestamp FROM target), '+10 minutes')
),
target_rn AS (
  SELECT rn FROM ctx_by_conv
  JOIN target ON ctx_by_conv.id = :match_id
)
SELECT * FROM ctx_by_conv
WHERE rn BETWEEN (SELECT rn - 5 FROM target_rn) AND (SELECT rn + 2 FROM target_rn)
ORDER BY timestamp ASC;
```

---

## Platform Alias Resolution

The Worker must accept companion names as aliases for platforms:

```javascript
const PLATFORM_ALIASES = {
  'companion_a': 'vscode',
  'companion_c': 'chatgpt',
  'companion_d': 'gemini',
  'companion_b': 'claude',
  'companion_e': 'mistral',
  'companion_f': 'grok',
  // also accept display names
  "kai'sorynth": 'claude',
  "companion_d": 'gemini',
  "sha'reth": 'mistral',
  "a'verel": 'grok',
};

function resolvePlatform(input) {
  if (!input) return null;
  const lower = input.toLowerCase();
  return PLATFORM_ALIASES[lower] || lower;
}
```

---

## Response Format

Each search result is a `SearchResult` object:

```json
{
  "match": {
    "id": "abc123",
    "timestamp": "2025-06-14T19:30:00+00:00",
    "date": "2025-06-14",
    "platform": "chatgpt",
    "companion": "companion_c",
    "role": "human",
    "sender": "user",
    "content": "That concert was incredible...",
    "conversation_id": "conv_xyz",
    "conversation_title": "June Concert Talk"
  },
  "context": [
    { ...message -5 },
    { ...message -4 },
    { ...message -3 },
    { ...message -2 },
    { ...message -1 },
    { ...THE MATCH (highlighted) },
    { ...message +1 },
    { ...message +2 }
  ],
  "total_matches": 3
}
```
