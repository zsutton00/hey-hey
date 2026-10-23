/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexDecoder } from '../CodexDecoder';

const readFixture = (filename: string): string =>
  readFileSync(join(process.cwd(), 'src/agent-runtime/node/__fixtures__', filename), 'utf8');

describe('CodexDecoder', () => {
  it('normalizes codex lifecycle, tool, and result events', () => {
    const decoder = new CodexDecoder();
    const fixture = readFixture('codex-sample.ndjson');
    const messages = [...decoder.decode(fixture), ...decoder.flush()];

    expect(messages).toHaveLength(7);
    expect(messages[0]?.type).toBe('system');
    expect(messages[0]?.subtype).toBe('task_started');
    expect(messages[1]?.type).toBe('assistant');
    expect(messages[1]?.sessionId).toBe('codex-sess-1');

    expect(messages[2]?.type).toBe('tool');
    expect(messages[2]?.subtype).toBe('exec_approval_request');
    expect(messages[2]?.sessionId).toBe('codex-sess-1');

    expect(messages[3]?.type).toBe('result');
    expect(messages[3]?.subtype).toBe('exec_command_end');
    expect(messages[5]?.type).toBe('result');
    expect(messages[5]?.subtype).toBe('patch_apply_end');
    expect(messages[6]?.type).toBe('system');
    expect(messages[6]?.subtype).toBe('task_complete');
  });

  it('keeps parse error behavior from base NDJSON decoder', () => {
    const decoder = new CodexDecoder();
    const messages = decoder.decode('{"type":"agent_message"\n');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('error');
    expect(messages[0]?.subtype).toBe('parse_error');
  });
});
