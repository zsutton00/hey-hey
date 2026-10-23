import { describe, expect, it } from 'vitest';
import { parseTaskMonitorDecision } from './task-monitor-response';

const requestChanges = {
  action: 'REQUEST_CHANGES',
  rationale: 'The implementation evidence leaves one required behavior unverified.',
  guidance: 'Address the missing behavior and report the canonical verification result.',
} as const;

const accepted = {
  action: 'ACCEPT_TASK',
  rationale: 'The canonical implementation evidence supports accepting the selected Task.',
} as const;

const decisions = [
  {
    name: 'REQUEST_REVIEW',
    value: {
      action: 'REQUEST_REVIEW',
      rationale: 'Policy requires Review.',
    },
  },
  { name: 'REQUEST_CHANGES', value: requestChanges },
  { name: 'ACCEPT_TASK', value: accepted },
  { name: 'WAIT', value: { action: 'WAIT', rationale: 'Canonical evidence is settling.' } },
  {
    name: 'REQUEST_JUDGMENT',
    value: {
      action: 'REQUEST_JUDGMENT',
      rationale: 'A user choice is required.',
      guidance: 'Choose A or B.',
    },
  },
  {
    name: 'HALT',
    value: {
      action: 'HALT',
      rationale: 'Supervision cannot continue.',
      failureContext: 'Authoritative contracts conflict.',
    },
  },
] as const;

describe('parseTaskMonitorDecision', () => {
  for (const fixture of decisions) {
    it(`parses the ${fixture.name} decision arm`, () => {
      const result = parseTaskMonitorDecision(JSON.stringify(fixture.value));

      expect(result).toEqual({ ok: true, value: fixture.value });
    });
  }

  it('parses one complete fenced JSON object', () => {
    expect(
      parseTaskMonitorDecision(`\`\`\`json\n${JSON.stringify(requestChanges)}\n\`\`\``),
    ).toEqual({ ok: true, value: requestChanges });
  });

  it('rejects missing request-changes guidance', () => {
    expect(
      parseTaskMonitorDecision(
        JSON.stringify({
          action: 'REQUEST_CHANGES',
          rationale: requestChanges.rationale,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_VALIDATION_FAILED' },
    });
  });

  it('rejects empty rationale and guidance', () => {
    expect(
      parseTaskMonitorDecision(
        JSON.stringify({ action: 'REQUEST_CHANGES', rationale: '', guidance: '' }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_VALIDATION_FAILED' },
    });
  });

  it('rejects the removed assessment and progression fields', () => {
    expect(
      parseTaskMonitorDecision(
        JSON.stringify({
          ...accepted,
          currentTaskAssessment: { outcome: 'FULFILLED' },
          progression: { kind: 'START_NEXT_TASK' },
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: expect.stringContaining('LocalTaskMonitorCoordinatorDecision'),
      },
    });
  });

  it('rejects a removed discriminator value', () => {
    expect(
      parseTaskMonitorDecision(
        JSON.stringify({ action: 'CONTINUE_SESSION', rationale: 'Legacy decision.' }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_VALIDATION_FAILED' },
    });
  });

  it('rejects guidance on ACCEPT_TASK', () => {
    expect(
      parseTaskMonitorDecision(
        JSON.stringify({ ...accepted, guidance: 'Legacy continuation guidance.' }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_VALIDATION_FAILED' },
    });
  });

  it('rejects two plain JSON values', () => {
    const value = JSON.stringify(requestChanges);
    expect(parseTaskMonitorDecision(`${value}\n${value}`)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_JSON' },
    });
  });

  it('rejects surrounding prose', () => {
    expect(
      parseTaskMonitorDecision(`Decision follows:\n${JSON.stringify(requestChanges)}\nDone.`),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_JSON' },
    });
  });

  it('rejects an additional fenced value', () => {
    const value = JSON.stringify(requestChanges);
    expect(
      parseTaskMonitorDecision(`\`\`\`json\n${value}\n\`\`\`\n\`\`\`json\n${value}\n\`\`\``),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ENVELOPE' },
    });
  });

  it('rejects an incomplete or surrounded JSON fence', () => {
    const value = JSON.stringify(requestChanges);
    expect(parseTaskMonitorDecision(`before\n\`\`\`json\n${value}\n\`\`\``)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ENVELOPE' },
    });
  });

  it('rejects unsupported fields without coercion or repair', () => {
    expect(
      parseTaskMonitorDecision(
        JSON.stringify({
          ...accepted,
          lifecycleEffect: 'COMPLETE_TASK',
          readiness: true,
          dependencyGate: true,
          handoff: true,
          mission: true,
          waiting: true,
          judgment: true,
          halt: true,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_VALIDATION_FAILED' },
    });
  });

  it('does not repair malformed JSON', () => {
    expect(parseTaskMonitorDecision("{ action: 'WAIT', rationale: 'repair me' }")).toMatchObject({
      ok: false,
      error: { code: 'INVALID_JSON' },
    });
  });
});

it('accepts long rationale while retaining action-specific guidance limits', () => {
  expect(
    parseTaskMonitorDecision(
      JSON.stringify({ action: 'REQUEST_REVIEW', rationale: 'Evidence. '.repeat(1000) }),
    ),
  ).toMatchObject({ ok: true });
  const rejected = parseTaskMonitorDecision(
    JSON.stringify({
      action: 'REQUEST_CHANGES',
      rationale: 'Evidence.',
      guidance: 'x'.repeat(5001),
    }),
  );
  expect(rejected).toMatchObject({
    ok: false,
    error: {
      code: 'SCHEMA_VALIDATION_FAILED',
      issues: ['/guidance must NOT have more than 5000 characters'],
    },
  });
});
