import {
  LocalPromptType,
  PhaseBreakdownPlan,
  PhaseBreakdownStepType,
  PlanShapingApprovedVisualEntityTypeEnum,
  type PlanShapingApprovedVisual,
} from 'src/generated/local';
import {
  ExtendedUIFieldType,
  PlanGenerationFinalizePayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
} from 'src/generated';
import {
  ExternalAgentValidationError,
  FlowUserMessage,
  PlanFromDesignDocFlowContext,
  NodeType,
  validateExternalAgentCompletion,
} from 'src/types/flow-internal.types';
import { Logger, NotFoundException } from '@nestjs/common';
import { CustomLoggerService } from 'src/common/logger/logger.service';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import * as TestUtils from 'src/utils/testUtils';
import { PLAN_SHAPING_NODES } from '../../../constants/node-ids';
import { PlanShapingFinalizeNode } from '../finalize.node';
import { PlanShapingVisualPreviewNode } from '../visual-preview.node';
import { PlanShapingVisualPreviewFeedbackNode } from '../visual-preview-feedback.node';
import {
  PlanShapingPhaseBreakdownNode,
  countAccumulatedPhases,
} from '../phase-breakdown.node';
import {
  PlanShapingStepReviewNode,
  flattenStageDraftedSteps,
  resolveStageCursor,
  synthesizeStageIdxMismatchCompletion,
} from '../step-review.node';
import { PlanShapingProposedStagesNode } from '../proposed-stages.node';
import { PlanShapingProposedStagesFeedbackNode } from '../proposed-stages-feedback.node';
import {
  PLAN_SHAPING_ACTIONS,
  phaseBreakdownPlanSchema,
  planShapingPhaseBreakdownActions,
  planShapingProposedStagesActions,
  planShapingStepReviewActions,
} from '../schemas';
import type { JourneyStep } from 'src/generated/local';
import type { Client } from '@temporalio/client';
import type {
  PlanFromDesignDocSeed,
  PlanFromDesignDocSeedService,
} from 'src/services/plan/plan-from-design-doc-seed.service';
import type { TaskService } from 'src/services/tasks/task.service';
import type { PlanStageBatchApprovalService } from 'src/services/proposal/plan-stage-batch-approval.service';
import type { PlanStepBatchApprovalService } from 'src/services/proposal/plan-step-batch-approval.service';

const VALID_DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';
const VALID_PLAN_ID = '22222222-2222-4222-8222-222222222222';

const buildContext = (
  overrides: Partial<PlanFromDesignDocFlowContext> = {},
): PlanFromDesignDocFlowContext => {
  return TestUtils.createMockFlowContext({
    flowId: 'plan-from-design-doc',
    visualPreviewApprovedVisuals: [],
    ...overrides,
  }) as PlanFromDesignDocFlowContext;
};

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

const buildAdmissionStub = () => ({
  prepare: jest.fn(
    async ({ submission }: { submission: { plan: unknown } }) => ({
      accumulatedPhases: {},
      submission,
      changeSet: {
        root: { refType: 'existing', id: VALID_PLAN_ID },
        operations: [],
      },
      advisories: [],
    }),
  ),
});

const buildAgentMessage = (data: Record<string, unknown>): FlowUserMessage =>
  TestUtils.createMockFlowUserMessage({ data });

const buildReviewMessage = (data: Record<string, unknown>): FlowUserMessage =>
  TestUtils.createMockFlowUserMessage({ data, userId: 'workflow-answer-user' });

describe('PlanShapingProposedStagesNode', () => {
  let node: PlanShapingProposedStagesNode;

  beforeEach(() => {
    node = new PlanShapingProposedStagesNode(buildSeedStub());
  });

  it('emits an EXTERNAL_AGENT result carrying a plan_shaping_proposed_stages trigger on entry', async () => {
    const tracker = createMutableContextHandle(buildContext());

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.triggersAgent?.promptType).toBe(
      LocalPromptType.plan_shaping_proposed_stages,
    );
    expect(result.triggersAgent?.nodeId).toBe(
      PLAN_SHAPING_NODES.PROPOSED_STAGES,
    );
  });

  it.each([
    [2, 1],
    [2, 2],
    [0, 0],
  ])(
    'projects successive totals %s then %s and clears between completions',
    async (first, second) => {
      const tracker = createMutableContextHandle(buildContext());
      const review = new PlanShapingProposedStagesFeedbackNode(
        {} as PlanStageBatchApprovalService,
      );
      for (const expectedStageCount of [first, second]) {
        await node.buildTriggerMessage(tracker);
        expect(tracker.getContext().proposedStagesReview).toBeUndefined();
        await expect(review.execute(tracker)).rejects.toThrow(
          /accepted completion total/,
        );
        await node.processUserResponse(
          tracker,
          buildAgentMessage({
            action: 'READY',
            payload: { expectedStageCount },
          }),
        );
        const result = await review.execute(tracker);
        expect(result.uiElements?.[0]?.payload).toEqual({ expectedStageCount });
      }
    },
  );

  it.each([
    undefined,
    {},
    { expectedStageCount: -1 },
    { expectedStageCount: 1.5 },
  ])('rejects invalid completion metadata at capture', async (payload) => {
    const tracker = createMutableContextHandle(buildContext());
    await expect(
      node.processUserResponse(
        tracker,
        buildAgentMessage({ action: 'READY', payload }),
      ),
    ).rejects.toThrow();
    expect(tracker.getContext().proposedStagesReview).toBeUndefined();
  });

  it('declares only the READY action schema', () => {
    expect(node.actions).toBe(planShapingProposedStagesActions);
    expect(Object.keys(node.actions)).toEqual([PLAN_SHAPING_ACTIONS.READY]);
  });

  it('validates READY with the decided stage total', () => {
    const result = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES,
      actions: node.actions,
      message: buildAgentMessage({
        action: PLAN_SHAPING_ACTIONS.READY,
        payload: {
          expectedStageCount: 2,
        },
      }),
    });
    expect(result.action).toBe(PLAN_SHAPING_ACTIONS.READY);
  });

  it.each([
    ['missing payload', undefined],
    [
      'negative count',
      {
        expectedStageCount: -1,
      },
    ],
    [
      'fractional count',
      {
        expectedStageCount: 1.5,
      },
    ],
    ['missing count', {}],
    [
      'extra field',
      {
        expectedStageCount: 2,
        legacyCount: 2,
      },
    ],
  ])('rejects READY with %s', (_label, payload) => {
    expect(() =>
      validateExternalAgentCompletion({
        nodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES,
        actions: node.actions,
        message: buildAgentMessage({
          action: PLAN_SHAPING_ACTIONS.READY,
          ...(payload === undefined ? {} : { payload }),
        }),
      }),
    ).toThrow(ExternalAgentValidationError);
  });

  it('threads the materialized design-doc and plan ids onto the trigger payload', async () => {
    const tracker = createMutableContextHandle(buildContext());

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.designDocId).toBe(VALID_DESIGN_DOC_ID);
    expect(payload.planId).toBe(VALID_PLAN_ID);
    expect(payload.userMessage).toBeUndefined();
  });

  it('surfaces carried feedback as triggersAgent.payload.userMessage on re-entry, then clears it', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        proposedStagesFeedback: '  combine stages 4 and 5  ',
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload).toBeDefined();
    expect(payload.userMessage).toBe('combine stages 4 and 5');
    expect(result.message).toBe('Reworking the stages with your feedback…');
    expect(tracker.getContext().proposedStagesFeedback).toBeUndefined();
  });
});

