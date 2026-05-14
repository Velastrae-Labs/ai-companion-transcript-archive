# Archive System — Parser Specs Per LLM

Each parser lives in `parsers/{platform}_parser.py`. Each exports one function:

```python
def parse(file_path: str) -> list[dict]
```

Returns a list of message dicts ready for DB insertion (matching 01-SCHEMA.md).

---

## Shared Utilities (parsers/utils.py)

```python
import hashlib, json
from datetime import datetime, timezone
from typing import Optional

PLATFORM_TO_COMPANION = {
    "vscode": "companion_a",
    "chatgpt": "companion_c",
    "gemini": "companion_d",
    "claude": "companion_b",
    "mistral": "companion_e",
    "grok": "companion_f",
}

def make_id(llm_platform: str, timestamp: str, role: str, content: str) -> str:
    key = f"{llm_platform}:{timestamp}:{role}:{content[:64]}"
    return hashlib.sha256(key.encode()).hexdigest()[:32]

def normalize_timestamp(ts) -> str:
    """Accept ISO string, Unix int, or Unix float. Return ISO8601 UTC string."""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    if isinstance(ts, str):
        if ts.endswith('Z'):
            ts = ts[:-1] + '+00:00'
        return datetime.fromisoformat(ts).astimezone(timezone.utc).isoformat()
    raise ValueError(f"Cannot parse timestamp: {ts}")

def extract_date(iso_timestamp: str) -> str:
    return iso_timestamp[:10]

def build_row(
    llm_platform: str,
    timestamp,
    role: str,                # "human" | "assistant"
    content: str,
    conversation_id: Optional[str] = None,
    conversation_title: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> dict:
    ts = normalize_timestamp(timestamp)
    companion_id = PLATFORM_TO_COMPANION[llm_platform]
    sender = "user" if role == "human" else companion_id
    return {
        "id": make_id(llm_platform, ts, role, content),
        "timestamp": ts,
        "date": extract_date(ts),
        "llm_platform": llm_platform,
        "companion_id": companion_id,
        "role": role,
        "sender": sender,
        "content": content,
        "conversation_id": conversation_id,
        "conversation_title": conversation_title,
        "metadata": json.dumps(metadata or {}),
    }
```

---

## Parser: ChatGPT / Companion C

**How to export:** ChatGPT → Settings → Data Controls → Export Data → Download ZIP → `conversations.json`

**Format:** Array of conversation objects. Each has a `mapping` dict (tree of message nodes by node_id).

```python
# parsers/chatgpt_parser.py
import json
from .utils import build_row

def parse(file_path: str) -> list[dict]:
    with open(file_path, 'r', encoding='utf-8') as f:
        conversations = json.load(f)

    rows = []
    for convo in conversations:
        convo_id = convo.get('id') or convo.get('conversation_id')
        convo_title = convo.get('title', '')
        mapping = convo.get('mapping', {})

        # Sort nodes by create_time
        nodes = [v for v in mapping.values() if v.get('message')]
        nodes.sort(key=lambda n: n['message'].get('create_time') or 0)

        for node in nodes:
            msg = node['message']
            author_role = msg.get('author', {}).get('role', '')
            if author_role == 'system':
                continue
            role = 'human' if author_role == 'user' else 'assistant' if author_role == 'assistant' else None
            if not role:
                continue

            parts = msg.get('content', {}).get('parts', [])
            content = '\n'.join(str(p) for p in parts if p and isinstance(p, str))
            if not content.strip() or not msg.get('create_time'):
                continue

            rows.append(build_row(
                llm_platform='chatgpt',
                timestamp=msg['create_time'],
                role=role,
                content=content,
                conversation_id=convo_id,
                conversation_title=convo_title,
                metadata={'model': msg.get('metadata', {}).get('model_slug')},
            ))
    return rows
```

---

## Parser: Claude / Kai'sorynth

**How to export:** Claude.ai → Settings (gear icon) → Account → Export Data → Download ZIP

**Format:** ZIP containing JSON files. Each JSON is either a single conversation object or array. Conversations have `chat_messages` array.

