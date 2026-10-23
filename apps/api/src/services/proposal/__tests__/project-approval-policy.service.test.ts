import type { ProjectId } from 'src/types';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';

describe('ProjectApprovalPolicyService', () => {
  it('resolves the complete ordered code-defined policy matrix', async () => {
    const service = new ProjectApprovalPolicyService();

    const policy = await service.resolve(
      '00000000-0000-4000-8000-000000000001' as ProjectId,
    );

    expect(policy.requiredApprovals).toBe(1);
    expect(policy.rules).toHaveLength(16);
    expect(
      policy.rules.map(({ match, config }) => ({ match, config })),
    ).toEqual([
      rule(
        'GOAL',
        undefined,
        'user',
        'UPDATE',
        undefined,
        undefined,
        true,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        'GOAL',
        undefined,
        'user',
        'UPDATE',
        undefined,
        undefined,
        undefined,
        true,
        'PROJECT_REQUIRED',
        true,
      ),
      rule(
        'DESIGN_DOC',
        undefined,
        'user',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        'DESIGN_DOC',
        undefined,
        'agent',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'PROJECT_REQUIRED',
        false,
      ),
      rule(
        'PLAN_STAGE',
        undefined,
        'user',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        'PLAN_STAGE',
        undefined,
        'agent',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'PROJECT_REQUIRED',
        false,
      ),
      rule(
        'WORK_ITEM_TYPE',
        undefined,
        'user',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        'WORK_ITEM_TYPE',
        undefined,
        'agent',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'PROJECT_REQUIRED',
        false,
      ),
      rule(
        'TASK_MONITOR',
        undefined,
        'user',
        'UPDATE',
        undefined,
        undefined,
        undefined,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        'FEATURE',
        true,
        'agent',
        undefined,
        'shared-generate-features',
        undefined,
        undefined,
        true,
        'FIXED_REQUIRED',
        false,
        1,
      ),
      rule(
        'FEATURE',
        true,
        'user',
        undefined,
        undefined,
        true,
        undefined,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        'FEATURE',
        true,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        true,
        'PROJECT_REQUIRED',
        false,
      ),
      rule(
        'FEATURE',
        true,
        'user',
        undefined,
        undefined,
        false,
        undefined,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        'FEATURE',
        true,
        'agent',
        undefined,
        undefined,
        false,
        undefined,
        true,
        'PROJECT_REQUIRED',
        false,
      ),
      rule(
        undefined,
        false,
        'user',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'IMMEDIATE',
        true,
      ),
      rule(
        undefined,
        false,
        'agent',
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'PROJECT_REQUIRED',
        false,
      ),
    ]);
    expect(policy.fallback).toEqual({
      requiresProposal: false,
      threshold: { policy: 'PROJECT_REQUIRED' },
      allowsProposerApproval: false,
    });
  });

  it('returns isolated policy documents for different projects', async () => {
    const service = new ProjectApprovalPolicyService();

    const first = await service.resolve(
      '00000000-0000-4000-8000-000000000001' as ProjectId,
    );
    const second = await service.resolve(
      '00000000-0000-4000-8000-000000000002' as ProjectId,
    );

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.rules).not.toBe(second.rules);
    expect(first.rules[0]).not.toBe(second.rules[0]);
  });
});

function rule(
  entityType: string | undefined,
  topLevel: boolean | undefined,
  source: 'user' | 'agent' | undefined,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | undefined,
  toolName: string | undefined,
  hasContentChange: boolean | undefined,
  statusOnlyChange: boolean | undefined,
  requiresProposal: boolean,
  thresholdPolicy: 'IMMEDIATE' | 'PROJECT_REQUIRED' | 'FIXED_REQUIRED',
  allowsProposerApproval: boolean,
  fixedRequiredApprovals?: number,
) {
  return {
    match: {
      entity: {
        ...(entityType === undefined ? {} : { type: entityType }),
        ...(topLevel === undefined ? {} : { topLevel }),
      },
      proposal: {
        ...(source === undefined ? {} : { source }),
        ...(action === undefined ? {} : { action }),
        ...(toolName === undefined ? {} : { toolName }),
        ...(hasContentChange === undefined ? {} : { hasContentChange }),
        ...(statusOnlyChange === undefined ? {} : { statusOnlyChange }),
      },
    },
    config: {
      requiresProposal,
      threshold:
        thresholdPolicy === 'FIXED_REQUIRED'
          ? {
              policy: thresholdPolicy,
              requiredApprovals: fixedRequiredApprovals,
            }
          : { policy: thresholdPolicy },
      allowsProposerApproval,
    },
  };
}
