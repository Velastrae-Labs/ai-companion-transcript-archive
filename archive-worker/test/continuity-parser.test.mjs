import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ingestSource = readFileSync(new URL('../src/handlers/ingest.ts', import.meta.url), 'utf8');
const toolsSource = readFileSync(new URL('../src/tools.ts', import.meta.url), 'utf8');
const parserSource = readFileSync(new URL('../src/parsers/continuity.ts', import.meta.url), 'utf8');

test('archive ingest exposes continuity as a first-class platform', () => {
  assert.match(ingestSource, /parseContinuity/);
  assert.match(ingestSource, /case 'continuity'/);
  assert.match(toolsSource, /'continuity'/);
});

test('continuity parser preserves source timestamp and companion id', () => {
  assert.match(parserSource, /normalizeTimestamp\(String\(event\.created_at/);
  assert.match(parserSource, /companionId = String\(event\.companion_id/);
  assert.match(parserSource, /llm_platform: 'continuity'/);
  assert.match(parserSource, /continuity_event_id/);
});
