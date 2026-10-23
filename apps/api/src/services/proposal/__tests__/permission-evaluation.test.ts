import {
  AUTO_APPROVED,
  evaluatePermissions as evaluatePermissionsWithPolicy,
  type EntityContext,
  type ProposalContext,
} from '../permission-evaluation';
import { createDefaultProjectApprovalPolicy } from '../project-approval-policy.service';

const DEFAULT_PROJECT_POLICY = createDefaultProjectApprovalPolicy();
const projectPolicyRequiring = createDefaultProjectApprovalPolicy;

const evaluatePermissions = (
  entity: EntityContext,
  proposal: ProposalContext,
  projectPolicy = DEFAULT_PROJECT_POLICY,
) => evaluatePermissionsWithPolicy(entity, proposal, projectPolicy);

const TASK_NON_TOP: EntityContext = {
  type: 'TASK',
  parentTaskId: '00000000-0000-4000-8000-000000000aaa',
  initiativeId: null,
};

const FEATURE_NON_TOP: EntityContext = {
  type: 'FEATURE',
  parentTaskId: '00000000-0000-4000-8000-000000000aaa',
  initiativeId: null,
};

const FEATURE_TOP: EntityContext = {
  type: 'FEATURE',
  parentTaskId: null,
  initiativeId: null,
};

const TASK_TOP: EntityContext = {
  type: 'TASK',
  parentTaskId: null,
  initiativeId: null,
};

const TASK_INITIATIVE_ONLY: EntityContext = {
  type: 'TASK',
  parentTaskId: null,
  initiativeId: '00000000-0000-4000-8000-000000000bbb',
};

const GOAL: EntityContext = {
  type: 'GOAL',
  parentTaskId: null,
  initiativeId: null,
};

const TASK_MONITOR: EntityContext = {
  type: 'TASK_MONITOR',
  parentTaskId: null,
  initiativeId: null,
};

const DESIGN_DOC: EntityContext = {
  type: 'DESIGN_DOC',
  parentTaskId: null,
  initiativeId: null,
};

const ROOT_NON_TASK_PROPOSAL_ENTITIES: readonly EntityContext[] = [
  DESIGN_DOC,
  { type: 'PLAN_STAGE', parentTaskId: null, initiativeId: null },
  { type: 'WORK_ITEM_TYPE', parentTaskId: null, initiativeId: null },
] as const;

const authorId = '00000000-0000-4000-8000-000000000111';
const otherMemberId = '00000000-0000-4000-8000-000000000222';

const userCtx = (changedFields: string[] = []): ProposalContext => ({
  source: 'user',
  action: 'UPDATE',
  authorId,
  eligibleProjectMemberIds: [authorId, otherMemberId],
  toolName: null,
  changedFields,
});

const agentCtx = (
  changedFields: string[] = [],
  toolName: string | null = null,
): ProposalContext => ({
  source: 'agent',
  action: 'UPDATE',
  authorId,
  eligibleProjectMemberIds: [authorId, otherMemberId],
  toolName,
  changedFields,
});