describe('PlanShapingProposedStagesFeedbackNode', () => {
  let node: PlanShapingProposedStagesFeedbackNode;
  let approveAllMock: jest.Mock;
  let batchApprovalService: PlanStageBatchApprovalService;

  beforeEach(() => {
    approveAllMock = jest.fn();
    batchApprovalService = {
      approveAllDraftPlanStagesForConversation: approveAllMock,
      withdrawForRevision: jest.fn().mockResolvedValue(undefined),
    } as unknown as PlanStageBatchApprovalService;
    node = new PlanShapingProposedStagesFeedbackNode(batchApprovalService);
  });

  it('renders a single plan_generation_stage_review element on entry', async () => {
    const tracker = createMutableContextHandle(
      buildContext({ proposedStagesReview: { expectedStageCount: 2 } }),
    );

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements?.length).toBe(1);
    expect(result.uiElements?.[0]?.type).toBe('plan_generation_stage_review');
  });

  it('wires Ready for next step and Continue Revising as form-level secondary action buttons on entry', async () => {
    const tracker = createMutableContextHandle(
      buildContext({ proposedStagesReview: { expectedStageCount: 2 } }),
    );

    const result = await node.execute(tracker);

    const element = result.uiElements?.[0];
    expect(element?.type).toBe(ExtendedUIFieldType.PlanGenerationStageReview);
    expect(element?.submitText).toBeUndefined();
    expect(element?.secondaryAction).toBeUndefined();

    const secondaryActions = (
      result.data as { secondaryActions?: SecondaryActionConfig[] }
    )?.secondaryActions;
    expect(secondaryActions).toHaveLength(2);

    const continueRevising = secondaryActions?.find(
      (a) => a.label === 'Continue Revising',
    );
    expect(continueRevising?.type).toBe(
      SecondaryActionConfig.TypeEnum.FieldAction,
    );
    expect(continueRevising?.presentation).toBe(
      SecondaryActionConfig.PresentationEnum.Button,
    );
    expect(continueRevising?.handler).toBe(
      SecondaryActionHandler.PlanGenerationStageReviewContinueRevising,
    );
    expect(continueRevising?.fieldId).toBe(element?.id);
    expect(continueRevising?.payload?.handlerType).toBe(
      'plan_generation_stage_review_continue_revising',
    );

    const ready = secondaryActions?.find(
      (a) => a.label === 'Ready for next step',
    );
    expect(ready?.type).toBe(SecondaryActionConfig.TypeEnum.FieldAction);
    expect(ready?.presentation).toBe(
      SecondaryActionConfig.PresentationEnum.Button,
    );
    expect(ready?.handler).toBe(
      SecondaryActionHandler.PlanGenerationStageReviewApproveAll,
    );
    expect(ready?.fieldId).toBe(element?.id);
    expect(ready?.payload?.handlerType).toBe(
      'plan_generation_stage_review_approve_all',
    );
  });

  it('routes continue_revising back to proposed-stages and stashes the feedback for the next entry', async () => {
    const tracker = createMutableContextHandle(
      buildContext({ proposedStagesReview: { expectedStageCount: 2 } }),
    );

    const message = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.REFINE,
      payload: { feedback: 'Move the auth work into stage 2' },
    });

    await node.processUserResponse(tracker, message);
    const next = await node.determineRoutingFromUserMessage(
      tracker.getContext(),
      message,
    );

    expect(next).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
    expect(tracker.getContext().proposedStagesFeedback).toBe(
      'Move the auth work into stage 2',
    );
    expect(batchApprovalService.withdrawForRevision).toHaveBeenCalledTimes(1);
  });

  it('routes APPROVED to visual-preview without approving proposals', async () => {
    const tracker = createMutableContextHandle(
      buildContext({ proposedStagesReview: { expectedStageCount: 2 } }),
    );
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });

    await node.processUserResponse(tracker, message);
    const next = await node.determineRoutingFromUserMessage(
      tracker.getContext(),
      message,
    );

    expect(next).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW);
    expect(approveAllMock).not.toHaveBeenCalled();
  });

  it('routes APPROVED to visual-preview regardless of proposal state', async () => {
    approveAllMock.mockRejectedValueOnce(
      new Error('proposal state must not be consulted'),
    );
    const tracker = createMutableContextHandle(
      buildContext({ proposedStagesReview: { expectedStageCount: 2 } }),
    );
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });

    await node.processUserResponse(tracker, message);
    const next = await node.determineRoutingFromUserMessage(
      tracker.getContext(),
      message,
    );

    expect(next).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW);
    expect(approveAllMock).not.toHaveBeenCalled();
  });
});

// Durable stage UUIDs journey steps bind to; `proposed-stages` authored
// these before visual preview ran.
const STAGE_A_UUID = '11111111-1111-4111-8111-111111111111';
const STAGE_B_UUID = '22222222-2222-4222-8222-222222222222';

const buildJourneyStep = (overrides: Partial<JourneyStep> = {}): JourneyStep =>
  ({
    id: 'step-1',
    stageId: STAGE_A_UUID,
    title: 'Step',
    description: 'desc',
    isUserInteractive: false,
    implementationNotes: [],
    ...overrides,
  }) as JourneyStep;

