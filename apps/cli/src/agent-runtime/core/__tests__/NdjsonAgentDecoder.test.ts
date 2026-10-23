import { describe, expect, it, vi } from 'vitest';
import { NdjsonAgentDecoder } from '../NdjsonAgentDecoder';

describe('NdjsonAgentDecoder', () => {
  it('handles partial NDJSON lines across chunks', () => {
    const decoder = new NdjsonAgentDecoder();

    const firstPass = decoder.decode(
      '{"type":"assistant","text":"hello"}\n{"type":"assistant","text":"wor',
    );
    const secondPass = decoder.decode('ld"}\n');

    expect(firstPass).toHaveLength(1);
    expect(firstPass[0]?.type).toBe('assistant');
    expect(firstPass[0]?.content[0]?.payload).toBe('hello');
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0]?.content[0]?.payload).toBe('world');
  });

  it('emits parse errors for malformed JSON', () => {
    const decoder = new NdjsonAgentDecoder();

    const messages = decoder.decode('{"type":"assistant"\n');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('error');
    expect(messages[0]?.subtype).toBe('parse_error');
  });

  it('logs parse failures with line context', () => {
    const logger = {
      warn: vi.fn(),
    };
    const decoder = new NdjsonAgentDecoder({ logger });

    decoder.decode('{"type":"assistant"\n');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to parse NDJSON line',
      expect.objectContaining({
        line: '{"type":"assistant"',
      }),
    );
  });

  it('emits malformed payload errors for non-object values', () => {
    const decoder = new NdjsonAgentDecoder();

    const messages = decoder.decode('"just-a-string"\n');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('error');
    expect(messages[0]?.subtype).toBe('malformed_payload');
  });

  it('logs malformed payloads', () => {
    const logger = {
      warn: vi.fn(),
    };
    const decoder = new NdjsonAgentDecoder({ logger });

    decoder.decode('"just-a-string"\n');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Decoded NDJSON payload is not an object',
      expect.objectContaining({
        payloadType: 'string',
      }),
    );
  });

  it('normalizes user/tool messages as tool events', () => {
    const decoder = new NdjsonAgentDecoder();

    const messages = decoder.decode(
      '{"type":"user","subtype":"tool","session_id":"sess-1","content":{"name":"edit"}}\n',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('tool');
    expect(messages[0]?.sessionId).toBe('sess-1');
    expect(messages[0]?.content[0]?.kind).toBe('tool');
  });

  it('does not log for valid payloads', () => {
    const logger = {
      warn: vi.fn(),
    };
    const decoder = new NdjsonAgentDecoder({ logger });

    const messages = decoder.decode('{"type":"assistant","text":"ok"}\n');

    expect(messages).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