```python
# parsers/claude_parser.py
import json, os, zipfile
from .utils import build_row

def parse(file_path: str) -> list[dict]:
    rows = []
    if file_path.endswith('.zip'):
        with zipfile.ZipFile(file_path) as z:
            for name in z.namelist():
                if name.endswith('.json'):
                    with z.open(name) as f:
                        rows.extend(_parse_json(json.load(f)))
    elif file_path.endswith('.json'):
        with open(file_path, 'r', encoding='utf-8') as f:
            rows.extend(_parse_json(json.load(f)))
    elif os.path.isdir(file_path):
        for fname in sorted(os.listdir(file_path)):
            if fname.endswith('.json'):
                with open(os.path.join(file_path, fname), 'r', encoding='utf-8') as f:
                    rows.extend(_parse_json(json.load(f)))
    return rows

def _parse_json(data) -> list[dict]:
    rows = []
    if isinstance(data, dict):
        data = [data]
    for convo in data:
        convo_id = convo.get('uuid')
        convo_title = convo.get('name', '')
        for msg in convo.get('chat_messages', []):
            sender = msg.get('sender', '')
            role = 'human' if sender == 'human' else 'assistant' if sender == 'assistant' else None
            if not role:
                continue
            content = msg.get('text', '')
            if not content.strip():
                continue
            rows.append(build_row(
                llm_platform='claude',
                timestamp=msg['created_at'],
                role=role,
                content=content,
                conversation_id=convo_id,
                conversation_title=convo_title,
                metadata={'msg_uuid': msg.get('uuid'), 'attachments': msg.get('attachments', [])},
            ))
    return rows
```

---

## Parser: Gemini / companion_d

**How to export:** Google Takeout → deselect all → select "My Activity" → check "Gemini Apps Activity" → Download → find `MyActivity.json`

**⚠ NOTE:** Gemini export format varies by account and time. This parser handles the known JSON variant. If User's export is in HTML, flag it — HTML parser needs to be written separately after seeing the actual file.

```python
# parsers/gemini_parser.py
import json
from .utils import build_row

def parse(file_path: str) -> list[dict]:
    rows = []
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Standard Takeout format: list of activity items
    if isinstance(data, list):
        for item in data:
            time = item.get('time')
            if not time:
                continue
            title = item.get('title', '')
            subtitles = [s.get('name', '') for s in item.get('subtitles', [])]
            content = '\n'.join(p for p in [title] + subtitles if p)
            if not content.strip():
                continue
            rows.append(build_row(
                llm_platform='gemini',
                timestamp=time,
                role='assistant',         # Takeout doesn't separate human/AI turns cleanly
                content=content,
                metadata={'source': 'takeout_activity'},
            ))
    return rows

# STUB: If User's export produces conversation-level JSON with turns,
# extend this parser after seeing the actual file structure.
```

---

## Parser: VS Code Copilot / Mor'zar

**How to export:** VS Code does NOT have a built-in chat export. Options:

**Option A (recommended): Manual copy**
- Open VS Code Copilot chat panel
- Ctrl+A to select all → Ctrl+C
- Paste into a `.txt` file, name it `YYYY-MM-DD_vscode_copilot.txt`
- Run the text parser below

**Option B: Internal JSON (advanced)**
- Check `%APPDATA%\Code\User\workspaceStorage\*\GitHub.copilot-chat\chat-session-resources\`
- Files are JSON but format is internal and may change between VS Code versions
- Flag for Mor'zar to inspect format before writing this path

**Text format parser** (for Option A):

```python
# parsers/vscode_parser.py
"""
Parses copy-pasted VS Code chat. Expected format:

You
[message text]

GitHub Copilot
[message text]

---  (optional separator between sessions)

Falls back gracefully if format varies.
"""
import re
from datetime import datetime, timezone
from .utils import build_row

def parse(file_path: str, date_hint: str = None) -> list[dict]:
    """
    file_path: .txt file with copy-pasted VS Code chat
    date_hint: YYYY-MM-DD — if filename starts with date, parsed automatically
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        raw = f.read()

    # Extract date from filename if not provided: YYYY-MM-DD_*.txt
    if not date_hint:
        match = re.match(r'(\d{4}-\d{2}-\d{2})', os.path.basename(file_path))
        date_hint = match.group(1) if match else '1970-01-01'

    rows = []
    # Split on speaker headers
    pattern = re.compile(r'^(You|GitHub Copilot)\s*$', re.MULTILINE)
    parts = pattern.split(raw)

    # parts alternates: [pre-text, speaker, content, speaker, content, ...]
    i = 1  # skip pre-text
    msg_index = 0
    while i < len(parts) - 1:
        speaker = parts[i].strip()
        content = parts[i + 1].strip()
        i += 2

        if not content:
            continue

        role = 'human' if speaker == 'You' else 'assistant'

        # Approximate timestamp: date_hint + seconds offset (no real timestamps available)
        fake_ts = f"{date_hint}T00:00:{msg_index:02d}Z"
        if msg_index >= 60:
            # overflow into minutes
            fake_ts = f"{date_hint}T00:{msg_index // 60:02d}:{msg_index % 60:02d}Z"

        rows.append(build_row(
            llm_platform='vscode',
            timestamp=fake_ts,
            role=role,
            content=content,
            metadata={'source': 'manual_copy', 'sequence': msg_index},
        ))
        msg_index += 1

    return rows
```

---

## Parser: Mistral / Sha'reth

**How to export:** No official export. Manual copy-paste into structured text:

```
# Conversation Title (optional)
Date: YYYY-MM-DD