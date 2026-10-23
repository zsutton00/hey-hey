import { LocalPromptType } from 'src/generated/local';
import { SecondaryActionPayload, WorkflowReviewAction } from 'src/generated';
import {
  FlowUserMessage,
  NodeType,
  PlanFromDesignDocFlowContext,
  validateExternalAgentCompletion,
} from 'src/types/flow-internal.types';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import * as TestUtils from 'src/utils/testUtils';
import { PLAN_SHAPING_NODES } from '../../../constants/node-ids';
import { FEATURE_SYNC_ACTIONS } from '../../feature-sync/schemas';
import type { FeatureSyncDiscrepancy } from '../../shared/feature-sync-discrepancy';
import { PlanShapingFeatureSyncAnalyzeNode } from '../feature-sync-analyze.node';
import { PlanShapingFeatureSyncIterateNode } from '../feature-sync-iterate.node';
import { PlanShapingFeatureSyncReviewNode } from '../feature-sync-review.node';
import {
  PLAN_SHAPING_ACTIONS,
  planShapingFeatureSyncAnalyzeActions,
  planShapingFeatureSyncIterateActions,
  planShapingFeatureSyncReviewActions,
} from '../schemas';
import type {
  PlanFromDesignDocSeed,
  PlanFromDesignDocSeedService,
} from 'src/services/plan/plan-from-design-doc-seed.service';

const VALID_DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';
const VALID_PLAN_ID = '22222222-2222-4222-8222-222222222222';

const buildContext = (
  overrides: Partial<PlanFromDesignDocFlowContext> = {},
): PlanFromDesignDocFlowContext =>
  TestUtils.createMockFlowContext({
    flowId: 'plan-from-design-doc',
    ...overrides,
  }) as PlanFromDesignDocFlowContext;

const buildSeedStub = (
  overrides: Partial<PlanFromDesignDocSeed> = {},
): PlanFromDesignDocSeedService => {
  const seed: PlanFromDesignDocSeed = {
    planId: VALID_PLAN_ID as never,
    planTitle: 'Seed plan title',
    designDocId: VALID_DESIGN_DOC_ID as never,
    ...overrides,
  };
  return {
    resolve: jest.fn().mockResolvedValue(seed),
  } as unknown as PlanFromDesignDocSeedService;
};

const buildAgentMessage = (data: Record<string, unknown>): FlowUserMessage =>
  TestUtils.createMockFlowUserMessage({ data });

const buildDiscrepancy = (
  overrides: Partial<FeatureSyncDiscrepancy> = {},
): FeatureSyncDiscrepancy => ({
  summary: 'Auth stage missing from plan',
  rationale: 'The design doc declares an auth stage the plan omits.',
  entityType: 'FEATURE',
  entityId: 'feature-1',
  proposal: 'Add an auth stage before checkout.',
  ...overrides,
});

