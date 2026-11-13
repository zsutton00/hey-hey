import { createMockPrismaService } from 'src/utils/testUtils';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProjectApprovalPolicyStore } from '../project-approval-policy.store';
import { ProjectApprovalPolicyValidation } from '../project-approval-policy.validation';
import { createDefaultProjectApprovalPolicy } from '../project-approval-policy.service';
import {
  evaluatePermissions,
  type ProposalContext,
} from '../permission-evaluation';
import type { ProjectApprovalPolicyRule } from 'src/generated';
import { createTestProjectApprovalPolicyService } from 'src/utils/testUtils';
import type { ProjectId } from 'src/types';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';

describe('ProjectApprovalPolicyService', () => {
  it('resolves the complete ordered code-defined policy matrix', async () => {
    const service = createTestProjectApprovalPolicyService();

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
    const service = createTestProjectApprovalPolicyService();

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

describe('persisted project rule resolution', () => {
  const projectId = '00000000-0000-4000-8000-000000000001' as ProjectId;
  const otherProjectId = '00000000-0000-4000-8000-000000000002' as ProjectId;
  const savedRule = {
    conditions: {
      typeKey: 'MARKETING',
      author: 'USER',
      action: 'UPDATE',
      change: 'STATUS_ONLY',
    },
    requirement: 'IMMEDIATE',
    requiredApprovals: 0,
    allowsProposerApproval: true,
  } satisfies ProjectApprovalPolicyRule;

  function resolver(rules: unknown, activeTypes = ['MARKETING', 'FEATURE']) {
    const prisma = createMockPrismaService();
    prisma.db.$queryRaw.mockImplementation(async (_sql, id) =>
      id === projectId ? [{ revision: 7, rules }] : [],
    );
    return new ProjectApprovalPolicyService(
      new ProjectApprovalPolicyStore(prisma as unknown as PrismaService),
      new ProjectApprovalPolicyValidation({
        isTypeActiveForProject: (key) => activeTypes.includes(key),
      }),
    );
  }

  it('enforces saved canonical/custom rules, fixed precedence and independent default counts', async () => {
    const service = resolver([
      savedRule,
      {
        ...savedRule,
        conditions: { typeKey: 'MARKETING', change: 'CONTENT_CHANGE' },
        requirement: 'PROJECT_REQUIRED',
        requiredApprovals: 3,
        allowsProposerApproval: false,
      },
      {
        ...savedRule,
        conditions: { typeKey: 'FEATURE' },
        requirement: 'PROJECT_REQUIRED',
        requiredApprovals: 4,
      },
    ]);
    const policy = await service.resolve(projectId);
    expect(policy.rules.every((rule) => rule.source !== undefined)).toBe(true);
    expect(
      policy.rules.filter((rule) => rule.source === 'PROJECT'),
    ).toHaveLength(3);
    const entity = {
      type: 'MARKETING',
      parentTaskId: null,
      initiativeId: null,
    };
    const proposal = {
      source: 'user',
      action: 'UPDATE',
      authorId: 'alice',
      eligibleProjectMemberIds: ['alice', 'bob', 'charlie', 'dana'],
      toolName: null,
      changedFields: ['status'],
    } satisfies ProposalContext;
    expect(evaluatePermissions(entity, proposal, policy).threshold).toBe(0);
    expect(
      evaluatePermissions(
        entity,
        { ...proposal, changedFields: ['status', 'sections.description'] },
        policy,
      ).threshold,
    ).toBe(3);
    expect(
      evaluatePermissions(
        { ...entity, type: 'FEATURE' },
        {
          ...proposal,
          source: 'agent',
          toolName: 'shared-generate-features',
          action: 'CREATE',
        },
        policy,
      ).threshold,
    ).toBe(1);
    expect(
      evaluatePermissions(
        { ...entity, type: 'FEATURE' },
        { ...proposal, source: 'agent' },
        policy,
      ).threshold,
    ).toBe(4);
    expect(
      evaluatePermissions(
        { ...entity, type: 'GOAL' },
        { ...proposal, changedFields: ['name'] },
        policy,
      ).threshold,
    ).toBe(1);
    expect(
      evaluatePermissions(
        { ...entity, type: 'SERVICE' },
        { ...proposal, source: 'agent' },
        policy,
      ),
    ).toMatchObject({ requiresProposal: false, threshold: 1 });
    expect(await service.snapshot(projectId)).toMatchObject({
      revision: 7,
      hasProjectOverride: true,
    });
    expect(await service.resolve(otherProjectId)).toEqual(
      createDefaultProjectApprovalPolicy(),
    );
  });

  it('keeps applying a saved rule after its type is retired', async () => {
    const service = resolver([savedRule], ['FEATURE']);
    const policy = await service.resolve(projectId);
    expect(
      policy.rules.filter((rule) => rule.source === 'PROJECT'),
    ).toHaveLength(1);
    expect(
      evaluatePermissions(
        { type: 'MARKETING', parentTaskId: null, initiativeId: null },
        {
          source: 'user',
          action: 'UPDATE',
          authorId: 'alice',
          eligibleProjectMemberIds: ['alice', 'bob'],
          toolName: null,
          changedFields: ['status'],
        },
        policy,
      ).threshold,
    ).toBe(0);
    expect(await service.snapshot(projectId)).toMatchObject({ revision: 7 });
  });

  it('applies a saved Feature Top-level condition and reports it in the explanation', async () => {
    const featureRule = (topLevel?: boolean) => ({
      conditions: {
        typeKey: 'FEATURE',
        author: 'USER',
        ...(topLevel === undefined ? {} : { topLevel }),
      },
      requirement: 'PROJECT_REQUIRED',
      requiredApprovals: 5,
      allowsProposerApproval: false,
    });
    const proposal = {
      source: 'user',
      action: 'UPDATE',
      authorId: 'alice',
      eligibleProjectMemberIds: ['alice', 'bob'],
      toolName: null,
      changedFields: ['status'],
    } satisfies ProposalContext;
    const topLevelFeature = {
      type: 'FEATURE',
      parentTaskId: null,
      initiativeId: 'an-initiative',
    };
    const nestedFeature = { ...topLevelFeature, parentTaskId: 'parent' };

    const topOnly = await resolver([featureRule(true)]).resolve(projectId);
    expect(
      evaluatePermissions(topLevelFeature, proposal, topOnly).threshold,
    ).toBe(5);
    expect(
      evaluatePermissions(nestedFeature, proposal, topOnly).threshold,
    ).not.toBe(5);

    const nestedOnly = await resolver([featureRule(false)]).resolve(projectId);
    expect(
      evaluatePermissions(nestedFeature, proposal, nestedOnly).threshold,
    ).toBe(5);
    expect(
      evaluatePermissions(topLevelFeature, proposal, nestedOnly).threshold,
    ).not.toBe(5);

    const any = await resolver([featureRule()]).resolve(projectId);
    expect(evaluatePermissions(topLevelFeature, proposal, any).threshold).toBe(
      5,
    );
    expect(evaluatePermissions(nestedFeature, proposal, any).threshold).toBe(5);

    const snapshot = await resolver([featureRule(true)]).snapshot(projectId);
    expect(
      snapshot.rules.find((rule) => rule.source === 'PROJECT')?.conditions,
    ).toEqual({ typeKey: 'FEATURE', author: 'USER', topLevel: true });
  });

  it('accepts Top-level on a Feature rule and rejects it on other rules', () => {
    const validation = new ProjectApprovalPolicyValidation({
      isTypeActiveForProject: () => true,
    });
    const withConditions = (conditions: object) => ({
      expectedRevision: 0,
      rules: [{ ...savedRule, conditions }],
    });

    expect(
      validation.replacement(
        withConditions({ typeKey: 'FEATURE', topLevel: false }),
        projectId,
        null,
      ).rules[0]?.conditions.topLevel,
    ).toBe(false);

    for (const conditions of [
      { topLevel: true },
      { typeKey: 'MARKETING', topLevel: true },
    ]) {
      expect(() =>
        validation.replacement(withConditions(conditions), projectId, null),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            issues: [
              expect.objectContaining({
                path: '/rules/0/conditions/topLevel',
              }),
            ],
          }),
        }),
      );
    }
  });

  it.each([
    [{ secret: 'never log this' }],
    [[{ ...savedRule, requirement: 'IMMEDIATE', requiredApprovals: 2 }]],
  ])(
    'fails malformed saved data without poisoning another project',
    async (rules) => {
      const service = resolver(rules);
      await expect(service.resolve(projectId)).rejects.toThrow(
        'Saved project approval policy is invalid',
      );
      await expect(service.snapshot(projectId)).rejects.toThrow(
        'Saved project approval policy is invalid',
      );
      await expect(service.resolve(otherProjectId)).resolves.toEqual(
        createDefaultProjectApprovalPolicy(),
      );
    },
  );
});