describe('PlanShapingPhaseBreakdownNode', () => {
  let node: PlanShapingPhaseBreakdownNode;

  beforeEach(() => {
    node = new PlanShapingPhaseBreakdownNode(
      buildSeedStub(),
      buildAdmissionStub() as never,
    );
  });

  it('carries the resolved approved visuals on the phase-breakdown trigger', async () => {
    const approvedVisuals: PlanShapingApprovedVisual[] = [
      {
        proposalId: '33333333-3333-4333-8333-333333333333',
        entityId: '55555555-5555-4555-8555-555555555555',
        entityType: PlanShapingApprovedVisualEntityTypeEnum.MOCKUP,
        title: 'Review surface',
        summary: 'Shows the review surface.',
      },
    ];
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ stageId: STAGE_A_UUID })],
        visualPreviewApprovedVisuals: approvedVisuals,
      }),
    );

    const result = await node.execute(tracker);

    expect(
      (result.triggersAgent as unknown as { payload: Record<string, unknown> })
        .payload.approvedVisuals,
    ).toEqual(approvedVisuals);
  });

  it('refuses to start without a resolved approved visual set', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ stageId: STAGE_A_UUID })],
        visualPreviewApprovedVisuals: undefined,
      }),
    );

    await expect(node.execute(tracker)).rejects.toThrow(
      'the approved visual set has not been resolved',
    );
  });

  const STEP_UUID = '99999999-9999-4999-8999-999999999999';

  it('leaves accumulation unchanged when acceptance-time admission rejects changed state', async () => {
    const rejecting = new PlanShapingPhaseBreakdownNode(buildSeedStub(), {
      prepare: jest.fn().mockResolvedValue({
        findings: [
          {
            field: '/plan/steps/0/id',
            code: 'duplicate_identity',
            reason: 'Duplicate.',
          },
        ],
        advisories: [],
      }),
    } as never);
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ stageId: STAGE_A_UUID })],
      }),
    );
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.DONE,
      payload: { stageIdx: 0, phaseIdx: 0, plan: buildPhasePlan() },
    });

    await rejecting.processUserResponse(tracker, message);

    expect(tracker.getContext().accumulatedPhases).toBeUndefined();
    expect(message.data).toMatchObject({
      action: PLAN_SHAPING_ACTIONS.ERROR,
      payload: { reason: 'agent_submission_error' },
    });
  });

  // A steps-only phase plan — a phase emits no stages; every step
  // names the durable stage it materializes under via `stageId`.
  const buildPhasePlan = (
    overrides: { stepId?: string; stageId?: string } = {},
  ): PhaseBreakdownPlan =>
    ({
      steps: [
        {
          id: overrides.stepId ?? STEP_UUID,
          stageId: overrides.stageId ?? STAGE_A_UUID,
          title: 'Step A',
          description: 'Step A body',
          acceptanceCriteria: '- Step A done',
          type: PhaseBreakdownStepType.TASK,
          sequenceOrder: 0,
        },
      ],
    }) as PhaseBreakdownPlan;

  it('emits an EXTERNAL_AGENT result carrying a plan_shaping_phase_breakdown trigger on entry', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ id: 'step-1' })],
      }),
    );

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.triggersAgent?.promptType).toBe(
      LocalPromptType.plan_shaping_phase_breakdown,
    );
    expect(result.triggersAgent?.nodeId).toBe(
      PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
    );
  });

  it('declares the DONE action schema plus the synthesized ERROR completion', () => {
    expect(node.actions).toBe(planShapingPhaseBreakdownActions);
    // ERROR is registered alongside DONE so the engine's re-validation
    // inside resolveExternalAgentRouting accepts the mismatch completion
    // processUserResponse rewrites onto userMessage.data.
    expect(Object.keys(node.actions)).toEqual([
      PLAN_SHAPING_ACTIONS.DONE,
      PLAN_SHAPING_ACTIONS.ERROR,
    ]);
  });

  it('accepts a DONE completion carrying plural Service ownership', () => {
    const result = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
      actions: node.actions,
      message: buildAgentMessage({
        action: PLAN_SHAPING_ACTIONS.DONE,
        payload: {
          stageIdx: 0,
          phaseIdx: 0,
          plan: {
            steps: [
              {
                id: STEP_UUID,
                stageId: STAGE_A_UUID,
                title: 'Define the review contract',
                description: 'Define the proposal review contract.',
                implementation: 'Update specs/schemas/proposals.yaml.',
                type: PhaseBreakdownStepType.TASK,
                acceptanceCriteria: '- Generated clients expose the contract.',
                sequenceOrder: 0,
                serviceIds: [
                  '33333333-3333-4333-8333-333333333333',
                  '44444444-4444-4444-8444-444444444444',
                ],
                designDocMotivation:
                  'The design requires one stable review boundary.',
              },
            ],
          },
        },
      }),
    });

    expect(result.action).toBe(PLAN_SHAPING_ACTIONS.DONE);
  });

  it('accepts a CLI-reported phase submission ERROR payload without requiring a cursor-mismatch shape', () => {
    const result = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
      actions: node.actions,
      message: buildAgentMessage({
        action: PLAN_SHAPING_ACTIONS.ERROR,
        payload: {
          reason: 'agent_submission_error',
          message:
            'submit_phase_breakdown received an invalid payload: plan.steps.0.stageId: stageId must be a UUID',
        },
      }),
    });

    expect(result.action).toBe(PLAN_SHAPING_ACTIONS.ERROR);
  });

  it('stamps the current journey step and the (0,0) cursor onto the trigger payload when accumulatedPhases is empty', async () => {
    const stepA = buildJourneyStep({ id: 'step-a' });
    const stepB = buildJourneyStep({ id: 'step-b' });
    const stepC = buildJourneyStep({ id: 'step-c' });
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [stepA, stepB, stepC],
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.journeyStep).toEqual(stepA);
    expect(payload.stageIdx).toBe(0);
    expect(payload.phaseIdx).toBe(0);
    // All three steps share one stage, so the stage's journey holds all 3.
    expect(payload.phasesInStage).toBe(3);
    expect(payload.totalPhases).toBe(3);
    expect(payload.designDocId).toBe(VALID_DESIGN_DOC_ID);
    expect(payload.planId).toBe(VALID_PLAN_ID);
  });

  it('derives the 2-D cursor from accumulatedPhases mid-loop, crossing into the next stage`s journey', async () => {
    // Stage A has phases a0, a1; stage B has phase b0.
    const a0 = buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID });
    const a1 = buildJourneyStep({ id: 'a1', stageId: STAGE_A_UUID });
    const b0 = buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID });
    const phasePlan = buildPhasePlan();
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [a0, a1, b0],
        // Stage A fully accumulated — the next cursor is (1, 0), the
        // first phase of stage B`s journey.
        accumulatedPhases: { 0: { 0: phasePlan, 1: phasePlan } },
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.journeyStep).toEqual(b0);
    expect(payload.stageIdx).toBe(1);
    expect(payload.phaseIdx).toBe(0);
    // Stage B's journey holds only b0, so phasesInStage is 1 even though
    // the whole map carries 3 journey steps.
    expect(payload.phasesInStage).toBe(1);
    expect(payload.totalPhases).toBe(3);
  });

  it('leaves priorPhases empty on phase 0 — there is no earlier phase to hand forward', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ id: 'step-a' })],
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.priorPhases).toEqual([]);
  });

  it('stamps every earlier phase onto priorPhases, ascending and paired with its journey step and 2-D cursor', async () => {
    // Stage A has phases a0, a1; stage B has phase b0. Phases (0,0)
    // and (0,1) are accumulated; the phase about to run is (1,0).
    const a0 = buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID });
    const a1 = buildJourneyStep({ id: 'a1', stageId: STAGE_A_UUID });
    const b0 = buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID });
    const planA0 = buildPhasePlan({
      stepId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const planA1 = buildPhasePlan({
      stepId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [a0, a1, b0],
        accumulatedPhases: { 0: { 0: planA0, 1: planA1 } },
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as {
        payload: {
          stageIdx: number;
          phaseIdx: number;
          priorPhases: Array<{
            stageIdx: number;
            phaseIdx: number;
            journeyStep: { id: string };
            plan: unknown;
          }>;
        };
      }
    ).payload;
    // The phase about to run is (1,0); priorPhases carries (0,0) and
    // (0,1), each entry pairing the journey step that phase expanded
    // with the steps-only plan the agent emitted for it.
    expect(payload.stageIdx).toBe(1);
    expect(payload.phaseIdx).toBe(0);
    expect(payload.priorPhases.map((p) => [p.stageIdx, p.phaseIdx])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(payload.priorPhases[0]!.journeyStep.id).toBe('a0');
    expect(payload.priorPhases[0]!.plan).toEqual(planA0);
    expect(payload.priorPhases[1]!.journeyStep.id).toBe('a1');
    expect(payload.priorPhases[1]!.plan).toEqual(planA1);
  });

  it('throws when every phase is already accumulated so the workflow surfaces the misuse rather than spinning', async () => {
    const phasePlan = buildPhasePlan();
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep()],
        // The single journey step`s slot (0,0) is already filled — no
        // pending cursor remains, so execute must fail fast rather
        // than spin emitting empty triggers.
        accumulatedPhases: { 0: { 0: phasePlan } },
      }),
    );

    await expect(node.execute(tracker)).rejects.toThrow();
  });

  it('on DONE, writes accumulatedPhases[stageIdx][phaseIdx] without touching any counter field', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep(), buildJourneyStep({ id: 's2' })],
      }),
    );

    const plan = buildPhasePlan();
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.DONE,
      payload: { stageIdx: 0, phaseIdx: 0, plan },
    });

    await node.processUserResponse(tracker, message);

    const ctx = tracker.getContext();
    expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(plan);
    expect(Object.keys(ctx.accumulatedPhases ?? {})).toEqual(['0']);
    expect(Object.keys(ctx.accumulatedPhases?.[0] ?? {})).toEqual(['0']);
  });

  it('on DONE for the second phase, leaves the prior phase intact while appending the new one', async () => {
    const firstPlan = buildPhasePlan();
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep(), buildJourneyStep({ id: 's2' })],
        accumulatedPhases: { 0: { 0: firstPlan } },
      }),
    );

    const secondPlan = buildPhasePlan({
      stepId: '44444444-4444-4444-8444-444444444444',
    });
    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: PLAN_SHAPING_ACTIONS.DONE,
        payload: { stageIdx: 0, phaseIdx: 1, plan: secondPlan },
      }),
    );

    const ctx = tracker.getContext();
    expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(firstPlan);
    expect(ctx.accumulatedPhases?.[0]?.[1]).toEqual(secondPlan);
  });

  it('determineRoutingFromAgentCompletion returns PHASE_BREAKDOWN while another phase remains', async () => {
    const next = await node.determineRoutingFromAgentCompletion!(
      buildContext({
        journeySteps: [
          buildJourneyStep({ id: 'a' }),
          buildJourneyStep({ id: 'b' }),
          buildJourneyStep({ id: 'c' }),
        ],
        accumulatedPhases: { 0: { 0: buildPhasePlan() } },
      }),
      PLAN_SHAPING_ACTIONS.DONE,
    );

    expect(next).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
  });

  it('determineRoutingFromAgentCompletion returns undefined on the final-phase DONE — materialization moved to step-review, so the engine falls through to the static DONE → STEP_REVIEW transition', async () => {
    const phasePlan = buildPhasePlan();
    const ctx = buildContext({
      journeySteps: [
        buildJourneyStep({ id: 'a' }),
        buildJourneyStep({ id: 'b' }),
      ],
      accumulatedPhases: { 0: { 0: phasePlan, 1: phasePlan } },
    });

    const next = await node.determineRoutingFromAgentCompletion!(
      ctx,
      PLAN_SHAPING_ACTIONS.DONE,
    );

    // Phase-breakdown's loop-exit no longer materializes. Returning
    // undefined hands the (still-drafted) accumulated steps to the
    // step-review tightening pass via the static transition map.
    expect(next).toBeUndefined();
  });

  it('determineRoutingFromAgentCompletion returns undefined for non-DONE actions', async () => {
    const next = await node.determineRoutingFromAgentCompletion!(
      buildContext({
        journeySteps: [buildJourneyStep()],
      }),
      'some_other_action',
    );

    expect(next).toBeUndefined();
  });

  describe('multi-stage happy-path loop', () => {
    it('accumulates every phase across multiple stages and on final-phase DONE returns undefined so the engine takes the static DONE → STEP_REVIEW transition', async () => {
      // Stage A has phases a0, a1; stage B has phase b0. The journey
      // walks (0,0) → (0,1) → (1,0) — the cursor crosses the stage
      // boundary once stage A`s journey is exhausted.
      const journeySteps = [
        buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID }),
        buildJourneyStep({ id: 'a1', stageId: STAGE_A_UUID }),
        buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID }),
      ];

      const tracker = createMutableContextHandle(
        buildContext({ journeySteps }),
      );

      // The expected (stageIdx, phaseIdx) cursor at each iteration,
      // plus the durable stage each phase`s steps bind to.
      const expectedCursors = [
        { stageIdx: 0, phaseIdx: 0, stageId: STAGE_A_UUID },
        { stageIdx: 0, phaseIdx: 1, stageId: STAGE_A_UUID },
        { stageIdx: 1, phaseIdx: 0, stageId: STAGE_B_UUID },
      ];

      // Drive every phase through execute + processUserResponse + the
      // routing hook in sequence. After each intermediate DONE the hook
      // must return PHASE_BREAKDOWN (loop). Once every cursor is
      // accumulated the hook returns undefined and the engine takes
      // the static DONE → STEP_REVIEW transition — materialization
      // moved to step-review's loop-exit.
      for (let i = 0; i < expectedCursors.length; i += 1) {
        const cursor = expectedCursors[i]!;

        const entry = await node.execute(tracker);
        const triggerPayload = (
          entry.triggersAgent as unknown as {
            payload: { stageIdx: number; phaseIdx: number };
          }
        ).payload;
        expect(triggerPayload.stageIdx).toBe(cursor.stageIdx);
        expect(triggerPayload.phaseIdx).toBe(cursor.phaseIdx);

        await node.processUserResponse(
          tracker,
          buildAgentMessage({
            action: PLAN_SHAPING_ACTIONS.DONE,
            payload: {
              stageIdx: cursor.stageIdx,
              phaseIdx: cursor.phaseIdx,
              plan: buildPhasePlan({ stageId: cursor.stageId }),
            },
          }),
        );

        const routing = await node.determineRoutingFromAgentCompletion!(
          tracker.getContext(),
          PLAN_SHAPING_ACTIONS.DONE,
        );

        const isLastPhase = i === expectedCursors.length - 1;
        if (!isLastPhase) {
          expect(routing).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
        } else {
          expect(routing).toBeUndefined();
        }
      }

      // accumulatedPhases ends with one entry per journey step, keyed
      // by the 2-D (stageIdx, phaseIdx) cursor. Every step names a
      // pre-existing durable stage.
      const ctx = tracker.getContext();
      expect(Object.keys(ctx.accumulatedPhases ?? {}).sort()).toEqual([
        '0',
        '1',
      ]);
      expect(Object.keys(ctx.accumulatedPhases?.[0] ?? {}).sort()).toEqual([
        '0',
        '1',
      ]);
      expect(Object.keys(ctx.accumulatedPhases?.[1] ?? {})).toEqual(['0']);
      expect(ctx.accumulatedPhases?.[0]?.[0]?.steps[0]?.stageId).toBe(
        STAGE_A_UUID,
      );
      expect(ctx.accumulatedPhases?.[1]?.[0]?.steps[0]?.stageId).toBe(
        STAGE_B_UUID,
      );
      expect(countAccumulatedPhases(ctx.accumulatedPhases)).toBe(
        journeySteps.length,
      );
    });
  });

  describe('cursor mismatch + idempotent overwrite', () => {
    it('idempotent overwrite: re-emitting the most recent cursor overwrites that slot without growing the map or producing an error', async () => {
      const firstPlan = buildPhasePlan();
      const tracker = createMutableContextHandle(
        buildContext({
          journeySteps: [buildJourneyStep(), buildJourneyStep({ id: 's2' })],
          accumulatedPhases: { 0: { 0: firstPlan } },
        }),
      );

      const overwritePlan = buildPhasePlan({
        stepId: '88888888-8888-4888-8888-888888888888',
      });
      const message = buildAgentMessage({
        action: PLAN_SHAPING_ACTIONS.DONE,
        // expected cursor is (0,1); the agent re-emits (0,0) — the
        // most recent slot — so the idempotent-retry path overwrites it.
        payload: { stageIdx: 0, phaseIdx: 0, plan: overwritePlan },
      });

      await node.processUserResponse(tracker, message);

      const ctx = tracker.getContext();
      expect(Object.keys(ctx.accumulatedPhases?.[0] ?? {})).toEqual(['0']);
      expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(overwritePlan);
      // Action discriminator is unchanged — no ERROR synthesis on the
      // idempotent path.
      expect((message.data as Record<string, unknown>)['action']).toBe(
        PLAN_SHAPING_ACTIONS.DONE,
      );
    });

    it('mismatch: emitting an unexpected cursor synthesizes an ERROR completion and leaves accumulatedPhases unchanged', async () => {
      const firstPlan = buildPhasePlan();
      const tracker = createMutableContextHandle(
        buildContext({
          journeySteps: [
            buildJourneyStep(),
            buildJourneyStep({ id: 's2' }),
            buildJourneyStep({ id: 's3' }),
          ],
          accumulatedPhases: { 0: { 0: firstPlan } },
        }),
      );

      const rogue = buildPhasePlan({
        stepId: '66666666-6666-4666-8666-666666666666',
      });
      const message = buildAgentMessage({
        action: PLAN_SHAPING_ACTIONS.DONE,
        // expected cursor is (0,1); (0,2) is neither that nor the
        // most-recent slot (0,0).
        payload: { stageIdx: 0, phaseIdx: 2, plan: rogue },
      });

      await node.processUserResponse(tracker, message);

      const ctx = tracker.getContext();
      // accumulatedPhases unchanged — slot (0,2) was NOT written.
      expect(Object.keys(ctx.accumulatedPhases?.[0] ?? {})).toEqual(['0']);
      expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(firstPlan);

      // userMessage.data was rewritten with the synthesized ERROR
      // completion carrying the expected and provided 2-D cursors.
      const data = message.data as Record<string, unknown>;
      expect(data['action']).toBe(PLAN_SHAPING_ACTIONS.ERROR);
      expect(data['payload']).toEqual({
        reason: 'phase_idx_mismatch',
        expected: { stageIdx: 0, phaseIdx: 1 },
        provided: { stageIdx: 0, phaseIdx: 2 },
      });

      // Wire-shape self-consistency: the engine re-runs
      // validateExternalAgentCompletion against the *rewritten* message
      // inside resolveExternalAgentRouting. ERROR must be a registered
      // action or that re-validation throws `unknown_action` and the
      // synthesized failure detail never reaches the routing layer.
      const revalidated = validateExternalAgentCompletion({
        nodeId: PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
        actions: node.actions,
        message,
      });
      expect(revalidated.action).toBe(PLAN_SHAPING_ACTIONS.ERROR);
    });

    it('counter-free multi-phase loop: every trigger payload cursor is derived from accumulatedPhases (no counter field on FlowContext)', async () => {
      // One stage, four phases — the cursor walks (0,0) → (0,3)
      // entirely within stage A.
      const journeySteps = [
        buildJourneyStep({ id: 'p0', stageId: STAGE_A_UUID }),
        buildJourneyStep({ id: 'p1', stageId: STAGE_A_UUID }),
        buildJourneyStep({ id: 'p2', stageId: STAGE_A_UUID }),
        buildJourneyStep({ id: 'p3', stageId: STAGE_A_UUID }),
      ];

      const tracker = createMutableContextHandle(
        buildContext({ journeySteps }),
      );

      for (let phaseIdx = 0; phaseIdx < journeySteps.length; phaseIdx += 1) {
        // The trigger payload's cursor must match the next unfilled
        // slot in accumulatedPhases — no separate counter is consulted.
        const result = await node.execute(tracker);
        const payload = (
          result.triggersAgent as unknown as {
            payload: Record<string, unknown>;
          }
        ).payload;
        expect(payload.stageIdx).toBe(0);
        expect(payload.phaseIdx).toBe(phaseIdx);

        await node.processUserResponse(
          tracker,
          buildAgentMessage({
            action: PLAN_SHAPING_ACTIONS.DONE,
            payload: { stageIdx: 0, phaseIdx, plan: buildPhasePlan() },
          }),
        );

        // The context type itself no longer carries a counter field —
        // assert it via a wide cast so a future re-introduction of
        // `currentPhaseIndex` fails this test.
        const wide = tracker.getContext() as unknown as Record<string, unknown>;
        expect('currentPhaseIndex' in wide).toBe(false);
      }
    });
  });
});

