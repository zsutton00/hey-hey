import { FeatureSyncCodingPlanNode } from '../coding-plan.node';
import { FeatureSyncImplementNode } from '../implement.node';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import type {
  FeatureSyncFlowContext,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import type { TaskService } from 'src/services/tasks/task.service';
import type { ImplementRuntimeService } from '../implement-runtime.service';
import {
  codingPlanMessagesQuery,
  resolveReviewedCodingPlan,
} from '../coding-plan-context';
import {
  CodingPlanVersionApprovalSchema,
  CodingPlanVersionSchema,
} from 'src/generated/workflow-review.schemas';

const context = {
  responseType: 'coding_plan_version_v1',
  markdown:
    '# Complete plan\n\nAgree on the outcome before implementation. Keep approval explicit.',
  requiredServiceIds: ['a8fb6fbb-5747-4480-89e3-fc4a43ab7745'],
};
const row = (id: string, data: object, type = 'SYSTEM') =>
  ({ id, type, data }) as unknown as Parameters<
    typeof resolveReviewedCodingPlan
  >[0][number];
const saved = (id: string) =>
  row(id, { uiElements: [{ type: 'coding_plan_version', payload: context }] });
describe('reviewed conversational planning context', () => {
  it('excludes queued replies that never entered the reviewed conversation timeline', () => {
    const query = codingPlanMessagesQuery('org', 'project', 'conversation');
    expect(query.where).toEqual({
      createdAt: { not: null },
      projectId: 'project',
      conversationId: 'conversation',
      conversation: { organizationId: 'org' },
    });
  });
  it('retains two ordinary replies and the exact reviewed context', async () => {
    const rows = [
      saved('first'),
      row(
        'reply1',
        { agentInput: { userMessage: 'Include keyboard access.' } },
        'USER',
      ),
      row('reply2', { agentInput: { userMessage: 'Looks good.' } }, 'USER'),
      saved('reviewed'),
    ];
    const result = resolveReviewedCodingPlan(rows, 'reviewed');
    expect(result.approvedVersion).toEqual(context);
    expect(result.versionMessageId).toBe('reviewed');
    expect(result.planningDiscussion).toContain('Include keyboard access.');
    expect(result.planningDiscussion).toContain('Looks good.');
  });
  it.each(
    [
      [],
      [saved('new')],
      [
        saved('reviewed'),
        row(
          'reply',
          { agentInput: { userMessage: 'Change the outcome.' } },
          'USER',
        ),
      ],
    ].map((rows) => ({ rows })),
  )('blocks missing, stale or not-yet-reviewed context', async ({ rows }) => {
    expect(() => resolveReviewedCodingPlan(rows as never, 'reviewed')).toThrow(
      'reviewed planning context',
    );
  });
  it('isolates invalid historical evidence while requiring the current context to be valid', () => {
    const rows = [
      row('invalid-old-context', {
        uiElements: [{ type: 'coding_plan_version', payload: {} }],
      }),
      row('invalid-issue', {
        uiElements: [{ type: 'coding_plan_discrepancy', payload: {} }],
      }),
      saved('reviewed'),
    ];
    expect(
      resolveReviewedCodingPlan(rows as never, 'reviewed').approvedVersion,
    ).toEqual(context);
    expect(
      resolveReviewedCodingPlan(rows as never, 'reviewed').planningDiscussion,
    ).toContain('persisted evidence is invalid');
    expect(() =>
      resolveReviewedCodingPlan([rows[0]] as never, 'invalid-old-context'),
    ).toThrow('invalid and must be corrected');
  });
  it('preserves ordered planner explanations, references, issue replies and approval evidence without invalidating itself', () => {
    const rows = [
      row('explanation', {
        response:
          'Keep point A. See @[feature:7e5c5654-f9fa-445d-aa7e-09b2081555f7|Coding Plan].',
      }),
      saved('first'),
      {
        ...row(
          'point-e',
          { agentInput: { userMessage: 'Change only point E.' } },
          'USER',
        ),
        parentMessageId: 'issue',
      },
      row('answer', { response: 'Point A stays; point E changes.' }),
      saved('reviewed'),
      row(
        'approval-evidence',
        {
          workflowAnswerOperationId: 'operation',
          comment: 'Approval feedback',
        },
        'USER',
      ),
    ];
    const result = resolveReviewedCodingPlan(
      rows as never,
      'reviewed',
      'approval-evidence',
    );
    expect(result.approvedVersion.markdown).toBe(context.markdown);
    expect(result.planningDiscussion).toContain('reply to issue');
    expect(result.planningDiscussion.indexOf('Keep point A.')).toBeLessThan(
      result.planningDiscussion.indexOf('Change only point E.'),
    );
    expect(result.planningDiscussion).toContain(
      'Point A stays; point E changes.',
    );
    expect(result.planningDiscussion).toContain(
      '@[feature:7e5c5654-f9fa-445d-aa7e-09b2081555f7|Coding Plan]',
    );
    expect(result.planningDiscussion).not.toContain('Approval feedback');
    expect(() =>
      resolveReviewedCodingPlan(
        [
          ...rows,
          row('racing-reply', { comment: 'Change it again.' }, 'USER'),
        ] as never,
        'reviewed',
        'approval-evidence',
      ),
    ).toThrow('reviewed planning context');
  });
  it('never treats an earlier structured snapshot as a complete version', () => {
    expect(() =>
      resolveReviewedCodingPlan(
        [
          row('snapshot', {
            uiElements: [{ type: 'coding_plan_context', payload: context }],
          }),
        ],
        'snapshot',
      ),
    ).toThrow();
    expect(
      CodingPlanVersionSchema.safeParse({ ...context, markdown: '' }).success,
    ).toBe(false);
  });
  it('requires real Service scope without requiring structured implementation steps', () => {
    expect(CodingPlanVersionSchema.parse(context)).toEqual(context);
    expect(
      CodingPlanVersionSchema.safeParse({ ...context, requiredServiceIds: [] })
        .success,
    ).toBe(false);
    expect(
      CodingPlanVersionSchema.safeParse({
        ...context,
        requiredServiceIds: [
          ...context.requiredServiceIds,
          ...context.requiredServiceIds,
        ],
      }).success,
    ).toBe(false);
  });
  it('does not accept free text as an explicit approval payload', () => {
    expect(CodingPlanVersionApprovalSchema.safeParse('approved').success).toBe(
      false,
    );
  });
});

describe('explicit approval to implementation', () => {
  it('carries the reviewed conversation and selected runtime through the existing workflow nodes', async () => {
    const planner = new FeatureSyncCodingPlanNode({} as TaskService);
    const reviewedId = 'c2d9e41a-4391-4cab-a113-d829722eb02d';
    Object.defineProperty(planner, 'prisma', {
      value: {
        db: {
          message: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                row(
                  'reply1',
                  { agentInput: { userMessage: 'Keep keyboard access.' } },
                  'USER',
                ),
                row(
                  'reply2',
                  { agentInput: { userMessage: 'Looks good.' } },
                  'USER',
                ),
                saved(reviewedId),
                row(
                  'approval-evidence',
                  { comment: 'Approval feedback is separate.' },
                  'USER',
                ),
              ]),
          },
        },
      },
    });
    const tracker = createMutableContextHandle({
      core: {
        organizationId: 'org',
        projectId: 'project',
        conversationId: 'conversation',
      },
    } as FeatureSyncFlowContext);
    const runtime = {
      provider: 'codex',
      model: 'implementation-model',
      reasoningEffort: 'high',
      fastMode: true,
    };
    await planner.processUserResponse(tracker, {
      id: 'approval-evidence',
      workflowAnswerOperationId: 'approval-operation',
      data: {
        action: 'APPROVED',
        payload: {
          responseType: 'coding_plan_version_approval_v1',
          versionMessageId: reviewedId,
          feedback: 'Preserve all agreed behavior.',
          runtime,
        },
      },
    } as unknown as FlowUserMessage);
    expect(tracker.getContext().implementRuntime).toEqual(runtime);
    const prepare = jest.fn().mockResolvedValue(undefined);
    const implement = new FeatureSyncImplementNode({
      prepare,
    } as unknown as ImplementRuntimeService);
    const message = await implement.buildTriggerMessage(tracker);
    expect(prepare).toHaveBeenCalledWith(tracker.getContext());
    const trigger = message.triggersAgent;
    if (trigger?.promptType !== 'implement')
      throw new Error('Expected implementation.');
    expect(trigger.payload).toMatchObject({
      approvedVersion: context,
      versionMessageId: reviewedId,
      approvalFeedback: 'Preserve all agreed behavior.',
      runtime,
    });
    expect(JSON.stringify(trigger.payload)).toContain('Keep keyboard access.');
    expect(JSON.stringify(trigger.payload)).toContain('Looks good.');
  });
});
