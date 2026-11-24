/**
 * Redacts captured Antigravity transcripts in place so they can be committed.
 *
 * Usage: tsx src/scripts/redact-antigravity-fixtures.ts [dir]
 *   dir defaults to src/agent-runtime/node/__fixtures__/antigravity
 *
 * Handles *.ndjson (one JSON frame per line) and *.json (print reads, sidecars).
 * Idempotent: running it again on redacted files changes nothing.
 */
import { userInfo } from 'node:os';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  type AgentEventLogRedactionConfig,
  redactAgentEventForLog,
  redactSensitiveText,
} from '../agents/providers/agent-event-redaction.js';

const DEFAULT_DIR = 'src/agent-runtime/node/__fixtures__/antigravity';
const REDACTED = '[REDACTED]';

/** Keys that hold credentials. Deliberately narrower than the runtime defaults: `token`, `key`
 * and `diff` would blank token usage counts and tool diffs, which are the evidence we capture. */
const FIXTURE_CONFIG: AgentEventLogRedactionConfig = {
  enabled: true,
  maxStringLength: Number.POSITIVE_INFINITY,
  redactedKeys: new Set(['authorization', 'cookie', 'password', 'secret', 'api_key', 'apikey']),
};

const SENSITIVE_HEADER = /^(authorization|cookie|x-api-key|x-[a-z-]*-id)$/i;
const OS_USERNAME = new RegExp(`\\b${userInfo().username}\\b`, 'g');
const TMP_ROOT = /\/(?:private\/)?var\/folders\/[^/\s"'\\]+\/[^/\s"'\\]+\/T/g;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isHeaderPair = (value: Json): value is { name: string; value: string } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof value['name'] === 'string' &&
  typeof value['value'] === 'string';

function scrub(value: Json): Json {
  if (typeof value === 'string') {
    return redactSensitiveText(value).replace(TMP_ROOT, '/tmp').replace(OS_USERNAME, '<user>');
  }
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isHeaderPair(value) && SENSITIVE_HEADER.test(value.name)) {
    return { ...value, value: REDACTED };
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrub(entry)]));
}

function redactDocument(value: Json): Json {
  const keyRedacted = redactAgentEventForLog({ value }, FIXTURE_CONFIG)['value'] as Json;
  return scrub(keyRedacted);
}

function redactFile(path: string): void {
  const source = readFileSync(path, 'utf8');

  if (path.endsWith('.ndjson')) {
    const lines = source
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.stringify(redactDocument(JSON.parse(line) as Json)));
    writeFileSync(path, `${lines.join('\n')}\n`);
    return;
  }

  writeFileSync(path, `${JSON.stringify(redactDocument(JSON.parse(source) as Json), null, 2)}\n`);
}

const dir = resolve(process.argv[2] ?? DEFAULT_DIR);
const files = readdirSync(dir).filter((name) => name.endsWith('.json') || name.endsWith('.ndjson'));
for (const name of files) {
  redactFile(join(dir, name));
}
console.log(`redacted ${String(files.length)} files in ${dir}`);