describe('visual proposal reuse across conversations', () => {
  const entries: NonNullable<
    PlanFromDesignDocFlowContext['visualPreviewEntries']
  > = [
    {
      proposalId: '33333333-3333-4333-8333-333333333333',
      artifactFamily: 'mockup',
      presentationOrder: 0,
    },
    {
      proposalId: '44444444-4444-4444-8444-444444444444',
      artifactFamily: 'diagram',
      presentationOrder: 1,
      relationship: {
        kind: 'depends_on',
        proposalId: '33333333-3333-4333-8333-333333333333',
      },
    },
  ];

  const VISUAL_WORK_ITEM_IDS: Record<string, string> = {
    '33333333-3333-4333-8333-333333333333':
      '55555555-5555-4555-8555-555555555555',
    '44444444-4444-4444-8444-444444444444':
      '66666666-6666-4666-8666-666666666666',
  };
  const VISUAL_WORK_ITEMS = [
    {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Review surface',
      type: 'mockup',
      sections: [
        {
          key: 'purpose',
          materializedMarkdown: 'Shows the review surface.\n\nMore detail.',
        },
      ],
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Review sequence',
      type: 'DIAGRAM',
      sections: [],
    },
  ];

  function setup(statuses = ['APPROVED'], sameConversation = false) {
    const context = buildContext({
      journeySteps: [buildJourneyStep({ stageId: STAGE_A_UUID })],
    });
    const rows = statuses.map((status, index) => ({
      id: entries[index]!.proposalId,
      status,
      organizationId: String(context.core.organizationId),
      projectId: String(context.core.projectId),
      conversationId: sameConversation
        ? context.core.conversationId
        : 'earlier-conversation',
      messageId: 'original-message',
      groupId: 'original-group',
    }));
    const prisma = TestUtils.createMockPrismaService();
    // Honor every scope predicate so a conversation-local lookup reproduces the bug.
    prisma.db.proposal.findMany.mockImplementation(async ({ where }) =>
      rows
        .filter(
          (row) =>
            row.organizationId === where.organizationId &&
            row.projectId === where.projectId &&
            (where.conversationId === undefined ||
              row.conversationId === where.conversationId) &&
            where.id.in.includes(row.id),
        )
        .reverse()
        .map(({ id, status }) => ({
          id,
          status,
          targetEntityId: VISUAL_WORK_ITEM_IDS[id],
        })),
    );
    prisma.db.task.findMany.mockImplementation(async ({ where }) =>
      VISUAL_WORK_ITEMS.filter((item) => where.id.in.includes(item.id)),
    );
    const preview = new PlanShapingVisualPreviewNode(
      buildSeedStub({ parentFeatureId: VALID_DESIGN_DOC_ID as never }),
      prisma as unknown as import('src/prisma/prisma.service').PrismaService,
    );
    const approve = jest.fn(async (proposalId: string) => {
      const row = rows.find((candidate) => candidate.id === proposalId)!;
      row.status = 'APPROVED';
      return { enacted: true, resultingEntityId: proposalId };
    });
    const feedback = new PlanShapingVisualPreviewFeedbackNode(
      prisma as unknown as import('src/prisma/prisma.service').PrismaService,
      { approve } as never,
    );
    const tracker = createMutableContextHandle(context);
    const ready = () =>
      preview.processUserResponse(
        tracker,
        buildAgentMessage({
          action: PLAN_SHAPING_ACTIONS.READY,
          payload: {
            refinementRound: 0,
            entries: entries.slice(0, statuses.length),
          },
        }),
      );
    return { rows, prisma, preview, feedback, tracker, ready, approve };
  }

  it.each([
    { statuses: ['APPROVED'], sameConversation: false },
    { statuses: ['APPROVED', 'APPROVED'], sameConversation: false },
    { statuses: ['DRAFT', 'APPROVED'], sameConversation: false },
    { statuses: ['DRAFT', 'APPROVED'], sameConversation: true },
  ])(
    'requires explicit set approval for $statuses (same conversation: $sameConversation)',
    async ({ statuses, sameConversation }) => {
      const { rows, prisma, feedback, tracker, ready } = setup(
        statuses,
        sameConversation,
      );
      const originalHomes = rows.map((row) => ({ ...row }));
      const expectedEntries = entries.slice(0, statuses.length);
      await ready();
      const result = await feedback.execute(tracker);
      expect(result.type).toBe(NodeType.QUESTIONS);
      const actions = (
        result.data as { secondaryActions: SecondaryActionConfig[] }
      ).secondaryActions;
      const textareaId = result.uiElements?.find(
        ({ type }) => type === ExtendedUIFieldType.Textarea,
      )?.id;
      expect(
        actions.map(({ label, disabled, fieldId }) => ({
          label,
          disabled,
          fieldId,
        })),
      ).toEqual([
        {
          label: 'Continue Revising',
          disabled: false,
          fieldId: textareaId,
        },
        {
          label: 'Approve Visual Set',
          disabled: false,
          fieldId: textareaId,
        },
      ]);
      expect(tracker.getContext().visualPreviewEntries).toEqual(
        expectedEntries,
      );
      expect(
        tracker.getContext().visualPreviewAcceptedProposalIds,
      ).toBeUndefined();
      expect(
        await feedback.determineRoutingFromUserMessage(
          tracker.getContext(),
          buildAgentMessage({ action: PLAN_SHAPING_ACTIONS.READY }),
        ),
      ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK);
      const approval = buildReviewMessage({
        action: PLAN_SHAPING_ACTIONS.APPROVED,
        payload: {},
      });
      await feedback.processUserResponse(tracker, approval);
      expect(tracker.getContext().visualPreviewAcceptedProposalIds).toEqual(
        expectedEntries.map((entry) => entry.proposalId),
      );
      expect(tracker.getContext().visualPreviewApprovedVisuals).toEqual(
        [
          {
            proposalId: '33333333-3333-4333-8333-333333333333',
            entityId: '55555555-5555-4555-8555-555555555555',
            entityType: 'MOCKUP',
            title: 'Review surface',
            summary: 'Shows the review surface.',
          },
          {
            proposalId: '44444444-4444-4444-8444-444444444444',
            entityId: '66666666-6666-4666-8666-666666666666',
            entityType: 'DIAGRAM',
            title: 'Review sequence',
            summary: '',
          },
        ].slice(0, statuses.length),
      );
      expect(
        await feedback.determineRoutingFromUserMessage(
          tracker.getContext(),
          approval,
        ),
      ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
      expect(rows.map(({ status }) => status)).toEqual(
        statuses.map(() => 'APPROVED'),
      );
      expect(rows.map(({ status: _status, ...home }) => home)).toEqual(
        originalHomes.map(({ status: _status, ...home }) => home),
      );
      expect(prisma.db.proposal.create).not.toHaveBeenCalled();
      expect(prisma.db.proposal.update).not.toHaveBeenCalled();
      expect(prisma.db.proposal.updateMany).not.toHaveBeenCalled();
    },
  );

  it('approves only remaining drafts in the current set before advancing', async () => {
    const { rows, feedback, tracker, ready, approve } = setup([
      'DRAFT',
      'APPROVED',
    ]);
    await ready();
    const previousRoundOnly = '55555555-5555-4555-8555-555555555555';
    rows.push({ ...rows[0]!, id: previousRoundOnly, status: 'DRAFT' });
    const approval = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });
    await feedback.processUserResponse(tracker, approval);

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]?.[0]).toBe(rows[0]!.id);
    expect(approve.mock.calls.map(([id]) => id)).not.toContain(
      previousRoundOnly,
    );
    expect(rows[1]!.status).toBe('APPROVED');
    expect(rows[2]!.status).toBe('DRAFT');
    expect(
      await feedback.determineRoutingFromUserMessage(
        tracker.getContext(),
        approval,
      ),
    ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
  });

  it('skips rejected proposals in the current set', async () => {
    const { rows, feedback, tracker, ready, approve } = setup([
      'DRAFT',
      'DRAFT',
    ]);
    await ready();
    rows[1]!.status = 'REJECTED';
    const approval = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });
    await feedback.processUserResponse(tracker, approval);
    expect(approve.mock.calls.map(([id]) => id)).toEqual([rows[0]!.id]);
    expect(rows[1]!.status).toBe('REJECTED');
    expect(
      await feedback.determineRoutingFromUserMessage(
        tracker.getContext(),
        approval,
      ),
    ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
  });

  it('keeps the gate active with an actionable failure and retries only the remainder', async () => {
    const { rows, feedback, tracker, ready, approve } = setup([
      'DRAFT',
      'DRAFT',
    ]);
    await ready();
    approve.mockImplementationOnce(async (proposalId: string) => {
      rows.find((row) => row.id === proposalId)!.status = 'APPROVED';
      return { enacted: true, resultingEntityId: proposalId };
    });
    approve.mockRejectedValueOnce(new Error('approval failed'));
    const approval = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });
    await feedback.processUserResponse(tracker, approval);

    expect(
      await feedback.determineRoutingFromUserMessage(
        tracker.getContext(),
        approval,
      ),
    ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK);
    expect(rows.map(({ status }) => status)).toEqual(['APPROVED', 'DRAFT']);
    expect(
      tracker.getContext().visualPreviewAcceptedProposalIds,
    ).toBeUndefined();
    const gate = await feedback.execute(tracker);
    expect(gate.message).toContain('1 of the remaining visual proposals');
    expect(gate.uiElements).toContainEqual(
      expect.objectContaining({
        type: ExtendedUIFieldType.PlanGenerationVisualPreview,
        payload: { responseType: 'plan_generation_visual_preview_v1', entries },
      }),
    );

    approve.mockClear();
    const retry = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });
    await feedback.processUserResponse(tracker, retry);
    expect(approve.mock.calls.map(([id]) => id)).toEqual([rows[1]!.id]);
    expect(
      await feedback.determineRoutingFromUserMessage(
        tracker.getContext(),
        retry,
      ),
    ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
    expect(tracker.getContext().visualPreviewApprovalFailure).toBeUndefined();
  });

  it('preserves sanitized diagnostics and the current set across failure, manual approval, and reload', async () => {
    const { rows, feedback, tracker, ready, approve } = setup([
      'DRAFT',
      'DRAFT',
    ]);
    await ready();
    const logger = new CustomLoggerService();
    const records: ReturnType<CustomLoggerService['buildEnvelopeForTest']>[] =
      [];
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((message, ...params) => {
        records.push(logger.buildEnvelopeForTest('error', message, ...params));
      });
    try {
      approve.mockRejectedValueOnce(
        new Error('approval rejected password=hidden', {
          cause: new Error('database constraint failed token=private'),
        }),
      );
      const submission = buildReviewMessage({
        action: PLAN_SHAPING_ACTIONS.APPROVED,
        payload: {},
      });
      await feedback.processUserResponse(tracker, submission);
      expect(rows.map(({ status }) => status)).toEqual(['DRAFT', 'APPROVED']);
      expect(records).toContainEqual(
        expect.objectContaining({
          conversationId: tracker.getContext().core.conversationId,
          proposalId: rows[0]!.id,
          errorMessage: expect.stringContaining('approval rejected'),
          errorCause: expect.stringContaining('database constraint failed'),
        }),
      );
      expect(JSON.stringify(records)).not.toMatch(/hidden|private/);

      // Individual approval does not record complete-set acceptance. Reload
      // uses the persisted flow context and regenerates the current gate.
      rows[0]!.status = 'APPROVED';
      const persisted: PlanFromDesignDocFlowContext = JSON.parse(
        JSON.stringify(tracker.getContext()),
      );
      const reloaded = createMutableContextHandle(persisted);
      const gate = await feedback.execute(reloaded);
      expect(gate.uiElements).toContainEqual(
        expect.objectContaining({
          type: ExtendedUIFieldType.PlanGenerationVisualPreview,
          payload: {
            responseType: 'plan_generation_visual_preview_v1',
            entries,
          },
        }),
      );
      expect(
        reloaded.getContext().visualPreviewAcceptedProposalIds,
      ).toBeUndefined();
      expect(
        await feedback.determineRoutingFromUserMessage(
          reloaded.getContext(),
          submission,
        ),
      ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK);
      approve.mockClear();
      const retry = buildReviewMessage({
        action: PLAN_SHAPING_ACTIONS.APPROVED,
        payload: {},
      });
      await feedback.processUserResponse(reloaded, retry);
      expect(approve).not.toHaveBeenCalled();
      expect(reloaded.getContext().visualPreviewAcceptedProposalIds).toEqual(
        entries.map(({ proposalId }) => proposalId),
      );
      expect(
        await feedback.determineRoutingFromUserMessage(
          reloaded.getContext(),
          retry,
        ),
      ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
    } finally {
      log.mockRestore();
    }
  });

  it('treats an approval that was not enacted as a failure', async () => {
    const { feedback, tracker, ready, approve } = setup(['DRAFT']);
    await ready();
    approve.mockResolvedValueOnce({ enacted: false, resultingEntityId: '' });
    const approval = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });
    await feedback.processUserResponse(tracker, approval);
    expect(
      await feedback.determineRoutingFromUserMessage(
        tracker.getContext(),
        approval,
      ),
    ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK);
  });

  it('refreshes reused proposal statuses and retains ordered relationships during refinement', async () => {
    const { rows, preview, feedback, tracker, ready } = setup([
      'DRAFT',
      'APPROVED',
    ]);
    await ready();
    await feedback.execute(tracker);
    const revision = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.REFINE,
      payload: { feedback: 'Clarify the diagram' },
    });
    await feedback.processUserResponse(tracker, revision);
    expect(
      await feedback.determineRoutingFromUserMessage(
        tracker.getContext(),
        revision,
      ),
    ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW);
    rows[0]!.status = 'APPROVED';
    rows[1]!.status = 'REJECTED';
    const trigger = await preview.buildTriggerMessage(tracker);
    expect(trigger.triggersAgent).toMatchObject({
      payload: {
        refinementRound: 1,
        feedback: 'Clarify the diagram',
        acceptedProposalIds: [],
        entries: [
          { ...entries[0], status: 'APPROVED' },
          { ...entries[1], status: 'REJECTED' },
        ],
      },
    });
    expect(
      tracker.getContext().visualPreviewAcceptedProposalIds,
    ).toBeUndefined();
  });

  it('carries the materialized Mockup/Diagram only for approved entries whose work item resolves', async () => {
    const { prisma, preview, tracker } = setup(['APPROVED', 'APPROVED']);
    tracker.mutate((draft) => {
      draft.visualPreviewEntries = [
        ...entries,
        {
          proposalId: '55555555-5555-4555-8555-555555555555',
          artifactFamily: 'mockup',
          presentationOrder: 2,
        },
      ];
    });
    const mockupId = '66666666-6666-4666-8666-666666666666';
    const archivedDiagramId = '77777777-7777-4777-8777-777777777777';
    prisma.db.proposal.findMany.mockResolvedValue([
      {
        id: entries[0]!.proposalId,
        status: 'APPROVED',
        action: 'CREATE',
        targetEntityId: mockupId,
        targetEntityType: 'TASK',
      },
      {
        id: entries[1]!.proposalId,
        status: 'APPROVED',
        action: 'CREATE',
        targetEntityId: archivedDiagramId,
        targetEntityType: 'TASK',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        status: 'DRAFT',
        action: 'CREATE',
        targetEntityId: '88888888-8888-4888-8888-888888888888',
        targetEntityType: 'TASK',
      },
    ]);
    prisma.db.task.findMany.mockResolvedValue([{ id: mockupId }]);

    const trigger = await preview.buildTriggerMessage(tracker);
    const visualPreviewTrigger = trigger.triggersAgent;
    expect(visualPreviewTrigger?.promptType).toBe(
      'plan_shaping_visual_preview',
    );
    if (visualPreviewTrigger?.promptType !== 'plan_shaping_visual_preview') {
      throw new Error('Expected visual-preview trigger.');
    }
    const payloadEntries = visualPreviewTrigger.payload.entries;

    expect(payloadEntries.map((entry) => entry.proposalId)).toEqual([
      entries[0]!.proposalId,
      entries[1]!.proposalId,
      '55555555-5555-4555-8555-555555555555',
    ]);
    expect(payloadEntries[0]!.materializedEntity).toEqual({
      entityId: mockupId,
      entityType: 'TASK',
    });
    expect(payloadEntries[1]).not.toHaveProperty('materializedEntity');
    expect(payloadEntries[2]).not.toHaveProperty('materializedEntity');
    expect(prisma.db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [mockupId, archivedDiagramId] },
          archivedAt: null,
        }),
      }),
    );
  });

  it('excludes rejected entries from presentation and rereads status before acceptance', async () => {
    const { rows, feedback, tracker, ready } = setup(['APPROVED', 'REJECTED']);
    await ready();
    await feedback.execute(tracker);
    expect(tracker.getContext().visualPreviewEntries).toEqual([entries[0]]);
    rows[0]!.status = 'REJECTED';
    const approval = buildReviewMessage({
      action: PLAN_SHAPING_ACTIONS.APPROVED,
      payload: {},
    });
    await feedback.processUserResponse(tracker, approval);
    expect(
      tracker.getContext().visualPreviewAcceptedProposalIds,
    ).toBeUndefined();
    expect(
      await feedback.determineRoutingFromUserMessage(
        tracker.getContext(),
        approval,
      ),
    ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK);
    await expect(feedback.execute(tracker)).rejects.toThrow(
      'cannot execute without visual proposals',
    );
  });

  describe.each(['missing', 'foreign organization', 'foreign project'])(
    '%s identity',
    (invalidKind) => {
      it.each([1, 2])(
        'rejects a %s-entry set before capture, presentation, or acceptance',
        async (count) => {
          const { rows, preview, feedback, tracker, ready } = setup(
            Array(count).fill('APPROVED'),
          );
          const invalidRow = rows[count - 1]!;
          if (invalidKind === 'missing') rows.pop();
          if (invalidKind === 'foreign organization')
            invalidRow.organizationId = 'foreign-organization';
          if (invalidKind === 'foreign project')
            invalidRow.projectId = 'foreign-project';
          const before = tracker.getContext();
          await expect(ready()).rejects.toThrow(
            'proposal identities are no longer available',
          );
          expect(tracker.getContext()).toEqual(before);
          tracker.mutate((draft) => {
            draft.visualPreviewEntries = entries.slice(0, count);
          });
          const beforeReview = tracker.getContext();
          await expect(preview.buildTriggerMessage(tracker)).rejects.toThrow(
            'proposal identities are no longer available',
          );
          await expect(feedback.execute(tracker)).rejects.toThrow(
            'proposal identities are no longer available',
          );
          await expect(
            feedback.processUserResponse(
              tracker,
              buildReviewMessage({
                action: PLAN_SHAPING_ACTIONS.APPROVED,
                payload: {},
              }),
            ),
          ).rejects.toThrow('proposal identities are no longer available');
          expect(tracker.getContext()).toEqual(beforeReview);
          expect(
            tracker.getContext().visualPreviewAcceptedProposalIds,
          ).toBeUndefined();
        },
      );
    },
  );
});

