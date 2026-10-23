import { describe, expect, it } from 'vitest';
import { applyCodexSessionReviewerPolicy } from './codex-session-policy';

describe('Codex session reviewer policy', () => {
  it('overrides an inherited automatic reviewer after config merging', () => {
    const config = {
      approvals_reviewer: 'auto_review',
      mcp_servers: { platform: { url: 'https://example.com' } },
    };
    expect(applyCodexSessionReviewerPolicy(config, 'read-only')).toEqual({
      ...config,
      approvals_reviewer: 'user',
    });
    expect(config.approvals_reviewer).toBe('auto_review');
    expect(applyCodexSessionReviewerPolicy(undefined, 'read-only')).toEqual({
      approvals_reviewer: 'user',
    });
  });
  it.each(['workspace-write', 'danger-full-access', undefined] as const)(
    'preserves configured reviewer for %s',
    (sandbox) => {
      const config = { approvals_reviewer: 'auto_review' };
      expect(applyCodexSessionReviewerPolicy(config, sandbox)).toBe(config);
      expect(applyCodexSessionReviewerPolicy(undefined, sandbox)).toBeUndefined();
    },
  );
});