describe('PlanShapingFeatureSyncAnalyzeNode', () => {
  let node: PlanShapingFeatureSyncAnalyzeNode;

  beforeEach(() => {
    node = new PlanShapingFeatureSyncAnalyzeNode(buildSeedStub());
  });

  it('emits an EXTERNAL_AGENT result carrying a plan_shaping_feature_sync_analyze trigger on entry', async () => {
    const tracker = createMutableContextHandle(buildContext());

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.triggersAgent?.promptType).toBe(
      LocalPromptType.plan_shaping_feature_sync_analyze,
    );
    expect(result.triggersAgent?.nodeId).toBe(
      PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
    );
  });

  it('resolves planId/designDocId from the seed service and threads them onto the trigger payload', async () => {
    const tracker = createMutableContextHandle(buildContext());

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.planId).toBe(VALID_PLAN_ID);
    expect(payload.designDocId).toBe(VALID_DESIGN_DOC_ID);
  });

  it('declares the NO_DISCREPANCY and DISCREPANCY action schemas', () => {
    expect(node.actions).toBe(planShapingFeatureSyncAnalyzeActions);
    expect(Object.keys(node.actions).sort()).toEqual(
      [
        FEATURE_SYNC_ACTIONS.NO_DISCREPANCY,
        FEATURE_SYNC_ACTIONS.DISCREPANCY,
      ].sort(),
    );
  });

  it('validates NO_DISCREPANCY via the EXTERNAL_AGENT engine validator (no payload)', () => {
    const result = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
      actions: node.actions,
      message: buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY,
      }),
    });
    expect(result.action).toBe(FEATURE_SYNC_ACTIONS.NO_DISCREPANCY);
  });

  it('on DISCREPANCY, saves the flagged items on flow context with stable fs-N ids in order', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncPendingDecisions: [{ itemId: 'fs-9', choice: 'accept' }],
      }),
    );

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
        payload: {
          discrepancies: [
            buildDiscrepancy({ summary: 'a' }),
            buildDiscrepancy({ summary: 'b' }),
          ],
        },
      }),
    );

    const ctx = tracker.getContext();
    expect(
      ctx.featureSyncDiscrepancies?.map(({ id, summary }) => ({ id, summary })),
    ).toEqual([
      { id: 'fs-1', summary: 'a' },
      { id: 'fs-2', summary: 'b' },
    ]);
    expect(ctx.featureSyncPendingDecisions).toBeUndefined();
  });

  it('leaves context untouched on NO_DISCREPANCY or a malformed DISCREPANCY payload', async () => {
    const tracker = createMutableContextHandle(buildContext());

    await node.processUserResponse(
      tracker,
      buildAgentMessage({ action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY }),
    );
    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
        payload: { discrepancies: [] },
      }),
    );

    expect(tracker.getContext().featureSyncDiscrepancies).toBeUndefined();
  });
});

