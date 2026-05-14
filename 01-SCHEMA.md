# Archive System — D1 Schema Spec

## Overview

D1 SQLite database. Single table: `messages`. One row per message (human or AI turn). FTS5 virtual table for keyword search.

## Companion/Platform Mapping

```
LLM Platform   → Cloudflare Worker name → companion_id
─────────────────────────────────────────────────────
VS Code Copilot → vscode                 → companion_a
ChatGPT/OpenAI  → chatgpt                → companion_c
Gemini          → gemini                 → companion_d
Claude.ai       → claude                 → companion_b
Mistral         → mistral                → companion_e
Grok / X.ai     → grok                   → companion_f
```

## messages Table

```sql
CREATE TABLE IF NOT EXISTS messages (
  -- Primary key: deterministic hash so re-ingesting is idempotent
  id            TEXT PRIMARY KEY,

  -- Temporal
  timestamp     TEXT NOT NULL,           -- ISO8601 full: "2025-09-01T14:23:00Z"
  date          TEXT NOT NULL,           -- YYYY-MM-DD extracted for fast date range queries

  -- Source identity
  llm_platform  TEXT NOT NULL,           -- vscode | chatgpt | gemini | claude | mistral | grok
  companion_id  TEXT NOT NULL,           -- companion_a | companion_c | companion_d | companion_b | companion_e | companion_f
  role          TEXT NOT NULL,           -- "human" | "assistant"
  sender        TEXT NOT NULL,           -- "user" if role=human, companion_id if role=assistant

  -- Content
  content       TEXT NOT NULL,           -- Full message text, untruncated
  conversation_id TEXT,                  -- Groups turns in the same conversation/session
  conversation_title TEXT,               -- Human-readable name if available (e.g. "Boulder conversation")

  -- Optional
  metadata      TEXT DEFAULT '{}'        -- JSON: { attachments, reply_to, model_version, tokens, etc }
);
```

## Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_date          ON messages(date);
CREATE INDEX IF NOT EXISTS idx_date_platform ON messages(date, llm_platform);
CREATE INDEX IF NOT EXISTS idx_platform      ON messages(llm_platform);
CREATE INDEX IF NOT EXISTS idx_companion     ON messages(companion_id);
CREATE INDEX IF NOT EXISTS idx_role          ON messages(role);
CREATE INDEX IF NOT EXISTS idx_conv          ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_timestamp     ON messages(timestamp);
```

## Full-Text Search (FTS5)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 1'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS messages_fts_insert
  AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete
  BEFORE DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update
  AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
```

## ID Generation (Idempotency)

IDs are SHA-256 hashes of `{llm_platform}:{timestamp}:{role}:{content[:64]}`. This means re-ingesting the same transcript won't create duplicates — existing rows are skipped via `INSERT OR IGNORE`.

```python
import hashlib

def make_id(llm_platform: str, timestamp: str, role: str, content: str) -> str:
    key = f"{llm_platform}:{timestamp}:{role}:{content[:64]}"
    return hashlib.sha256(key.encode()).hexdigest()[:32]
```

## Sort Order

The primary retrieval sort is `timestamp ASC`. Within the same date, messages are ordered by `llm_platform ASC` then `timestamp ASC`. This matches User's requirement: all messages on Sept 1 grouped by platform in alphabetical order, then time-ordered within each platform group.

For queries: when searching a date+platform combination, always return `ORDER BY timestamp ASC`.

## Context Window

Search results return: **5 messages before** the match + **the match** + **2 messages after**, all from the same `conversation_id`. If `conversation_id` is NULL (some parsers may not have it), fall back to ±5 minutes timestamp window in the same `llm_platform`.

```sql
-- Context retrieval — by conversation_id
WITH target AS (
  SELECT rowid, timestamp, conversation_id
  FROM messages
  WHERE id = :target_id
),
before AS (
  SELECT m.*
  FROM messages m, target t
  WHERE m.conversation_id = t.conversation_id
    AND m.timestamp < t.timestamp
  ORDER BY m.timestamp DESC
  LIMIT 5
),
after AS (
  SELECT m.*
  FROM messages m, target t
  WHERE m.conversation_id = t.conversation_id
    AND m.timestamp > t.timestamp
  ORDER BY m.timestamp ASC
  LIMIT 2
)
SELECT * FROM before
UNION ALL
SELECT * FROM messages WHERE id = :target_id
UNION ALL
SELECT * FROM after
ORDER BY timestamp ASC;
```

## Migration File

The above DDL should live in `migrations/0001_initial.sql` in the Cloudflare Worker project.