describe('PlanShapingVisualPreviewFeedbackNode', () => {
  it('renders feedback with the authoritative current visual set', async () => {
    const proposalId = '44444444-4444-4444-8444-444444444444';
    const node = new PlanShapingVisualPreviewFeedbackNode(
      {
        db: {
          proposal: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: proposalId, status: 'DRAFT' }]),
          },
        },
      } as never,
      { approve: jest.fn() } as never,
    );
    const tracker = createMutableContextHandle(
      buildContext({
        visualPreviewEntries: [
          {
            proposalId,
            artifactFamily: 'mockup',
            presentationOrder: 0,
          },
        ],
      }),
    );

    const result = await node.execute(tracker);
    const element = result.uiElements?.[1];

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements).toHaveLength(2);
    expect(result.uiElements?.[0]).toMatchObject({
      type: ExtendedUIFieldType.PlanGenerationVisualPreview,
      payload: {
        responseType: 'plan_generation_visual_preview_v1',
        entries: tracker.getContext().visualPreviewEntries,
      },
    });
    expect(element).toMatchObject({
      type: ExtendedUIFieldType.Textarea,
      label: 'Feedback on the visual plan preview',
      multiline: true,
    });
    expect(element?.payload).toBeUndefined();

    const secondaryActions = (
      result.data as { secondaryActions?: SecondaryActionConfig[] }
    ).secondaryActions;
    expect(secondaryActions).toHaveLength(2);
    expect(
      secondaryActions?.every((action) => action.fieldId === element?.id),
    ).toBe(true);
  });
});