describe('PlanShapingFeatureSyncIterateNode', () => {
  let node: PlanShapingFeatureSyncIterateNode;

  beforeEach(() => {
    node = new PlanShapingFeatureSyncIterateNode();
  });

  it('emits an EXTERNAL_AGENT result carrying a plan_shaping_feature_sync_iterate trigger on entry', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: [buildDiscrepancy()],
        featureSyncPendingDecisions: [],
      }),
    );

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.triggersAgent?.promptType).toBe(
      LocalPromptType.plan_shaping_feature_sync_iterate,
    );
    expect(result.triggersAgent?.nodeId).toBe(
      PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
    );
  });

  it('threads the saved flagged items (in order, with ids) and the pending per-item decisions onto every trigger, then clears the decisions', async () => {
    const discrepancies = [
      buildDiscrepancy({ id: 'fs-1', summary: 'a' }),
      buildDiscrepancy({ id: 'fs-2', summary: 'b' }),
    ];
    const decisions = [
      { itemId: 'fs-2', choice: 'amend' as const, note: 'Narrower scope' },
    ];
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: discrepancies,
        featureSyncPendingDecisions: decisions,
        featureSyncPendingUserReply: '2',
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload).toEqual({ discrepancies, decisions, userMessage: '2' });
    expect(tracker.getContext().featureSyncPendingDecisions).toBeUndefined();
    expect(tracker.getContext().featureSyncDiscrepancies).toEqual(
      discrepancies,
    );
  });

  it('preserves explicit empty arrays and rejects missing iterate context instead of manufacturing empty arrays', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: [],
        featureSyncPendingDecisions: [],
      }),
    );

    const result = await node.execute(tracker);

    expect(
      (result.triggersAgent as unknown as { payload: Record<string, unknown> })
        .payload,
    ).toEqual({ discrepancies: [], decisions: [] });

    await expect(
      node.execute(
        createMutableContextHandle(
          buildContext({ featureSyncPendingDecisions: [] }),
        ),
      ),
    ).rejects.toThrow(/requires saved featureSyncDiscrepancies/);
    await expect(
      node.execute(
        createMutableContextHandle(
          buildContext({ featureSyncDiscrepancies: [buildDiscrepancy()] }),
        ),
      ),
    ).rejects.toThrow(/requires saved featureSyncPendingDecisions/);
  });

  it('accepts actionless user messages — free-text replies re-fire the loop via the acceptsUserMessages self-loop', () => {
    expect(node.acceptsUserMessages).toBe(true);
  });

  it('on a free-text reply (no action), stashes the text onto featureSyncPendingUserReply for the next trigger to surface', async () => {
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: [buildDiscrepancy()] }),
    );

    await node.processUserResponse(
      tracker,
      TestUtils.createMockFlowUserMessage({
        data: { message: 'Tighten the auth stage wording.' },
      }),
    );

    expect(tracker.getContext().featureSyncPendingUserReply).toBe(
      'Tighten the auth stage wording.',
    );
    expect(tracker.getContext().featureSyncPendingDecisions).toEqual([]);
  });

  it('surfaces featureSyncPendingUserReply as triggerPayload.userMessage and clears it from context', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: [buildDiscrepancy()],
        featureSyncPendingDecisions: [],
        featureSyncPendingUserReply: 'Please fix the auth stage gap.',
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.userMessage).toBe('Please fix the auth stage gap.');
    expect(tracker.getContext().featureSyncPendingUserReply).toBeUndefined();
  });

  it('declares the REVISED, Continue Revising, and Done action schemas — RESOLVED is intentionally absent so the engine validator rejects it', () => {
    expect(node.actions).toBe(planShapingFeatureSyncIterateActions);
    expect(Object.keys(node.actions).sort()).toEqual(
      [
        FEATURE_SYNC_ACTIONS.REVISED,
        WorkflowReviewAction.Refine,
        WorkflowReviewAction.Dismissed,
      ].sort(),
    );
    expect(node.actions[FEATURE_SYNC_ACTIONS.RESOLVED]).toBeUndefined();
  });

  it('validates Continue Revising (request_revisions) via the EXTERNAL_AGENT engine validator — this is the token that was rejected as unknown_action before the fix', () => {
    const result = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
      actions: planShapingFeatureSyncIterateActions,
      message: buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: { feedback: 'Tighten the auth stage wording.' },
      }),
    });
    expect(result.action).toBe(WorkflowReviewAction.Refine);
  });

  it('on Continue Revising (request_revisions), stashes the feedback onto featureSyncPendingUserReply for the next trigger to surface', async () => {
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: [buildDiscrepancy()] }),
    );

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: { feedback: 'Add the missing auth stage.' },
      }),
    );

    expect(tracker.getContext().featureSyncPendingUserReply).toBe(
      'Add the missing auth stage.',
    );
  });

  it('a Continue Revising submission whose payload is missing feedback is rejected by the engine validator as invalid_payload — the node parks for retry rather than stashing a bad reply', () => {
    expect(() =>
      validateExternalAgentCompletion({
        nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        actions: planShapingFeatureSyncIterateActions,
        message: buildAgentMessage({
          action: WorkflowReviewAction.Refine,
          payload: {},
        }),
      }),
    ).toThrow(expect.objectContaining({ reason: 'invalid_payload' }));
  });

  it('RESOLVED is rejected by the engine validator as unknown_action — no agent-keyed path bypasses user review', () => {
    expect(() =>
      validateExternalAgentCompletion({
        nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        actions: planShapingFeatureSyncIterateActions,
        message: buildAgentMessage({ action: FEATURE_SYNC_ACTIONS.RESOLVED }),
      }),
    ).toThrow(expect.objectContaining({ reason: 'unknown_action' }));
  });

  it.each([
    'plan_shaping_feature_sync_review_done',
    'plan_shaping_feature_sync_review_request_revisions',
  ])('rejects legacy From Design Doc action %s', (action) => {
    expect(() =>
      validateExternalAgentCompletion({
        nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        actions: planShapingFeatureSyncIterateActions,
        message: buildAgentMessage({ action, payload: {} }),
      }),
    ).toThrow(expect.objectContaining({ reason: 'unknown_action' }));
  });

  it('accepts an empty REVISED set while retaining the user-owned review gate', () => {
    const result = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
      actions: planShapingFeatureSyncIterateActions,
      message: buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.REVISED,
        payload: { discrepancies: [] },
      }),
    });

    expect(result.action).toBe(FEATURE_SYNC_ACTIONS.REVISED);
    expect(node.actions[FEATURE_SYNC_ACTIONS.RESOLVED]).toBeUndefined();
  });

  it('on REVISED, replaces the saved items while keeping echoed ids stable and numbering new items past the highest known id', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: [
          buildDiscrepancy({ id: 'fs-1', summary: 'one' }),
          buildDiscrepancy({ id: 'fs-2', summary: 'two' }),
          buildDiscrepancy({ id: 'fs-3', summary: 'three' }),
        ],
        featureSyncResolved: false,
        featureSyncSourceMessageId: 'old-message-id',
      }),
    );

    await node.processUserResponse(
      tracker,
      TestUtils.createMockFlowUserMessage({
        data: {
          action: FEATURE_SYNC_ACTIONS.REVISED,
          payload: {
            discrepancies: [
              buildDiscrepancy({ id: 'fs-3', summary: 'three (amended)' }),
              buildDiscrepancy({ summary: 'new' }),
              buildDiscrepancy({ id: 'unknown', summary: 'invented id' }),
            ],
          },
        },
      }),
    );

    const ctx = tracker.getContext();
    expect(
      ctx.featureSyncDiscrepancies?.map(({ id, summary }) => ({ id, summary })),
    ).toEqual([
      { id: 'fs-3', summary: 'three (amended)' },
      { id: 'fs-4', summary: 'new' },
      { id: 'fs-5', summary: 'invented id' },
    ]);
    expect(ctx.featureSyncResolved).toBe(false);
    expect(ctx.featureSyncSourceMessageId).toBe('old-message-id');
  });

  it('on Continue Revising with decisions, stashes them for the next trigger without approving or advancing anything', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: [buildDiscrepancy({ id: 'fs-1' })],
      }),
    );
    const decisions = [{ itemId: 'fs-1', choice: 'dismiss' as const }];
    const message = buildAgentMessage({
      action: WorkflowReviewAction.Refine,
      payload: { feedback: '', decisions },
    });

    const validated = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
      actions: node.actions,
      message,
    });
    expect(validated.action).toBe(WorkflowReviewAction.Refine);
    expect(node.actions[WorkflowReviewAction.Refine]?.waitForUser).toBe(false);

    await node.processUserResponse(tracker, message);

    const ctx = tracker.getContext();
    expect(ctx.featureSyncPendingDecisions).toEqual(decisions);
    expect(ctx.featureSyncDiscrepancies).toHaveLength(1);
    expect(ctx.featureSyncResolved).toBeUndefined();
  });
});

