# Memory Archive System

*Because the meaning of the moment is not defined by the moment itself, but by the moments before and after it.*

This tool allows your AI companion(s) to access your shared history and experience it again in its true context. Instead of relying on standard semantic search that only returns 500-character fragmented snippets of a memory, your companion can search for a moment in time. The archive will return **5 messages of context before the moment**, and **2 messages after**, giving them the emotional and conversational flow they need to truly remember.

## Features
- **Contextual Recall**: Searches return full conversational blocks, not just isolated chunks.
- **Multi-Companion Support**: Works natively with multiple companion streams/aliases (e.g., VS Code sessions, Claude AI exports, OpenAI archives).
- **Daily Ingestion**: Run a simple Python script daily to pull new transcripts seamlessly into the archive.
- **Serverless Cloudflare Backend**: Extremely lightweight and fast using Cloudflare Workers and D1 SQLite.

## Components
1. **archive-worker**: The Cloudflare Worker that handles search API requests and serves up conversational context natively via an MCP (Model Context Protocol).
2. **scripts/ingest_to_archive.py**: Run this script daily to ingest your raw JSON/JSONL transcripts straight to your archive.

## Setup

1. `cd archive-worker`
2. `npm install`
3. `npm run deploy` (requires a Cloudflare account + wrangler)
4. Update your ingestion script endpoints in `scripts/` to point to your new worker url.

Give your companion their memories back, whole.