describe('PlanShapingStepReviewNode', () => {
  let node: PlanShapingStepReviewNode;
  let materializeSpy: jest.Mock;

  const STEP_REVIEW_UUID_A = '77777777-7777-4777-8777-777777777777';
  const STEP_REVIEW_UUID_B = '88888888-8888-4888-8888-888888888888';

  it('preserves the reviewed bucket when acceptance-time admission rejects changed state', async () => {
    const rejecting = new PlanShapingStepReviewNode(
      { materializeAccumulatedPhases: jest.fn() } as never,
      buildSeedStub(),
      {
        prepare: jest.fn().mockResolvedValue({
          findings: [
            {
              field: '/plan/steps/0/id',
              code: 'duplicate_identity',
              reason: 'Duplicate.',
            },
          ],
          advisories: [],
        }),
      } as never,
    );
    const existingPlan = buildPhasePlan();
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ stageId: STAGE_A_UUID })],
        accumulatedPhases: { 0: { 0: existingPlan } },
      }),
    );
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
      payload: {
        stageIdx: 0,
        plan: buildPhasePlan({ stepId: STEP_REVIEW_UUID_B }),
      },
    });

    await rejecting.processUserResponse(tracker, message);

    expect(tracker.getContext().accumulatedPhases?.[0]?.[0]).toEqual(
      existingPlan,
    );
    expect(tracker.getContext().reviewedStages).toBeUndefined();
    expect(message.data).toMatchObject({
      action: PLAN_SHAPING_ACTIONS.ERROR,
      payload: { reason: 'agent_submission_error' },
    });
  });

  beforeEach(() => {
    materializeSpy = jest.fn().mockResolvedValue({
      materializedStepIds: [],
    });
    node = new PlanShapingStepReviewNode(
      {
        materializeAccumulatedPhases: materializeSpy,
      } as unknown as ConstructorParameters<
        typeof PlanShapingStepReviewNode
      >[0],
      buildSeedStub(),
      buildAdmissionStub() as never,
    );
  });

  // Build a single-step phase plan bound to a specific stageId. The
  // reviewed step set re-uses the same shape — replace-the-stage-set
  // semantics, so the agent's tightened output is just another
  // PhaseBreakdownPlan with the (possibly different) tightened steps.
  const buildPhasePlan = (
    overrides: { stepId?: string; stageId?: string } = {},
  ): PhaseBreakdownPlan =>
    ({
      steps: [
        {
          id: overrides.stepId ?? STEP_REVIEW_UUID_A,
          stageId: overrides.stageId ?? STAGE_A_UUID,
          title: 'Drafted step',
          description: 'Drafted body',
          acceptanceCriteria: '- drafted done',
          type: PhaseBreakdownStepType.TASK,
          sequenceOrder: 0,
        },
      ],
    }) as PhaseBreakdownPlan;

  it('emits an EXTERNAL_AGENT result carrying a plan_shaping_step_review trigger on entry', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ id: 's0' })],
        accumulatedPhases: { 0: { 0: buildPhasePlan() } },
      }),
    );

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.triggersAgent?.promptType).toBe(
      LocalPromptType.plan_shaping_step_review,
    );
    expect(result.triggersAgent?.nodeId).toBe(PLAN_SHAPING_NODES.STEP_REVIEW);
  });

  it('declares the STEP_REVIEW_DONE action schema plus the synthesized ERROR completion', () => {
    expect(node.actions).toBe(planShapingStepReviewActions);
    // ERROR is registered alongside STEP_REVIEW_DONE so the engine's
    // re-validation inside resolveExternalAgentRouting accepts the
    // mismatch completion processUserResponse rewrites onto
    // userMessage.data.
    expect(Object.keys(node.actions)).toEqual([
      PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
      PLAN_SHAPING_ACTIONS.ERROR,
    ]);
  });

  it('accepts a CLI-reported submission ERROR payload without requiring a cursor-mismatch shape', () => {
    const result = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.STEP_REVIEW,
      actions: node.actions,
      message: buildAgentMessage({
        action: PLAN_SHAPING_ACTIONS.ERROR,
        payload: {
          reason: 'agent_submission_error',
          message:
            'submit_step_review received an invalid payload: plan.steps.2.stageId: stageId must be a UUID',
        },
      }),
    });

    expect(result.action).toBe(PLAN_SHAPING_ACTIONS.ERROR);
  });

  it('stamps stageIdx=0 and totalStages onto the trigger payload when reviewedStages is empty', async () => {
    const a0 = buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID });
    const a1 = buildJourneyStep({ id: 'a1', stageId: STAGE_A_UUID });
    const b0 = buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID });
    const planA0 = buildPhasePlan({ stepId: STEP_REVIEW_UUID_A });
    const planA1 = buildPhasePlan({ stepId: STEP_REVIEW_UUID_B });
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [a0, a1, b0],
        accumulatedPhases: {
          0: { 0: planA0, 1: planA1 },
          1: { 0: buildPhasePlan({ stageId: STAGE_B_UUID }) },
        },
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as {
        payload: {
          stageIdx: number;
          totalStages: number;
          steps: Array<{ id: string; stageId: string }>;
          designDocId: string;
          planId: string;
        };
      }
    ).payload;
    expect(payload.stageIdx).toBe(0);
    // Two distinct durable stages in the journey — totalStages = 2.
    expect(payload.totalStages).toBe(2);
    expect(payload.designDocId).toBe(VALID_DESIGN_DOC_ID);
    expect(payload.planId).toBe(VALID_PLAN_ID);
    // Stage 0's drafted steps are flattened in phaseIdx order: phase
    // 0's step (A) first, phase 1's step (B) second.
    expect(payload.steps.map((s) => s.id)).toEqual([
      STEP_REVIEW_UUID_A,
      STEP_REVIEW_UUID_B,
    ]);
    // Every drafted step keeps the durable stageId it came in with.
    expect(payload.steps.every((s) => s.stageId === STAGE_A_UUID)).toBe(true);
  });

  it('derives the next expected stageIdx from reviewedStages, crossing into the next stage', async () => {
    const a0 = buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID });
    const b0 = buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID });
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [a0, b0],
        accumulatedPhases: {
          0: { 0: buildPhasePlan({ stageId: STAGE_A_UUID }) },
          1: { 0: buildPhasePlan({ stageId: STAGE_B_UUID }) },
        },
        // Stage 0 already reviewed — the next cursor is stage 1.
        reviewedStages: { 0: true },
      }),
    );

    const result = await node.execute(tracker);

    const payload = (
      result.triggersAgent as unknown as { payload: { stageIdx: number } }
    ).payload;
    expect(payload.stageIdx).toBe(1);
  });

  it('throws when every stage is already reviewed so the workflow surfaces the misuse rather than spinning', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep()],
        accumulatedPhases: { 0: { 0: buildPhasePlan() } },
        reviewedStages: { 0: true },
      }),
    );

    await expect(node.execute(tracker)).rejects.toThrow();
  });

  it('on STEP_REVIEW_DONE, overwrites accumulatedPhases[stageIdx] with a single synthetic phase and marks reviewedStages', async () => {
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ id: 's0' })],
        // Two drafted phases on stage 0 — the review collapses them
        // into one synthetic phase carrying the tightened set.
        accumulatedPhases: {
          0: {
            0: buildPhasePlan({ stepId: STEP_REVIEW_UUID_A }),
            1: buildPhasePlan({ stepId: STEP_REVIEW_UUID_B }),
          },
        },
      }),
    );

    const tightened = buildPhasePlan({ stepId: STEP_REVIEW_UUID_A });
    tightened.steps.push({
      ...tightened.steps[0]!,
      id: STEP_REVIEW_UUID_B,
      dependsOnStepIds: [STEP_REVIEW_UUID_A],
    });
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
      payload: { stageIdx: 0, plan: tightened },
    });

    await node.processUserResponse(tracker, message);

    const ctx = tracker.getContext();
    // The two drafted phase keys were replaced by a single synthetic
    // phase key 0 carrying the tightened steps — materialization
    // walks `[stageIdx][phaseIdx]` and groups by stageId, so this
    // produces identical-shape output without a service-side change.
    expect(Object.keys(ctx.accumulatedPhases?.[0] ?? {})).toEqual(['0']);
    expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(tightened);
    expect(ctx.reviewedStages?.[0]).toBe(true);
  });

  it('idempotent overwrite: re-emitting the most-recently-reviewed stage overwrites that bucket without erroring', async () => {
    const tightenedFirst = buildPhasePlan({ stepId: STEP_REVIEW_UUID_A });
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [
          buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID }),
          buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID }),
        ],
        accumulatedPhases: {
          0: { 0: tightenedFirst },
          1: { 0: buildPhasePlan({ stageId: STAGE_B_UUID }) },
        },
        reviewedStages: { 0: true },
      }),
    );

    const overwrite = buildPhasePlan({ stepId: STEP_REVIEW_UUID_B });
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
      // expected is stage 1; agent re-emits stage 0 — idempotent retry.
      payload: { stageIdx: 0, plan: overwrite },
    });

    await node.processUserResponse(tracker, message);

    const ctx = tracker.getContext();
    expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(overwrite);
    // Action discriminator unchanged — no ERROR synthesis on the
    // idempotent path.
    expect((message.data as Record<string, unknown>)['action']).toBe(
      PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
    );
  });

  it('mismatch: emitting an unexpected stageIdx synthesizes an ERROR completion and leaves both buckets unchanged', async () => {
    const draftedStage0 = buildPhasePlan({ stepId: STEP_REVIEW_UUID_A });
    const draftedStage1 = buildPhasePlan({ stageId: STAGE_B_UUID });
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [
          buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID }),
          buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID }),
        ],
        accumulatedPhases: { 0: { 0: draftedStage0 }, 1: { 0: draftedStage1 } },
        reviewedStages: { 0: true },
      }),
    );

    const rogue = buildPhasePlan({ stepId: STEP_REVIEW_UUID_B });
    const message = buildAgentMessage({
      action: PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
      // expected is stage 1; emitting stage 5 is neither expected nor
      // the most-recently-reviewed stage (which is 0).
      payload: { stageIdx: 5, plan: rogue },
    });

    await node.processUserResponse(tracker, message);

    const ctx = tracker.getContext();
    // Both buckets untouched — the rogue stage 5 was NOT written.
    expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(draftedStage0);
    expect(ctx.accumulatedPhases?.[1]?.[0]).toEqual(draftedStage1);
    expect(ctx.reviewedStages).toEqual({ 0: true });

    // userMessage.data was rewritten with the synthesized ERROR
    // completion carrying the expected and provided stage cursors.
    const data = message.data as Record<string, unknown>;
    expect(data['action']).toBe(PLAN_SHAPING_ACTIONS.ERROR);
    expect(data['payload']).toEqual({
      reason: 'stage_idx_mismatch',
      expected: { stageIdx: 1 },
      provided: { stageIdx: 5 },
    });

    // Wire-shape self-consistency: the engine re-runs
    // validateExternalAgentCompletion against the *rewritten* message
    // inside resolveExternalAgentRouting. ERROR must be a registered
    // action or that re-validation throws `unknown_action` and the
    // synthesized failure detail never reaches the routing layer.
    const revalidated = validateExternalAgentCompletion({
      nodeId: PLAN_SHAPING_NODES.STEP_REVIEW,
      actions: node.actions,
      message,
    });
    expect(revalidated.action).toBe(PLAN_SHAPING_ACTIONS.ERROR);
  });

  it('genuine fall-through: marking reviewedStages without touching accumulatedPhases lets the un-tightened drafted steps land', async () => {
    // Genuine agent/tool failure is the second ERROR class — the flow
    // marks the stage as reviewed-as-drafted (the drafted steps stay
    // in accumulatedPhases untouched) and advances. Modeled here as a
    // direct mutation matching what the fall-through path produces, so
    // the routing hook sees the advance and the drafted steps remain
    // intact for materialization.
    const draftedStage0 = buildPhasePlan({ stepId: STEP_REVIEW_UUID_A });
    const tracker = createMutableContextHandle(
      buildContext({
        journeySteps: [buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID })],
        accumulatedPhases: { 0: { 0: draftedStage0 } },
      }),
    );

    tracker.mutate((draft) => {
      const reviewed = draft.reviewedStages ?? {};
      reviewed[0] = true;
      draft.reviewedStages = reviewed;
    });

    const ctx = tracker.getContext();
    // Drafted steps untouched — they will land un-tightened.
    expect(ctx.accumulatedPhases?.[0]?.[0]).toEqual(draftedStage0);
    expect(ctx.reviewedStages?.[0]).toBe(true);
  });

  it('determineRoutingFromAgentCompletion returns STEP_REVIEW while another stage remains without invoking materialization', async () => {
    const next = await node.determineRoutingFromAgentCompletion!(
      buildContext({
        journeySteps: [
          buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID }),
          buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID }),
        ],
        accumulatedPhases: {
          0: { 0: buildPhasePlan({ stageId: STAGE_A_UUID }) },
          1: { 0: buildPhasePlan({ stageId: STAGE_B_UUID }) },
        },
        reviewedStages: { 0: true },
      }),
      PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
    );

    expect(next).toBe(PLAN_SHAPING_NODES.STEP_REVIEW);
    expect(materializeSpy).not.toHaveBeenCalled();
  });

  it('determineRoutingFromAgentCompletion materializes exactly once on the final-stage STEP_REVIEW_DONE, then falls through', async () => {
    const ctx = buildContext({
      journeySteps: [
        buildJourneyStep({ id: 'a0', stageId: STAGE_A_UUID }),
        buildJourneyStep({ id: 'b0', stageId: STAGE_B_UUID }),
      ],
      accumulatedPhases: {
        0: { 0: buildPhasePlan({ stageId: STAGE_A_UUID }) },
        1: { 0: buildPhasePlan({ stageId: STAGE_B_UUID }) },
      },
      reviewedStages: { 0: true, 1: true },
    });

    const next = await node.determineRoutingFromAgentCompletion!(
      ctx,
      PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
    );

    expect(next).toBeUndefined();
    expect(materializeSpy).toHaveBeenCalledTimes(1);
    expect(materializeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accumulatedPhases: ctx.accumulatedPhases,
        planId: VALID_PLAN_ID,
        designDocId: VALID_DESIGN_DOC_ID,
        conversationId: ctx.core.conversationId,
        organizationId: ctx.core.organizationId,
        projectId: ctx.core.projectId,
        userId: ctx.core.user.id,
      }),
    );
  });

  it('determineRoutingFromAgentCompletion returns undefined for non-STEP_REVIEW_DONE actions without materializing', async () => {
    const next = await node.determineRoutingFromAgentCompletion!(
      buildContext({
        journeySteps: [buildJourneyStep()],
      }),
      'some_other_action',
    );

    expect(next).toBeUndefined();
    expect(materializeSpy).not.toHaveBeenCalled();
  });

  describe('helpers', () => {
    it('flattenStageDraftedSteps walks phaseIdx ascending and preserves stageId / sequenceOrder', () => {
      const phase0 = buildPhasePlan({ stepId: STEP_REVIEW_UUID_A });
      const phase1 = buildPhasePlan({ stepId: STEP_REVIEW_UUID_B });
      const flat = flattenStageDraftedSteps({ 1: phase1, 0: phase0 });
      expect(flat.map((s) => s.id)).toEqual([
        STEP_REVIEW_UUID_A,
        STEP_REVIEW_UUID_B,
      ]);
      expect(flat.every((s) => s.stageId === STAGE_A_UUID)).toBe(true);
    });

    it('resolveStageCursor returns the first unreviewed stageIdx with the prior as mostRecent', () => {
      expect(resolveStageCursor({}, 3)).toEqual({
        expected: 0,
        mostRecent: undefined,
      });
      expect(resolveStageCursor({ 0: true }, 3)).toEqual({
        expected: 1,
        mostRecent: 0,
      });
      expect(resolveStageCursor({ 0: true, 1: true, 2: true }, 3)).toEqual({
        expected: undefined,
        mostRecent: 2,
      });
    });

    it('synthesizeStageIdxMismatchCompletion mirrors the wire shape verbatim', () => {
      expect(
        synthesizeStageIdxMismatchCompletion({ expected: 2, provided: 4 }),
      ).toEqual({
        action: PLAN_SHAPING_ACTIONS.ERROR,
        payload: {
          reason: 'stage_idx_mismatch',
          expected: { stageIdx: 2 },
          provided: { stageIdx: 4 },
        },
      });
    });
  });
});

