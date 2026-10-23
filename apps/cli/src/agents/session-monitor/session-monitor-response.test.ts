import { describe, expect, it } from 'vitest';
import { parseSessionMonitorDecision } from './session-monitor-response';

describe('parseSessionMonitorDecision', () => {
  it.each([
    [
      'continue',
      {
        disposition: 'CONTINUE',
        content: 'Proceeding.',
        continuationCompletion: { action: 'NEXT' },
      },
      ['NEXT'],
    ],
    [
      'defer',
      { disposition: 'DEFER', content: 'Please decide.', reasoning: 'The choice is ambiguous.' },
      [],
    ],
  ])('parses a valid %s disposition', (_name, decision, actions) => {
    expect(parseSessionMonitorDecision(JSON.stringify(decision), actions)).toEqual({
      ok: true,
      value: decision,
    });
  });

  it('rejects model-selected release', () => {
    expect(
      parseSessionMonitorDecision(
        JSON.stringify({ disposition: 'RELEASE', reasoning: 'Nothing applies.' }),
        [],
      ).ok,
    ).toBe(false);
  });

  it('requires action-bearing continuation when actions exist', () => {
    expect(
      parseSessionMonitorDecision(
        JSON.stringify({
          disposition: 'CONTINUE',
          content: 'Proceeding.',
          continuationCompletion: { response: 'Proceed.' },
        }),
        ['NEXT'],
      ).ok,
    ).toBe(false);
  });

  it('requires response-only continuation when actions are empty', () => {
    expect(
      parseSessionMonitorDecision(
        JSON.stringify({
          disposition: 'CONTINUE',
          content: 'Proceeding.',
          continuationCompletion: { action: 'NEXT' },
        }),
        [],
      ).ok,
    ).toBe(false);
  });

  it('keeps grouped report selections in response text', () => {
    expect(
      parseSessionMonitorDecision(
        JSON.stringify({
          disposition: 'CONTINUE',
          content: 'I selected the supplied choices.',
          continuationCompletion: {
            response:
              'Scheduled reporting scope: Keep current scope. Export access: Limit exports to administrators.',
          },
        }),
        [],
      ),
    ).toEqual({
      ok: true,
      value: {
        disposition: 'CONTINUE',
        content: 'I selected the supplied choices.',
        continuationCompletion: {
          response:
            'Scheduled reporting scope: Keep current scope. Export access: Limit exports to administrators.',
        },
      },
    });
  });

  it('rejects a report choice used as a synthetic action', () => {
    expect(
      parseSessionMonitorDecision(
        JSON.stringify({
          disposition: 'CONTINUE',
          content: 'I selected the supplied choice.',
          continuationCompletion: { action: 'keep' },
        }),
        [],
      ).ok,
    ).toBe(false);
  });

  it('rejects prose without a decision object', () => {
    expect(parseSessionMonitorDecision('I cannot decide.', [])).toEqual({
      ok: false,
      error: 'Exactly one JSON object is required',
    });
  });

  it('accepts one complete fenced JSON object', () => {
    expect(
      parseSessionMonitorDecision(
        '```json\n{"disposition":"DEFER","content":"Please decide.","reasoning":"Ambiguous."}\n```',
        [],
      ).ok,
    ).toBe(true);
  });

  it('rejects prose surrounding an otherwise valid object', () => {
    expect(
      parseSessionMonitorDecision(
        'Decision: {"disposition":"DEFER","content":"Please decide.","reasoning":"Ambiguous."}',
        [],
      ).ok,
    ).toBe(false);
  });
});
