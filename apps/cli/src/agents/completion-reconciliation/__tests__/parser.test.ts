import { describe, expect, it } from 'vitest';
import { isStructuredCompletionResponse, parseCompletionResponse } from '../parser';

describe('completion response parser', () => {
  const value = { response: 'Ordinary reply' };
  it.each([JSON.stringify(value), `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``])(
    'parses plain or fenced JSON',
    (text) => {
      expect(parseCompletionResponse(text)).toEqual({ ok: true, value });
    },
  );
  it.each([
    ['Plain reply', 'Plain reply'],
    ['  Plain reply with whitespace  ', 'Plain reply with whitespace'],
    ['"JSON string reply"', 'JSON string reply'],
    [
      'Changed [parser.ts] and returned {legacy output}.',
      'Changed [parser.ts] and returned {legacy output}.',
    ],
    ['```\nLegacy fenced response [with Markdown]\n```', 'Legacy fenced response [with Markdown]'],
    ['{', '{'],
    ['prefix {"response":"Done"}', 'prefix {"response":"Done"}'],
  ])('parses a legacy string response: %s', (text, response) => {
    expect(parseCompletionResponse(text)).toEqual({ ok: true, value: { response } });
  });
  it.each(['', '{}', 'null', '{"response":""}', '{"featureUpdateSyncCheck":null}'])(
    'rejects malformed primary completion: %s',
    (text) => {
      expect(parseCompletionResponse(text).ok).toBe(false);
    },
  );

  it.each([
    ['omitted', undefined],
    ['explicit null', null],
    ['malformed', {}],
    [
      'populated',
      {
        feature: { entityType: 'FEATURE', entityId: '33333333-3333-4333-8333-333333333333' },
        explanation: 'Delivered behavior changed.',
      },
    ],
  ])('unwraps an older envelope whose feature metadata is %s', (_label, featureUpdateSyncCheck) => {
    const candidate = {
      response: 'Done',
      ...(featureUpdateSyncCheck !== undefined ? { featureUpdateSyncCheck } : {}),
    };
    const text = JSON.stringify(candidate);
    expect(isStructuredCompletionResponse(text)).toBe(true);
    expect(parseCompletionResponse(text)).toEqual({ ok: true, value: { response: 'Done' } });
  });

  it.each([null, { feature: { entityType: 'FEATURE' }, explanation: 'Changed.' }])(
    'repairs multiline envelopes consistently for detection and completion (%j)',
    (check) => {
      const response =
        'First paragraph with "quoted text" and C:\\code.\n\nSecond paragraph.\r\nLast line.';
      const raw = JSON.stringify({ response, featureUpdateSyncCheck: check })
        .replaceAll('\\n', '\n')
        .replaceAll('\\r', '\r');
      for (const text of [raw, `\`\`\`json\n${raw}\n\`\`\``]) {
        expect(isStructuredCompletionResponse(text)).toBe(true);
        expect(parseCompletionResponse(text)).toEqual({ ok: true, value: { response } });
      }
    },
  );
});

describe('structured completion response detection', () => {
  it('recognizes only schema-valid JSON envelopes', () => {
    expect(isStructuredCompletionResponse(JSON.stringify({ response: 'Done' }))).toBe(true);
    expect(isStructuredCompletionResponse('Ordinary unstructured response')).toBe(false);
    expect(isStructuredCompletionResponse(JSON.stringify('Ordinary JSON string'))).toBe(false);
  });
});
