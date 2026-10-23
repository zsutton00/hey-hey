import { describe, expect, it } from 'vitest';
import type { RepositoryGroundingSuccess } from '../../shared/agent-bridge-contract/generated/api';
import { parseRepositoryAnalysisCompletion } from './schemas';

const success = {
  outcome: 'success',
  serviceId: '44444444-4444-4444-8444-444444444444',
  provider: 'codex',
  resolvedFrontierModel: 'gpt-frontier',
  narrative: 'Customers manage their accounts.',
  hierarchy: {
    topLevels: [
      {
        id: 'account-management',
        name: 'Account Management',
        description: 'Customers manage their accounts.',
        tag: 'product',
        children: [
          {
            id: 'account-settings',
            name: 'Account Settings',
            description: 'Customers configure their accounts.',
            tag: 'frontend',
          },
        ],
      },
    ],
  },
  evidence: [
    {
      path: 'src/accounts.ts',
      summary: 'Account behavior is implemented here.',
      lineStart: 4,
      lineEnd: 20,
    },
  ],
  briefDiscrepancies: [
    {
      summary: 'Administrative roles were not found.',
      rationale: 'The investigated evidence only supports customer roles.',
      material: true,
      evidencePaths: ['src/accounts.ts'],
    },
  ],
} satisfies RepositoryGroundingSuccess;

describe('repository grounding completion schema', () => {
  it('parses a canonical success with every optional nested field', () => {
    expect(parseRepositoryAnalysisCompletion(success)).toEqual({ ok: true, value: success });
  });

  it.each([
    ['hierarchy', { ...success, hierarchy: success.hierarchy.topLevels }, 'hierarchy'],
    [
      'briefDiscrepancies',
      {
        ...success,
        briefDiscrepancies: [
          {
            brief: 'Administrative roles exist.',
            evidence: 'No administrative roles found.',
            uncertainty: 'low',
            evidencePaths: ['src/accounts.ts'],
          },
        ],
      },
      '/briefDiscrepancies/0/summary',
    ],
  ])('rejects the observed incompatible %s shape at %s', (_field, value, expectedPath) => {
    const parsed = parseRepositoryAnalysisCompletion(value);
    expect(parsed).toMatchObject({ ok: false });
    if (parsed.ok) throw new Error('Expected completion parsing to fail.');
    expect(parsed.error).toContain(`${expectedPath}:`);
    expect(parsed.error).not.toBe('completion: Invalid input');
  });

  it.each(['limits', 'omissions', 'confidence', 'rationale', 'coherenceChanges'])(
    'rejects removed analysis bookkeeping field %s',
    (field) => {
      const parsed = parseRepositoryAnalysisCompletion({
        ...success,
        [field]: field === 'confidence' ? 0.9 : [],
      });
      expect(parsed).toMatchObject({ ok: false });
      if (parsed.ok) throw new Error('Expected completion parsing to fail.');
      expect(parsed.error).toContain(`/${field}: must NOT have additional properties`);
    },
  );

  it.each([
    [success, 'success'],
    [
      {
        outcome: 'retryable_failure',
        code: 'provider_timeout',
        message: 'The provider timed out.',
        retryAfterSeconds: 30,
      },
      'retryable_failure',
    ],
    [
      {
        outcome: 'terminal_failure',
        code: 'access_denied',
        message: 'Repository access was denied.',
      },
      'terminal_failure',
    ],
  ])('accepts the %s completion branch', (value, outcome) => {
    expect(parseRepositoryAnalysisCompletion(value)).toMatchObject({
      ok: true,
      value: { outcome },
    });
  });

  it.each([
    [{ ...success, message: 'Failure-only field.' }, 'message'],
    [
      {
        outcome: 'retryable_failure',
        code: 'provider_timeout',
        message: 'The provider timed out.',
        narrative: 'Success-only field.',
      },
      'narrative',
    ],
    [
      {
        outcome: 'terminal_failure',
        code: 'access_denied',
        message: 'Repository access was denied.',
        retryAfterSeconds: 30,
      },
      'retryAfterSeconds',
    ],
  ])('rejects fields from another completion branch: %s', (value, unexpectedField) => {
    const parsed = parseRepositoryAnalysisCompletion(value);
    expect(parsed).toMatchObject({ ok: false });
    if (parsed.ok) throw new Error('Expected completion parsing to fail.');
    expect(parsed.error).toContain(`/${unexpectedField}: must NOT have additional properties`);
  });

  it('reports a concrete discriminator diagnostic before branch validation', () => {
    expect(parseRepositoryAnalysisCompletion({ code: 'provider_timeout' })).toEqual({
      ok: false,
      error: '/outcome: must be a supported outcome',
    });
  });
});
