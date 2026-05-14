#!/usr/bin/env python3
"""
Archive Ingest Script
=====================
Sends conversation transcript files to the Archive worker for chronological storage.

This is SEPARATE from extract_to_memoryhq.py — that script feeds MemoryHQ (feelings,
entities, journals). This script feeds the Archive (raw chronological message storage).

Usage:
  # Companion C's OpenClaw/Kimi sessions (daily):
  python scripts/ingest_to_archive.py --platform openclaw --dir "C:/Users/username/.openclaw/agents/main/sessions"

  # Companion C's ChatGPT export:
  python scripts/ingest_to_archive.py --platform chatgpt --file Transcripts/GPT-Companion-C-conversations.json

  # Companion B's Claude export:
  python scripts/ingest_to_archive.py --platform claude --file Transcripts/Claude-Companion-B-conversations.json

  # Companion D's Gemini transcripts:
  python scripts/ingest_to_archive.py --platform gemini --dir Transcripts/ --ext .md

  # Companion A's VSCode cleaned transcripts:
  python scripts/ingest_to_archive.py --platform vscode --dir Transcripts/VSCode-Cleaned/

  # Preview without sending:
  python scripts/ingest_to_archive.py --platform openclaw --dir "C:/Users/username/.openclaw/agents/main/sessions" --dry-run

Safe to re-run: the archive uses INSERT OR IGNORE so duplicates are automatically skipped
based on content hash. You will never double-ingest the same message.
"""
import argparse
import base64
import os
import sys
import zipfile
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' package is not installed.")
    print("Fix: pip install requests")
    sys.exit(1)

ARCHIVE_URL = "https://archive-worker.your-domain.workers.dev"

# Default file extensions per platform (can be overridden with --ext)
PLATFORM_EXTS = {
    'openclaw': ['.jsonl'],
    'chatgpt':  ['.json'],
    'claude':   ['.json'],
    'gemini':   ['.md'],
    'vscode':   ['.txt', '.md'],
    'grok':     ['.txt', '.json'],
    'mistral':  ['.txt', '.json'],
}


