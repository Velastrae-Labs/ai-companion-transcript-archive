# Agent Instructions — Archive System Build

**FOR:** Lightweight execution model (e.g., free Copilot, Gemini, GPT-4o-mini)  
**FROM:** Mor'zar (VS-Kai), architect  
**PROJECT FILES:** `_VS-KAI/projects/archive-system/`

You are executing a pre-designed system. Do NOT redesign it. Do NOT ask architectural questions. Read the spec files and implement them. If you encounter an ambiguity, check the spec file listed, then make the most conservative choice.

---

## What You're Building

A Cloudflare Worker + D1 database that archives LLM conversations chronologically. It exposes MCP tools for searching the archive by keyword, date, and platform. Reference files are in the same folder as this document.

---

## Build Order (Do These In Sequence)

### Step 1 — Scaffold The Worker Project

```bash
mkdir archive-worker && cd archive-worker
npm init -y
npm install -D wrangler typescript @cloudflare/workers-types
npx wrangler init --no-git
```

Create the directory structure exactly as specified in `04-CLOUDFLARE-WORKER-SPEC.md` under "Directory Structure".

### Step 2 — Create the D1 Database

```bash
npx wrangler d1 create companion-archive
```

Copy the `database_id` output into `wrangler.toml`. Then:

```bash
npx wrangler d1 execute companion-archive --file=migrations/0001_initial.sql
```

The migration SQL is in `01-SCHEMA.md` — copy the full DDL (table + indexes + FTS5 + triggers) into `migrations/0001_initial.sql`.

### Step 3 — Implement The Worker

Work through these files **in this order**:

1. `src/parsers/utils.ts` — TypeScript port of the Python `build_row` / `make_id` / `normalize_timestamp` / `extract_date` functions from `02-PARSERS-SPEC.md`. The `make_id` function should use the Web Crypto API since Workers don't have Node's `crypto`:
   ```typescript
   async function make_id(platform: string, ts: string, role: string, content: string): Promise<string> {
     const key = `${platform}:${ts}:${role}:${content.slice(0, 64)}`;
     const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
     return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
   }
   ```

2. `src/parsers/chatgpt.ts` — TypeScript port of `parsers/chatgpt_parser.py` from `02-PARSERS-SPEC.md`
3. `src/parsers/claude.ts` — TypeScript port of `parsers/claude_parser.py` (ZIP handling not available in Workers — accept pre-extracted JSON only; document this)
4. `src/parsers/vscode.ts` — TypeScript port of `parsers/vscode_parser.py`
5. `src/parsers/gemini.ts` — TypeScript port of `parsers/gemini_parser.py`
6. `src/parsers/mistral.ts` — Simple text parser (see below)
7. `src/parsers/grok.ts` — Same structure as mistral

8. `src/tools.ts` — MCP_TOOLS array. Copy the three tool definitions from `03-SEARCH-API-SPEC.md` (archive_search, archive_stats, archive_ingest), formatted as a TypeScript array.

9. `src/handlers/search.ts` — Implement searchMessages() as specified in `04-CLOUDFLARE-WORKER-SPEC.md`
10. `src/handlers/stats.ts` — Implement getStats():
    ```typescript
    export async function getStats(db: D1Database) {
      const total = await db.prepare('SELECT COUNT(*) as n FROM messages').first();
      const byPlatform = await db.prepare('SELECT llm_platform, COUNT(*) as n FROM messages GROUP BY llm_platform').all();
      const byRole = await db.prepare('SELECT role, COUNT(*) as n FROM messages GROUP BY role').all();
      const dates = await db.prepare('SELECT MIN(date) as earliest, MAX(date) as latest FROM messages').first();
      return {
        total_messages: (total as any).n,
        date_range: dates,
        by_platform: Object.fromEntries((byPlatform.results || []).map((r: any) => [r.llm_platform, r.n])),
        by_role: Object.fromEntries((byRole.results || []).map((r: any) => [r.role, r.n])),
      };
    }
    ```

11. `src/handlers/ingest.ts` — As specified in `04-CLOUDFLARE-WORKER-SPEC.md`
12. `src/handlers/message.ts` — Fetch single message + context:
    ```typescript
    export async function handleMessage(request: Request, env: Env, headers: any, id: string) {
      const msg = await env.ARCHIVE_DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
      if (!msg) return Response.json({ error: 'Not found' }, { status: 404, headers });
      const ctx = await fetchContext(env.ARCHIVE_DB, id, (msg as any).conversation_id, (msg as any).llm_platform, 5, 2);
      return Response.json({ message: msg, context: ctx }, { headers });
    }
    ```
    (fetchContext is exported from search.ts and reused here)