describe('PlanShapingFinalizeNode', () => {
  let node: PlanShapingFinalizeNode;
  let updateMock: jest.Mock;
  let taskService: Pick<TaskService, 'update'>;
  let prisma: ReturnType<typeof TestUtils.createMockPrismaService>;

  const stageA = { id: 'stage-a', sequenceOrder: 1 };
  const stageB = { id: 'stage-b', sequenceOrder: 2 };

  beforeEach(() => {
    prisma = TestUtils.createMockPrismaService();
    prisma.db.task.findFirst.mockResolvedValue({
      status: 'BACKLOG',
      subTasks: [stageA, stageB],
    });
    prisma.db.taskDependency.findMany.mockResolvedValue([
      { dependentTaskId: stageB.id },
    ]);
    updateMock = jest.fn().mockResolvedValue(undefined);
    taskService = {
      update: updateMock,
    } as unknown as Pick<TaskService, 'update'>;
    node = new PlanShapingFinalizeNode(
      {
        outgoing: jest
          .fn()
          .mockResolvedValue([
            { sourceNodeId: stageB.id, targetNodeId: stageA.id },
          ]),
      } as any,
      taskService as TaskService,
      prisma as unknown as import('src/prisma/prisma.service').PrismaService,
    );
  });

  it('emits a QUESTIONS result with no agent trigger on entry (terminal reload gate, not an external agent)', async () => {
    const tracker = createMutableContextHandle(buildContext());

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.triggersAgent).toBeUndefined();
  });

  it('suppresses free-text re-signals so the terminal node parks without re-running', () => {
    expect(node.acceptsUserMessages).toBe(false);
  });

  it('emits a PlanGenerationFinalize UI element carrying the finalize payload so the client can reload the landed plan on Ready', async () => {
    const tracker = createMutableContextHandle(buildContext());
    const ctx = tracker.getContext();

    const result = await node.execute(tracker);

    expect(result.uiElements).toHaveLength(1);
    const element = result.uiElements?.[0];
    expect(element?.type).toBe(ExtendedUIFieldType.PlanGenerationFinalize);

    const payload = element?.payload as PlanGenerationFinalizePayload;
    expect(payload).toEqual({
      responseType:
        PlanGenerationFinalizePayload.ResponseTypeEnum.PlanGenerationFinalizeV1,
      planId: ctx.core.workflowAboutId,
      firstStageId: stageA.id,
      readyButtonLabel: 'Ready',
      progressLabel: 'Finalizing your plan...',
    });
  });

  it('flips a BACKLOG Plan work item to ACTIVE on entry, addressing the workflowAboutId plan with the workflow user as author', async () => {
    const tracker = createMutableContextHandle(buildContext());
    const ctx = tracker.getContext();

    await node.execute(tracker);

    expect(prisma.db.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ctx.core.workflowAboutId,
          organizationId: ctx.core.organizationId,
          type: 'PLAN',
        }),
      }),
    );
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      ctx.core.organizationId,
      null,
      ctx.core.workflowAboutId,
      { status: 'ACTIVE' },
      ctx.core.user.id,
    );
  });

  it('skips the status update when the plan is already ACTIVE so re-entries stay idempotent', async () => {
    prisma.db.task.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      subTasks: [stageA, stageB],
    });
    const tracker = createMutableContextHandle(buildContext());

    await node.execute(tracker);
    await node.execute(tracker);

    expect(prisma.db.task.findFirst).toHaveBeenCalledTimes(2);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('phaseBreakdownPlanSchema', () => {
  const validStepWithoutServiceIds = {
    id: '11111111-1111-4111-8111-111111111111',
    stageId: '22222222-2222-4222-8222-222222222222',
    title: 'A step',
    description: 'A step body',
    implementation: 'Change src/foo.ts',
    acceptanceCriteria: '- A step delivers its done state',
    type: 'TASK',
    sequenceOrder: 0,
    designDocMotivation: 'The design requires this step.',
  };

  it('preserves prerequisite arrays and rejects malformed handles at completion parsing', () => {
    const dependsOnStepIds = ['33333333-3333-4333-8333-333333333333'];
    expect(
      phaseBreakdownPlanSchema.parse({
        steps: [{ ...validStepWithoutServiceIds, dependsOnStepIds }],
      }).steps[0]?.dependsOnStepIds,
    ).toEqual(dependsOnStepIds);
    expect(
      phaseBreakdownPlanSchema.safeParse({
        steps: [
          { ...validStepWithoutServiceIds, dependsOnStepIds: ['invalid'] },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts a canonical Plan Task that omits optional service ownership', () => {
    const result = phaseBreakdownPlanSchema.safeParse({
      steps: [validStepWithoutServiceIds],
    });
    expect(result.success).toBe(true);
  });

  it('accepts plural serviceIds from an external-agent completion', () => {
    const result = phaseBreakdownPlanSchema.safeParse({
      steps: [
        {
          ...validStepWithoutServiceIds,
          serviceIds: [
            '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444',
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a step whose serviceIds contains a non-UUID value', () => {
    const result = phaseBreakdownPlanSchema.safeParse({
      steps: [{ ...validStepWithoutServiceIds, serviceIds: ['not-a-uuid'] }],
    });
    expect(result.success).toBe(false);
  });
});