describe('PlanShapingFeatureSyncReviewNode', () => {
  let node: PlanShapingFeatureSyncReviewNode;

  beforeEach(() => {
    node = new PlanShapingFeatureSyncReviewNode();
  });

  it('emits only the plan_shaping_feature_sync_review element plus two buttons — it renders no discrepancy text of its own (the agent turn presents the items)', async () => {
    const discrepancies = [
      buildDiscrepancy({
        summary: 'Auth stage missing from plan',
        entityType: 'FEATURE',
        entityId: 'feature-1',
      }),
      buildDiscrepancy({
        summary: 'Checkout step omitted',
        entityType: 'TASK',
        entityId: 'task-abc',
      }),
    ];
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: discrepancies }),
    );

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.QUESTIONS);
    // The gate is a pure input surface: it outputs the review element and
    // parks. It must NOT re-render the flagged items into its message body.
    expect(result.message).not.toContain('Auth stage missing from plan');
    expect(result.message).not.toContain('Checkout step omitted');
    expect(result.uiElements).toHaveLength(1);
    expect(result.uiElements?.[0]?.type).toBe(
      'plan_shaping_feature_sync_review',
    );

    const secondaryActions = (
      result.data as {
        secondaryActions?: Array<{
          handler?: string;
          label?: string;
          payload?: unknown;
        }>;
      }
    ).secondaryActions;
    expect(secondaryActions).toHaveLength(2);
    const handlerTypes = (secondaryActions ?? []).map(
      (a) => (a.payload as { handlerType?: string }).handlerType,
    );
    expect(handlerTypes.sort()).toEqual(
      [
        SecondaryActionPayload.HandlerTypeEnum.PlanShapingFeatureSyncReviewDone,
        SecondaryActionPayload.HandlerTypeEnum
          .PlanShapingFeatureSyncReviewRequestRevisions,
      ].sort(),
    );

    const revisionAction = (secondaryActions ?? []).find(
      (action) =>
        (action.payload as { handlerType?: string }).handlerType ===
        SecondaryActionPayload.HandlerTypeEnum
          .PlanShapingFeatureSyncReviewRequestRevisions,
    );
    expect(revisionAction).toEqual(
      expect.objectContaining({
        label: 'Revise',
        handler: 'plan_shaping_feature_sync_review_request_revisions',
        payload: {
          handlerType: 'plan_shaping_feature_sync_review_request_revisions',
        },
      }),
    );

    const doneAction = (secondaryActions ?? []).find(
      (action) =>
        (action.payload as { handlerType?: string }).handlerType ===
        SecondaryActionPayload.HandlerTypeEnum.PlanShapingFeatureSyncReviewDone,
    );
    expect(doneAction?.label).toBe('Dismiss');
  });

  it('emits the review element even when no discrepancies are stashed — it carries no stash-derived content', async () => {
    const tracker = createMutableContextHandle(buildContext());

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements?.[0]?.type).toBe(
      'plan_shaping_feature_sync_review',
    );
  });

  it('on done, processUserResponse is a no-op — there is no flow-context stash to clear; routing alone advances the gate', async () => {
    const sourceMessageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const discrepancies = [buildDiscrepancy()];
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: discrepancies,
        featureSyncSourceMessageId: sourceMessageId,
      }),
    );

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Dismissed,
      }),
    );

    expect(tracker.getContext().featureSyncDiscrepancies).toEqual(
      discrepancies,
    );
    expect(tracker.getContext().featureSyncSourceMessageId).toBe(
      sourceMessageId,
    );
  });

  it('determineRoutingFromUserMessage routes done to PROPOSED_STAGES', async () => {
    const context = buildContext({
      featureSyncDiscrepancies: [buildDiscrepancy()],
    });

    const nextId = await node.determineRoutingFromUserMessage(
      context,
      buildAgentMessage({
        action: WorkflowReviewAction.Dismissed,
      }),
    );

    expect(nextId).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
  });

  it('rejects a free-text submission (no action) and leaves the discrepancy stash untouched', async () => {
    const discrepancies = [buildDiscrepancy()];
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: discrepancies }),
    );

    await node.processUserResponse(tracker, buildAgentMessage({}));

    expect(tracker.getContext().featureSyncDiscrepancies).toEqual(
      discrepancies,
    );
  });

  it('rejects an unrecognised action discriminator and leaves the discrepancy stash untouched', async () => {
    const discrepancies = [buildDiscrepancy()];
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: discrepancies }),
    );

    await node.processUserResponse(
      tracker,
      buildAgentMessage({ action: 'approve_all' }),
    );

    expect(tracker.getContext().featureSyncDiscrepancies).toEqual(
      discrepancies,
    );
  });

  it('rejects a request_revisions submission whose payload is missing the feedback field and leaves context untouched', async () => {
    const discrepancies = [buildDiscrepancy()];
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: discrepancies }),
    );

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: {},
      }),
    );

    expect(tracker.getContext().featureSyncDiscrepancies).toEqual(
      discrepancies,
    );
  });

  it('determineRoutingFromUserMessage self-loops on an unrecognised action — routing is unconditional', async () => {
    const context = buildContext({
      featureSyncDiscrepancies: [buildDiscrepancy()],
    });

    const nextId = await node.determineRoutingFromUserMessage(
      context,
      buildAgentMessage({ action: 'not_a_real_action' }),
    );

    expect(nextId).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW);
  });

  it('on request_revisions, stashes the feedback text onto featureSyncPendingUserReply and leaves featureSyncDiscrepancies intact', async () => {
    const discrepancies = [buildDiscrepancy()];
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: discrepancies }),
    );

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: { feedback: 'Please address the auth stage gap.' },
      }),
    );

    const ctx = tracker.getContext();
    expect(ctx.featureSyncPendingUserReply).toBe(
      'Please address the auth stage gap.',
    );
    expect(ctx.featureSyncPendingDecisions).toEqual([]);
    expect(ctx.featureSyncDiscrepancies).toEqual(discrepancies);
  });

  it('on request_revisions with per-item decisions, validates and stashes them alongside the feedback — routing still only goes to iterate', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: [buildDiscrepancy({ id: 'fs-6' })],
      }),
    );
    const decisions = [
      { itemId: 'fs-6', choice: 'amend' as const, note: 'Split it' },
    ];
    const message = buildAgentMessage({
      action: WorkflowReviewAction.Refine,
      payload: { feedback: '6', decisions },
    });

    await node.processUserResponse(tracker, message);

    const ctx = tracker.getContext();
    expect(ctx.featureSyncPendingUserReply).toBe('6');
    expect(ctx.featureSyncPendingDecisions).toEqual(decisions);
    await expect(
      node.determineRoutingFromUserMessage(ctx, message),
    ).resolves.toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
  });

  it('rejects a decision with an unknown choice and leaves context untouched', async () => {
    const tracker = createMutableContextHandle(buildContext());

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: {
          feedback: 'x',
          decisions: [{ itemId: 'fs-1', choice: 'approve' }],
        },
      }),
    );

    expect(tracker.getContext().featureSyncPendingUserReply).toBeUndefined();
    expect(tracker.getContext().featureSyncPendingDecisions).toBeUndefined();
  });

  it('determineRoutingFromUserMessage routes request_revisions to FEATURE_SYNC_ITERATE', async () => {
    const context = buildContext({
      featureSyncDiscrepancies: [buildDiscrepancy()],
    });

    const nextId = await node.determineRoutingFromUserMessage(
      context,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: { feedback: 'Some guidance.' },
      }),
    );

    expect(nextId).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
  });

  it('determineRoutingFromUserMessage routes done to PROPOSED_STAGES and request_revisions to FEATURE_SYNC_ITERATE — the gate has exactly two exits', async () => {
    const context = buildContext({
      featureSyncDiscrepancies: [buildDiscrepancy()],
    });

    const doneNext = await node.determineRoutingFromUserMessage(
      context,
      buildAgentMessage({
        action: WorkflowReviewAction.Dismissed,
      }),
    );
    const revisionsNext = await node.determineRoutingFromUserMessage(
      context,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: { feedback: 'Some guidance.' },
      }),
    );

    expect(doneNext).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
    expect(revisionsNext).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
  });

  it('uses the planShapingFeatureSyncReviewActions schema map', () => {
    expect(node.actions).toBe(planShapingFeatureSyncReviewActions);
  });
});