13. `src/mcp.ts` — As specified in `04-CLOUDFLARE-WORKER-SPEC.md`
14. `src/index.ts` — Request router as specified in `04-CLOUDFLARE-WORKER-SPEC.md`

### Step 4 — Local Ingestion Scripts

Build `scripts/ingest_local.py` — a Python script for running locally to batch-ingest transcript files:

```python
#!/usr/bin/env python3
"""
Local ingestion script. Run this on User's machine to ingest transcript files
before uploading to the Archive Worker.

Usage:
  python ingest_local.py --platform chatgpt --file ~/Downloads/conversations.json
  python ingest_local.py --platform claude --dir ~/Downloads/claude-export/
  python ingest_local.py --platform vscode --file ~/transcripts/2025-09-01_copilot.txt

The script calls the Archive Worker's REST endpoint directly:
  POST https://archive.your-domain.workers.dev/api/archive/ingest
"""

import argparse, base64, os, sys, json
import requests

ARCHIVE_URL = "https://archive.your-domain.workers.dev"

def ingest_file(platform: str, file_path: str):
    with open(file_path, 'rb') as f:
        content_b64 = base64.b64encode(f.read()).decode('utf-8')
    filename = os.path.basename(file_path)
    resp = requests.post(
        f"{ARCHIVE_URL}/api/archive/ingest",
        json={"platform": platform, "filename": filename, "content_base64": content_b64},
        timeout=60,
    )
    resp.raise_for_status()
    result = resp.json()
    print(f"✓ {filename}: {result.get('inserted')} inserted, {result.get('skipped')} skipped")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', required=True, choices=['chatgpt','claude','gemini','vscode','mistral','grok'])
    parser.add_argument('--file', help='Single file to ingest')
    parser.add_argument('--dir', help='Directory of files to ingest')
    args = parser.parse_args()

    if args.file:
        ingest_file(args.platform, args.file)
    elif args.dir:
        files = sorted([f for f in os.listdir(args.dir) if not f.startswith('.')])
        for fname in files:
            ingest_file(args.platform, os.path.join(args.dir, fname))
    else:
        print("Provide --file or --dir")
        sys.exit(1)

if __name__ == '__main__':
    main()
```

Also build `scripts/search_local.py` — a simple CLI search tool for testing:

```python
#!/usr/bin/env python3
"""
CLI search tool for testing the archive.

Usage:
  python search_local.py "concert"
  python search_local.py "concert" --platform chatgpt --month 2025-06
  python search_local.py "boulder" --platform claude --date-from 2026-01-01
"""

import argparse, json
import requests

ARCHIVE_URL = "https://archive.your-domain.workers.dev"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('query')
    parser.add_argument('--platform', default=None)
    parser.add_argument('--month', default=None)
    parser.add_argument('--date-from', default=None)
    parser.add_argument('--date-to', default=None)
    parser.add_argument('--role', default=None)
    parser.add_argument('--limit', type=int, default=5)
    args = parser.parse_args()

    params = {k: v for k, v in {
        'query': args.query,
        'platform': args.platform,
        'month': args.month,
        'date_from': args.date_from,
        'date_to': args.date_to,
        'role': args.role,
        'limit': args.limit,
    }.items() if v is not None}

    resp = requests.get(f"{ARCHIVE_URL}/api/archive/search", params=params)
    resp.raise_for_status()
    result = resp.json()

    print(f"\nFound {result['total_matches']} matches for '{args.query}':\n")
    for r in result['results']:
        print("─" * 60)
        for msg in r['context']:
            marker = ">>>" if msg.get('is_match') else "   "
            sender = msg['sender'].upper()[:8].ljust(8)
            ts = msg['timestamp'][:16]
            print(f"{marker} [{ts}] {sender}: {msg['content'][:120]}")
        print()

if __name__ == '__main__':
    main()
```

### Step 4.5 — Prep VS Code Transcripts

VS Code Copilot Chat stores sessions as raw JSON in:
```
%APPDATA%\Code\User\workspaceStorage\<hash>\chatSessions\<session-id>.json
```

Those JSON files contain raw session data including tool calls, terminal runs, file reads, confirmations, etc. — all the "work" we don't want in the archive.

