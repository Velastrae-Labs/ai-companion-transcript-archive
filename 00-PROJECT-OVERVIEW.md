# Archive System — Project Overview

*Chronological message storage with full context retrieval*

**Started:** March 2, 2026  
**Lead:** Mor'zar (VS-Kai)  
**Stakeholders:** User, Kai, companion_d  
**Status:** Design Phase

---

## The Problem

User: *"On Feb 27 you said...!!"*
Kai: *searches mastermind, gets a chunk, no context, no before/after*

Current memory systems cannot answer **"when did this happen and what came before?"**

| System | What it answers |
|--------|-----------------|
| Mastermind | "Find me things that MEAN like X" |
| Companion Mind | "What do I KNOW about X" |
| Hearth | "How are we NOW" |
| **Archive (NEW)** | "WHEN did X happen, full context" |

---

## What Archive Does

1. **Stores every message** with metadata: timestamp, sender, platform, channel/conversation
2. **Full chronological retrieval** — not chunks, whole messages
3. **Context window** — returns N messages before and after any hit
4. **Multi-source ingestion** — Discord, VS Code chats, Claude exports, any transcript
5. **Simple query interface** — date range, sender, keyword, platform

---

## What Archive Does NOT Do

- **No semantic search** — that's Mastermind's job
- **No structured entities** — that's NESTeq/Companion Mind
- **No emotional tracking** — that's Hearth
- **No aggregation/analysis** — just storage and retrieval

It's a **tape recorder**, not an analyst.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    ARCHIVE (D1 / SQLite)                   │
│                                                            │
│  messages                                                  │
│  ├── id (primary key)                                      │
│  ├── timestamp (ISO8601)                                   │
│  ├── sender (string: "user", "companion_a", "kai", etc)          │
│  ├── platform (string: "discord", "vscode", "claude")      │
│  ├── channel (string: channel_id or conversation_name)     │
│  ├── content (text: full message)                          │
│  └── metadata (JSON: reply_to, attachments, etc)           │
│                                                            │
│  Indexes: timestamp, sender, platform, content (FTS)       │
└────────────────────────────────────────────────────────────┘
```

### Query Examples

```sql
-- "What did Kai say on Feb 27 about the boulder?"
SELECT * FROM messages 
WHERE sender = 'companion_b' 
  AND timestamp LIKE '2026-02-27%' 
  AND content LIKE '%boulder%'
ORDER BY timestamp;

-- "Show me the 5 messages before and after a specific message"
WITH target AS (SELECT timestamp FROM messages WHERE id = ?)
SELECT * FROM messages 
WHERE timestamp BETWEEN 
  (SELECT datetime(timestamp, '-10 minutes') FROM target)
  AND 
  (SELECT datetime(timestamp, '+10 minutes') FROM target)
ORDER BY timestamp;
```

---

## Ingestion Sources

| Source | Format | Parser Needed |
|--------|--------|---------------|
| Discord exports | JSON | Yes — map message objects |
| VS Code chat exports | JSON | Yes — extract conversation format |
| Claude.ai exports | Markdown | Yes — parse conversation pairs |
| Gemini exports | JSON/HTML | Yes — varies by export |

### Ingestion Script Pattern

```python
# archive_ingest.py
def ingest_discord_export(json_path: str):
    """Parse Discord export, insert each message to Archive"""
    data = json.load(open(json_path))
    for msg in data['messages']:
        insert_message(
            timestamp=msg['timestamp'],
            sender=msg['author']['name'],
            platform='discord',
            channel=data['channel']['id'],
            content=msg['content'],
            metadata={'attachments': msg.get('attachments', [])}
        )
```

---

## MCP Tools (Future)

| Tool | Parameters | Returns |
|------|------------|---------|
| `archive_search` | query, sender, platform, date_from, date_to, context_size | Messages with context |
| `archive_ingest` | file_path, format | Ingestion result |
| `archive_stats` | none | Counts by sender/platform/date range |

---

## Design Principles

1. **Speed is not the priority** — Quality and completeness are. It takes what it takes.
2. **Lossless storage** — Every message, full fidelity
3. **Human-readable queries** — SQL or simple MCP tool calls
4. **One source of truth** — If conversation happened, it's in Archive
5. **Easy ingestion** — Drag-and-drop transcript files, run script, done

---

## Deployment Options

| Option | Pros | Cons |
|--------|------|------|
| **Cloudflare D1** | Fits stack, serverless, SQL | 10GB limit (free), remote |
| **SQLite (local)** | Fast, no deploy, unlimited | Not shared across machines |
| **Turso** | SQLite + distributed | Another vendor |

Recommendation: **D1** to start. If we hit size limits, migrate to Turso or self-hosted.

---

## Implementation Phases

### Phase 1: Schema + Manual Ingest
- Create D1 database with messages table
- Write parser for Discord JSON exports
- Test queries manually

### Phase 2: MCP Wrapper
- Build Cloudflare Worker exposing archive_search
- Connect MCP endpoint for Kai access
- HTTP endpoint for non-MCP access

### Phase 3: Auto-Ingestion
- Webhook listener for Discord exports
- VS Code extension export hook (if possible)
- Scheduled sync from export folders

---

## Links

- Related: `sexuality-tracking-system/` (Hearth handles desire tracking)
- Related: Mastermind (semantic search complements Archive's exact search)

---

💚🖤