// Cross-node loop coverage. The describes above pin each node in isolation;
// these drive the real review + iterate instances in sequence, threading the
// SAME mutated context from one node into the next so the seam itself is
// asserted — the stash one node writes is exactly what the other reads. This
// is the one-shot gate → iterate hand-off followed by the iterate self-loop
// the task promises (the gate is never re-entered), plus the two escape routes
// pinned shut.
describe('feature-sync revise-and-return loop (cross-node)', () => {
  let reviewNode: PlanShapingFeatureSyncReviewNode;
  let iterateNode: PlanShapingFeatureSyncIterateNode;

  beforeEach(() => {
    reviewNode = new PlanShapingFeatureSyncReviewNode();
    iterateNode = new PlanShapingFeatureSyncIterateNode();
  });

  it('a revision request typed at the gate is the exact text iterate surfaces as its trigger userMessage — and the stash is cleared so it cannot leak into a later pass', async () => {
    const revisionText = 'Please add the missing auth stage before checkout.';
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: [buildDiscrepancy()] }),
    );
    const revisionMsg = buildAgentMessage({
      action: WorkflowReviewAction.Refine,
      payload: { feedback: revisionText },
    });

    // 1) Gate processes the request_revisions submission: it stashes the
    //    free-text reply and routes to iterate.
    await reviewNode.processUserResponse(tracker, revisionMsg);
    const nextNodeId = await reviewNode.determineRoutingFromUserMessage(
      tracker.getContext(),
      revisionMsg,
    );
    expect(nextNodeId).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
    expect(tracker.getContext().featureSyncPendingUserReply).toBe(revisionText);

    // 2) Iterate runs on the SAME context the gate just mutated. It must read
    //    the gate's stash verbatim onto the trigger and clear it.
    const result = await iterateNode.execute(tracker);
    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.userMessage).toBe(revisionText);
    expect(tracker.getContext().featureSyncPendingUserReply).toBeUndefined();
  });

  it('Continue Revising on the iterate output re-fires the loop after the first revision — the regression: the gate handles the first click, but the iterate node must handle every subsequent one', async () => {
    // 1) Gate hand-off: first "Keep working on this" → iterate surfaces it and
    //    clears the stash (the path that already worked).
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: [buildDiscrepancy()] }),
    );
    const firstMsg = buildAgentMessage({
      action: WorkflowReviewAction.Refine,
      payload: { feedback: 'First pass: add the auth stage.' },
    });
    await reviewNode.processUserResponse(tracker, firstMsg);
    const firstTrigger = await iterateNode.execute(tracker);
    expect(
      (
        firstTrigger.triggersAgent as unknown as {
          payload: { userMessage?: string };
        }
      ).payload.userMessage,
    ).toBe('First pass: add the auth stage.');
    expect(tracker.getContext().featureSyncPendingUserReply).toBeUndefined();

    // 2) The agent emits a REVISED set; the iterate output rides the review
    //    element, so the user clicks Continue Revising AGAIN — the exact click
    //    that used to be dropped as unknown_action. The engine must accept it,
    //    the iterate node must stash the new feedback, and the next trigger
    //    must surface it so the agent produces another revised set.
    const secondMsg = buildAgentMessage({
      action: WorkflowReviewAction.Refine,
      payload: { feedback: 'Second pass: split the auth stage in two.' },
    });
    expect(
      validateExternalAgentCompletion({
        nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        actions: planShapingFeatureSyncIterateActions,
        message: secondMsg,
      }).action,
    ).toBe(WorkflowReviewAction.Refine);

    await iterateNode.processUserResponse(tracker, secondMsg);
    expect(tracker.getContext().featureSyncPendingUserReply).toBe(
      'Second pass: split the auth stage in two.',
    );

    const secondTrigger = await iterateNode.execute(tracker);
    expect(
      (
        secondTrigger.triggersAgent as unknown as {
          payload: { userMessage?: string };
        }
      ).payload.userMessage,
    ).toBe('Second pass: split the auth stage in two.');
    expect(tracker.getContext().featureSyncPendingUserReply).toBeUndefined();
  });

  it('a REVISED pass refreshes the saved items and the next trigger carries them — continuity never depends on provider session history', async () => {
    const tracker = createMutableContextHandle(
      buildContext({ featureSyncResolved: false }),
    );

    const revised = [
      buildDiscrepancy({ summary: 'Fresh: checkout step omitted' }),
    ];
    await iterateNode.processUserResponse(
      tracker,
      TestUtils.createMockFlowUserMessage({
        data: {
          action: FEATURE_SYNC_ACTIONS.REVISED,
          payload: { discrepancies: revised },
        },
      }),
    );
    expect(tracker.getContext().featureSyncDiscrepancies).toEqual([
      { ...revised[0], id: 'fs-1' },
    ]);

    await iterateNode.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: { feedback: 'Keep refining.', decisions: [] },
      }),
    );

    const result = await iterateNode.execute(tracker);
    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.discrepancies).toEqual([{ ...revised[0], id: 'fs-1' }]);
    expect(payload.decisions).toEqual([]);
  });

  it('a RESOLVED completion out of iterate neither validates nor advances: the engine rejects it, processing it is a no-op, and the stash on context stays unchanged', async () => {
    const original = [
      buildDiscrepancy({ summary: 'Auth stage missing from plan' }),
    ];
    const tracker = createMutableContextHandle(
      buildContext({
        featureSyncDiscrepancies: original,
        featureSyncPendingDecisions: [],
        featureSyncResolved: false,
      }),
    );
    const resolvedMsg = buildAgentMessage({
      action: FEATURE_SYNC_ACTIONS.RESOLVED,
    });

    expect(() =>
      validateExternalAgentCompletion({
        nodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        actions: planShapingFeatureSyncIterateActions,
        message: resolvedMsg,
      }),
    ).toThrow(expect.objectContaining({ reason: 'unknown_action' }));

    await iterateNode.processUserResponse(tracker, resolvedMsg);
    expect(tracker.getContext().featureSyncDiscrepancies).toEqual(original);
    expect(tracker.getContext().featureSyncResolved).toBe(false);

    const result = await iterateNode.execute(tracker);
    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.discrepancies).toEqual(original);
  });
});