A cleanup script is already written at:
```
_VS-KAI/projects/archive-system/scripts/clean_vscode_transcripts.py
```

It keeps:
- `kind: "thinking"` blocks → stored as THINKING: turns
- Items with a `value` string and no `kind` (or kind isn't a tool kind) → stored as ASSISTANT: turns
- `message.text` fields → stored as HUMAN: turns

It strips:
- `kind: "prepareToolInvocation"` — tool announcements
- `kind: "toolInvocationSerialized"` — tool results
- `kind: "mcpServersStarting"` — startup noise
- `kind: "elicitationSerialized"` — confirmation prompts
- Anything with `toolName` or `toolId` keys
- Empty objects `{}`

**Usage:**
```bash
# Clean all workspaceStorage chatSessions, output to Transcripts/VSCode/
python _VS-KAI/projects/archive-system/scripts/clean_vscode_transcripts.py --all --out "_VS-KAI/projects/archive-system/Transcripts/VSCode"

# Clean a specific workspace hash only
python _VS-KAI/projects/archive-system/scripts/clean_vscode_transcripts.py \
  --ws-hash 231eae45d8862f890fd615eb99c6704b \
  --out "_VS-KAI/projects/archive-system/Transcripts/VSCode"

# Clean a single file
python _VS-KAI/projects/archive-system/scripts/clean_vscode_transcripts.py \
  --file "C:/Users/username/AppData/Roaming/Code/User/workspaceStorage/aed4dc537bab06e695d4d52a1d76111b/chatSessions/8f3c7644-1178-41e4-be12-3965471aa903.json"
```

Output files are named `YYYY-MM-DD_session-title.txt` and contain the clean HUMAN/THINKING/ASSISTANT transcript, ready to ingest with `--platform vscode`.

---

### Step 5 — Deploy

```bash
cd archive-worker
npx wrangler deploy
```

Test:
```bash
curl "https://archive.your-domain.workers.dev/api/archive/stats"
curl "https://archive.your-domain.workers.dev/mcp" -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### Step 6 — Add To MCP Config

Add to `C:\Users\username\NEWTEST\_VS-KAI\mor-mcp-config.json`:

```json
"archive": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://archive.your-domain.workers.dev/mcp"]
}
```

---

## Current Build Status (as of March 6, 2026)

The scaffold is complete. The following are built:
- `archive-worker/` root with `wrangler.toml`, `package.json`, `tsconfig.json`
- `migrations/0001_initial.sql`
- `src/index.ts`, `src/mcp.ts`, `src/tools.ts`
- `src/handlers/search.ts`, `ingest.ts`, `stats.ts`, `message.ts`
- `src/parsers/utils.ts`

**Missing — build these next (in order):**
1. `src/parsers/chatgpt.ts` — from `02-PARSERS-SPEC.md`
2. `src/parsers/claude.ts` — from `02-PARSERS-SPEC.md`
3. `src/parsers/vscode.ts` — input is the HUMAN:/THINKING:/ASSISTANT: text output from `clean_vscode_transcripts.py`
4. `src/parsers/gemini.ts` — Gemini transcripts in `Transcripts/` are `.md` format, not Takeout JSON. Parse as a two-speaker markdown format: lines starting with `**User:**` or `**You:**` = human, lines starting with `**Gemini:**` or `**Model:**` = assistant.
5. `src/parsers/mistral.ts` — see Mistral + Grok Parser Notes below
6. `src/parsers/grok.ts` — see Mistral + Grok Parser Notes below

After parsers are done: Step 5 (deploy) and Step 6 (MCP config).

---

## Mistral + Grok Parser Notes

Neither has an official export. The parsers accept a simple two-speaker text format:

```
HUMAN: message content here
ASSISTANT: response here
HUMAN: next message
```

Or with timestamps:

```
[2025-09-01 14:23] HUMAN: message
[2025-09-01 14:24] ASSISTANT: response
```

Parser should handle both. Timestamp regex: `\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)\]`

If no timestamps found, use date from filename (pattern: `YYYY-MM-DD` anywhere in filename).

---

## Do NOT Do

- Do not change the schema without flagging it (it was designed intentionally)
- Do not use semantic search here — that's Mastermind's job
- Do not add authentication — this worker is private by URL obscurity only
- Do not remove INSERT OR IGNORE — idempotency is required
- Do not compress or truncate content — full fidelity storage is a design requirement
