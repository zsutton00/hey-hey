/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { buildMcpHeaders } from '../../agents/mcp-server-config';
import { evalJudgeHandler } from '../../agents/run-eval/eval-judge.handler';
import { ReadRestriction } from './generated/api';
import { readRestrictionFor, restrictedConfiguration } from './read-restriction';

const token = `header.${Buffer.from(JSON.stringify({ organizationId: 'org-1' })).toString('base64url')}.signature`;

describe('the read restriction of an execution', () => {
  it('follows the Run: an inert Run is an evaluated attempt, the judge reads without grading reports', () => {
    expect(readRestrictionFor({ inert: true })).toBe(ReadRestriction.EvalTarget);
    expect(readRestrictionFor({ judge: true })).toBe(ReadRestriction.EvalJudge);
    expect(readRestrictionFor({ inert: true, judge: true })).toBe(ReadRestriction.EvalTarget);
    expect(readRestrictionFor({ inert: false })).toBeUndefined();
    expect(readRestrictionFor({})).toBeUndefined();
  });

  it('rides every platform MCP call as a header the model cannot supply or clear', () => {
    expect(buildMcpHeaders(token, { inert: true })['X-Read-Restriction']).toBe('EVAL_TARGET');
    expect(buildMcpHeaders(token, { inert: false })).not.toHaveProperty('X-Read-Restriction');
    expect(
      buildMcpHeaders(token, { readRestriction: evalJudgeHandler.readRestriction })[
        'X-Read-Restriction'
      ],
    ).toBe('EVAL_JUDGE');
  });

  it('rides every REST read made for the model while keeping the caller’s other options', () => {
    const restricted = restrictedConfiguration(
      { accessToken: 'token', baseOptions: { timeout: 15000, headers: { 'X-Other': '1' } } },
      ReadRestriction.EvalTarget,
    );

    expect(restricted.baseOptions).toEqual({
      timeout: 15000,
      headers: { 'X-Other': '1', 'X-Read-Restriction': 'EVAL_TARGET' },
    });
    const unrestricted = restrictedConfiguration({ baseOptions: { timeout: 1 } }, undefined);

    expect(unrestricted.baseOptions.timeout).toBe(1);
    expect(unrestricted.baseOptions.headers).not.toHaveProperty('X-Read-Restriction');
  });
});