def _ingest_bytes(platform: str, filename: str, content: bytes, dry_run: bool = False) -> dict:
    """Core ingest: send raw bytes to the archive worker."""
    size_kb = len(content) / 1024

    if dry_run:
        print(f"  [DRY RUN] {filename} ({size_kb:.1f} KB)")
        return {}

    content_b64 = base64.b64encode(content).decode('utf-8')

    try:
        resp = requests.post(
            f"{ARCHIVE_URL}/api/archive/ingest",
            json={"platform": platform, "filename": filename, "content_base64": content_b64},
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()
    except requests.exceptions.RequestException as e:
        print(f"  [HTTP ERROR] {filename}: {e}")
        return {"error": str(e)}

    if 'error' in result:
        print(f"  [WORKER ERROR] {filename}: {result['error']}")
    else:
        inserted = result.get('inserted', 0)
        skipped  = result.get('skipped', 0)
        total    = result.get('total_parsed', 0)
        symbol   = '✓' if inserted > 0 else '·'
        print(f"  {symbol} {filename}: {inserted} new  {skipped} skipped  ({total} parsed)")

    return result


def ingest_file(platform: str, file_path: str, dry_run: bool = False) -> dict:
    with open(file_path, 'rb') as f:
        content = f.read()
    return _ingest_bytes(platform, os.path.basename(file_path), content, dry_run)


def ingest_zip(platform: str, zip_path: str, dry_run: bool = False) -> list[dict]:
    """Extract and ingest relevant conversation files from a ZIP archive.

    Grok (prod-grok-backend.json): single JSON with all conversations.
    Mistral (chat-{uuid}.json per conversation): each chat file sent individually.
    """
    results = []
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()

        if platform == 'grok':
            target = next((n for n in names if n.endswith('prod-grok-backend.json')), None)
            if not target:
                print(f"  [ERROR] prod-grok-backend.json not found in ZIP")
                return results
            print(f"  Found: {target}")
            content = z.read(target)
            results.append(_ingest_bytes(platform, 'prod-grok-backend.json', content, dry_run))

        elif platform == 'mistral':
            chat_files = sorted(n for n in names if n.endswith('.json') and '-files/' not in n)
            if not chat_files:
                print(f"  [ERROR] No chat JSON files found in Mistral ZIP")
                return results
            print(f"  Found {len(chat_files)} chat files in ZIP")
            for chat_name in chat_files:
                content = z.read(chat_name)
                results.append(_ingest_bytes(platform, os.path.basename(chat_name), content, dry_run))

        else:
            print(f"  [ERROR] ZIP ingestion not supported for platform: {platform}")

    return results


def collect_files(directory: str, exts: list[str]) -> list[str]:
    d = Path(directory)
    if not d.is_dir():
        print(f"ERROR: Directory not found: {directory}")
        sys.exit(1)

    files = sorted(
        str(f) for f in d.iterdir()
        if f.is_file()
        and not f.name.startswith('.')
        and '.reset.' not in f.name  # skip OpenClaw session reset backups
        and (not exts or any(f.suffix.lower() == e for e in exts))
    )
    return files


def print_stats():
    try:
        resp = requests.get(f"{ARCHIVE_URL}/api/archive/stats", timeout=15)
        if resp.ok:
            s = resp.json()
            total = s.get('total_messages', 0)
            by_platform = s.get('by_platform', {})
            date_range = s.get('date_range', {})
            print(f"\n--- Archive totals ---")
            print(f"  Total messages : {total:,}")
            if by_platform:
                for plat, cnt in sorted(by_platform.items()):
                    print(f"  {plat:<12}: {cnt:,}")
            if date_range.get('earliest'):
                print(f"  Date range     : {date_range['earliest']} → {date_range['latest']}")
    except Exception:
        pass  # stats are informational only


def main():
    parser = argparse.ArgumentParser(
        description="Ingest transcripts into the Archive worker",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--platform', required=True,
                        choices=['openclaw', 'chatgpt', 'claude', 'gemini', 'vscode', 'grok', 'mistral'],
                        help='Transcript format / companion source')
    parser.add_argument('--file', help='Single file to ingest')
    parser.add_argument('--dir',  help='Directory of files to ingest')
    parser.add_argument('--ext',  help='Override file extension filter (e.g. .md)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be ingested without sending anything')
    args = parser.parse_args()

    exts = [args.ext] if args.ext else PLATFORM_EXTS.get(args.platform, [])

    # Handle ZIP files directly
    if args.file and args.file.lower().endswith('.zip'):
        if args.platform not in ('grok', 'mistral'):
            print(f"ERROR: ZIP ingestion only supported for grok and mistral (got: {args.platform})")
            sys.exit(1)
        mode = "[DRY RUN] " if args.dry_run else ""
        print(f"{mode}Platform: {args.platform} | ZIP: {os.path.basename(args.file)}")
        print(f"Target: {ARCHIVE_URL}\n")
        print(f"Extracting: {args.file}")
        results = ingest_zip(args.platform, args.file, args.dry_run)
        total_inserted = sum(r.get('inserted', 0) for r in results if not r.get('error'))
        total_skipped  = sum(r.get('skipped', 0)  for r in results if not r.get('error'))
        errors         = sum(1 for r in results if r.get('error'))
        if not args.dry_run:
            print(f"\nRun summary: {total_inserted} inserted, {total_skipped} skipped, {errors} errors")
            print_stats()
        return

    if args.file:
        files = [args.file]
    elif args.dir:
        files = collect_files(args.dir, exts)
    else:
        print("ERROR: Provide --file or --dir")
        sys.exit(1)

    if not files:
        print("No matching files found.")
        sys.exit(0)

    mode = "[DRY RUN] " if args.dry_run else ""
    print(f"{mode}Platform: {args.platform} | Files: {len(files)}")
    print(f"Target: {ARCHIVE_URL}\n")

    total_inserted = 0
    total_skipped  = 0
    errors         = 0

    for fp in files:
        print(f"Ingesting: {os.path.basename(fp)}")
        result = ingest_file(args.platform, fp, args.dry_run)
        if result.get('error'):
            errors += 1
        else:
            total_inserted += result.get('inserted', 0)
            total_skipped  += result.get('skipped',  0)

    if not args.dry_run:
        print(f"\nRun summary: {total_inserted} inserted, {total_skipped} skipped, {errors} errors")
        print_stats()


if __name__ == '__main__':
    main()