describe('evaluatePermissions', () => {
  it('does not retain policies for the removed PLAN_STEP entity family', () => {
    expect(
      DEFAULT_PROJECT_POLICY.rules.some(
        (rule) => rule.match.entity?.type === 'PLAN_STEP',
      ),
    ).toBe(false);
  });

  it('interprets supplied rules and fallback without evaluator-owned outcomes', () => {
    const customPolicy = {
      requiredApprovals: 4,
      rules: [
        {
          match: { entity: { type: 'GOAL' } },
          config: {
            requiresProposal: false,
            threshold: { policy: 'FIXED_REQUIRED', requiredApprovals: 2 },
            allowsProposerApproval: false,
          },
        },
      ],
      fallback: {
        requiresProposal: true,
        threshold: { policy: 'IMMEDIATE' },
        allowsProposerApproval: true,
      },
    } as const;

    expect(evaluatePermissions(GOAL, userCtx(), customPolicy)).toEqual({
      requiresProposal: false,
      threshold: 2,
      allowsProposerApproval: false,
    });
    expect(evaluatePermissions(TASK_TOP, userCtx(), customPolicy)).toEqual({
      requiresProposal: true,
      threshold: AUTO_APPROVED,
      allowsProposerApproval: true,
    });
  });

  it('rejects invalid fixed thresholds from a resolved policy', () => {
    const invalidPolicy = {
      ...createDefaultProjectApprovalPolicy(),
      rules: [
        {
          match: {},
          config: {
            requiresProposal: true,
            threshold: { policy: 'FIXED_REQUIRED', requiredApprovals: 0 },
            allowsProposerApproval: false,
          },
        },
      ],
    } as const;

    expect(() => evaluatePermissions(GOAL, userCtx(), invalidPolicy)).toThrow(
      'Fixed approval requirements must be positive integers',
    );
  });

  it('applies a user-authored GOAL status-only update on create', () => {
    const result = evaluatePermissions(GOAL, userCtx(['status']));

    expect(result).toEqual({
      requiresProposal: true,
      threshold: AUTO_APPROVED,
      allowsProposerApproval: true,
    });
  });

  it('routes a user-authored GOAL update through the explicit one-member policy', () => {
    const result = evaluatePermissions(GOAL, userCtx(['name']));

    expect(result).toEqual({
      requiresProposal: true,
      threshold: 1,
      allowsProposerApproval: true,
    });
  });

  it('uses the resolved project policy for human-review rules', () => {
    const result = evaluatePermissions(
      DESIGN_DOC,
      agentCtx(),
      projectPolicyRequiring(3),
    );

    expect(result).toEqual({
      requiresProposal: true,
      threshold: 3,
      allowsProposerApproval: false,
    });
  });

  it('keeps threshold-zero carve-outs auto-approved under a multi-approval policy', () => {
    const result = evaluatePermissions(
      TASK_NON_TOP,
      userCtx(),
      projectPolicyRequiring(3),
    );

    expect(result.threshold).toBe(AUTO_APPROVED);
    expect(result.allowsProposerApproval).toBe(true);
  });

  it('does not apply the GOAL update rule to GOAL creation', () => {
    const result = evaluatePermissions(GOAL, {
      ...userCtx(['name']),
      action: 'CREATE',
    });

    expect(result).toEqual({
      requiresProposal: false,
      threshold: 1,
      allowsProposerApproval: false,
    });
  });

  it('auto-applies user-authored TASK_MONITOR updates', () => {
    const result = evaluatePermissions(
      TASK_MONITOR,
      userCtx(['sections.executionDefinition']),
    );

    expect(result).toEqual({
      requiresProposal: true,
      threshold: AUTO_APPROVED,
      allowsProposerApproval: true,
    });
  });

  it('keeps agent-authored TASK_MONITOR updates behind human review', () => {
    const result = evaluatePermissions(
      TASK_MONITOR,
      agentCtx(['sections.executionDefinition']),
    );

    expect(result).toEqual({
      requiresProposal: false,
      threshold: 1,
      allowsProposerApproval: false,
    });
  });

  it('does not apply the TASK_MONITOR update rule to creation', () => {
    const result = evaluatePermissions(TASK_MONITOR, {
      ...userCtx(['sections.executionDefinition']),
      action: 'CREATE',
    });

    expect(result).toEqual({
      requiresProposal: false,
      threshold: 1,
      allowsProposerApproval: false,
    });
  });

  it('reduces the GOAL update threshold to one for one eligible member', () => {
    const result = evaluatePermissions(GOAL, {
      ...userCtx(['name']),
      eligibleProjectMemberIds: [authorId],
    });

    expect(result.threshold).toBe(1);
    expect(result.allowsProposerApproval).toBe(true);
  });

  it('does not allow proposer credit when the user author is not eligible', () => {
    const result = evaluatePermissions(GOAL, {
      ...userCtx(['name']),
      eligibleProjectMemberIds: [otherMemberId],
    });

    expect(result.threshold).toBe(1);
    expect(result.allowsProposerApproval).toBe(false);
  });

  it('leaves an agent-authored GOAL update pending for one human', () => {
    const result = evaluatePermissions(GOAL, {
      ...agentCtx(['name']),
      eligibleProjectMemberIds: [authorId],
    });

    expect(result.threshold).toBe(1);
    expect(result.allowsProposerApproval).toBe(false);
  });

  it('keeps mixed GOAL status and content updates on the one-member policy', () => {
    const result = evaluatePermissions(GOAL, userCtx(['status', 'name']));

    expect(result.threshold).toBe(1);
    expect(result.allowsProposerApproval).toBe(true);
  });

  it('fails when eligible membership context is missing', () => {
    expect(() =>
      evaluatePermissions(GOAL, {
        ...userCtx(),
        eligibleProjectMemberIds: [],
      }),
    ).toThrow(
      'Permission evaluation requires at least one server-resolved eligible project member',
    );
  });

  it('TASK non-top + user → threshold 0 (apply-on-create)', () => {
    const result = evaluatePermissions(TASK_NON_TOP, userCtx());
    expect(result.threshold).toBe(0);
    expect(result.requiresProposal).toBe(true);
    expect(result.allowsProposerApproval).toBe(true);
  });

  it('FEATURE non-top + user → threshold 0 (apply-on-create)', () => {
    const result = evaluatePermissions(FEATURE_NON_TOP, userCtx());
    expect(result.threshold).toBe(0);
    expect(result.requiresProposal).toBe(true);
    expect(result.allowsProposerApproval).toBe(true);
  });

  it('FEATURE top + user editing name → AUTO_APPROVED (user save = user approval)', () => {
    const result = evaluatePermissions(FEATURE_TOP, userCtx(['name']));
    expect(result.threshold).toBe(AUTO_APPROVED);
    expect(result.requiresProposal).toBe(true);
    expect(result.allowsProposerApproval).toBe(true);
  });

  it('FEATURE top + user editing sections.description → AUTO_APPROVED', () => {
    const result = evaluatePermissions(
      FEATURE_TOP,
      userCtx(['sections.description']),
    );
    expect(result.threshold).toBe(AUTO_APPROVED);
  });

  it('FEATURE top + user editing sections.requirements → AUTO_APPROVED', () => {
    const result = evaluatePermissions(
      FEATURE_TOP,
      userCtx(['sections.requirements']),
    );
    expect(result.threshold).toBe(AUTO_APPROVED);
  });

  it('FEATURE top + user editing sections.acceptanceCriteria → AUTO_APPROVED', () => {
    const result = evaluatePermissions(
      FEATURE_TOP,
      userCtx(['sections.acceptanceCriteria']),
    );
    expect(result.threshold).toBe(AUTO_APPROVED);
  });

  it('FEATURE top + user editing only status → threshold 0 (non-content)', () => {
    const result = evaluatePermissions(FEATURE_TOP, userCtx(['status']));
    expect(result.threshold).toBe(0);
    expect(result.requiresProposal).toBe(true);
  });

  it('FEATURE top + user editing only priority → threshold 0', () => {
    const result = evaluatePermissions(FEATURE_TOP, userCtx(['priority']));
    expect(result.threshold).toBe(0);
  });

  it('FEATURE top + user editing only assigneeId/dueDate → threshold 0', () => {
    const result = evaluatePermissions(
      FEATURE_TOP,
      userCtx(['assigneeId', 'dueDate']),
    );
    expect(result.threshold).toBe(0);
  });

  it('FEATURE top + user editing status AND name → AUTO_APPROVED (user content change auto-applies)', () => {
    const result = evaluatePermissions(
      FEATURE_TOP,
      userCtx(['status', 'name']),
    );
    expect(result.threshold).toBe(AUTO_APPROVED);
  });

  it('FEATURE top + agent editing name → threshold 1 (agent content changes require human approval)', () => {
    const result = evaluatePermissions(FEATURE_TOP, agentCtx(['name']));
    expect(result.threshold).toBe(1);
  });

  it('keeps shared-generate-features fixed at one under a higher project policy', () => {
    const result = evaluatePermissions(
      FEATURE_TOP,
      agentCtx(['name', 'sections.description'], 'shared-generate-features'),
      projectPolicyRequiring(3),
    );
    expect(result.threshold).toBe(1);
    expect(result.requiresProposal).toBe(true);
  });

  it('uses the higher project policy for other agent-authored feature content changes', () => {
    const result = evaluatePermissions(
      FEATURE_TOP,
      agentCtx(['name'], 'some-other-mcp-tool'),
      projectPolicyRequiring(3),
    );
    expect(result.threshold).toBe(3);
  });

  it('FEATURE non-top + agent from shared-generate-features → threshold 1 (carve-out does not override non-top rule)', () => {
    const result = evaluatePermissions(
      FEATURE_NON_TOP,
      agentCtx(['name'], 'shared-generate-features'),
    );
    expect(result.threshold).toBe(1);
  });

  it('FEATURE top + agent editing only status → threshold 1 (agent default for non-content)', () => {
    const result = evaluatePermissions(FEATURE_TOP, agentCtx(['status']));
    expect(result.threshold).toBe(1);
  });

  it('TASK non-top + agent → threshold 1 (single human approval)', () => {
    const result = evaluatePermissions(TASK_NON_TOP, agentCtx());
    expect(result.threshold).toBe(1);
    expect(result.requiresProposal).toBe(true);
  });

  it('FEATURE non-top + agent → threshold 1 (single human approval)', () => {
    const result = evaluatePermissions(FEATURE_NON_TOP, agentCtx());
    expect(result.threshold).toBe(1);
    expect(result.requiresProposal).toBe(true);
  });

  it('TASK orphan (no parent, no initiative) + user → falls through to default (threshold 1, requiresProposal false)', () => {
    const result = evaluatePermissions(TASK_TOP, userCtx());
    expect(result.threshold).toBe(1);
    expect(result.requiresProposal).toBe(false);
    expect(result.allowsProposerApproval).toBe(false);
  });

  it('TASK orphan + agent → falls through to default', () => {
    const result = evaluatePermissions(TASK_TOP, agentCtx());
    expect(result.threshold).toBe(1);
    expect(result.requiresProposal).toBe(false);
  });

  it('TASK with initiativeId but no parent + user → threshold 0 (apply-on-create)', () => {
    const result = evaluatePermissions(TASK_INITIATIVE_ONLY, userCtx());
    expect(result.threshold).toBe(0);
    expect(result.requiresProposal).toBe(true);
  });

  it('TASK with initiativeId but no parent + agent → threshold 1', () => {
    const result = evaluatePermissions(TASK_INITIATIVE_ONLY, agentCtx());
    expect(result.threshold).toBe(1);
    expect(result.requiresProposal).toBe(true);
  });

  it.each(ROOT_NON_TASK_PROPOSAL_ENTITIES)(
    '%s + user → explicit apply-on-create/update policy with proposer approval',
    (entity) => {
      const result = evaluatePermissions(entity, userCtx());
      expect(result.threshold).toBe(AUTO_APPROVED);
      expect(result.requiresProposal).toBe(true);
      expect(result.allowsProposerApproval).toBe(true);
    },
  );

  it.each(ROOT_NON_TASK_PROPOSAL_ENTITIES)(
    '%s + agent → explicit one-human approval policy',
    (entity) => {
      const result = evaluatePermissions(entity, agentCtx());
      expect(result.threshold).toBe(1);
      expect(result.requiresProposal).toBe(true);
      expect(result.allowsProposerApproval).toBe(false);
    },
  );

  it('does not count an ineligible user author for root non-task proposal entities', () => {
    const result = evaluatePermissions(DESIGN_DOC, {
      ...userCtx(),
      eligibleProjectMemberIds: [otherMemberId],
    });
    expect(result.threshold).toBe(AUTO_APPROVED);
    expect(result.requiresProposal).toBe(true);
    expect(result.allowsProposerApproval).toBe(false);
  });
});
