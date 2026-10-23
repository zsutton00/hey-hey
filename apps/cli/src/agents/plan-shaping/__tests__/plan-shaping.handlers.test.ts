import { describe, expect, it, vi } from 'vitest';
import { createTestRun } from '../../../run/run.test-support';
import type { ReportChainEntry } from '../../../run/types';
import type { AgenticSession } from '../../../session/types';
import {
  LocalPromptType,
  PlanCombinationAggressiveness,
  PlanShapingValidationMode,
  type PlanShapingFinalizePromptPayload,
  type PlanShapingPhaseBreakdownPromptPayload,
  type PlanShapingProposedStagesPromptPayload,
  type PlanShapingRefineStagePromptPayload,
  type PlanShapingApprovedVisual,
  type PlanShapingStepReviewPromptPayload,
} from '../../../shared/agent-bridge-contract/generated/api';
import type {
  PromptTypeHandlerContext,
  PromptTypeHandlerDeps,
  UserLaunchablePromptTypeHandler,
} from '../../prompt-type-handler';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../../prompt-type-handler.test-support';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';
import { SubmissionToolCorrectableError } from '../../submission-tools/types';
import { PLAN_SHAPING_MCP_TOOLS } from '../../mcp-server-config';
import { renderApprovedVisualsBlock } from '../approved-visuals.prompt';
import { planShapingFinalizeHandler } from '../finalize.handler';
import { PlanShapingPhaseBreakdownHandler } from '../phase-breakdown.handler';
import { planShapingProposedStagesHandler } from '../proposed-stages.handler';
import { planShapingRefineStageHandler } from '../refine-stage.handler';
import { planShapingStepReviewHandler } from '../step-review.handler';
import {
  PLAN_SHAPING_ACTIONS,
  createSubmitPhaseBreakdownTool,
  submitDoneTool,
  submitPhaseBreakdownTool,
  submitProposedStagesReadyTool,
  submitReadyTool,
  submitStepReviewTool,
} from '../submission-tools';
import type { PlanSubmissionAdmissionClient } from '../plan-submission-admission.client';
import {
  PHASE_STEP_CEILING,
  phaseBreakdownCompletionPayloadSchema,
  stepReviewCompletionPayloadSchema,
} from '../journey-map.schemas';

const planShapingPhaseBreakdownHandler = new PlanShapingPhaseBreakdownHandler(
  makeCreateReportProxy(),
);

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    entity: { entityType: 'TASK', entityId: 'task-456' },
    contextMetadata: {
      capturedAt: '2026-04-24T00:00:00Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      task: { id: 'task-456', title: 'Test task' },
      fileReferences: { resolved: [], unresolved: [] },
    },
    ...overrides,
  }) as unknown as AgenticSession;

const makeLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }) as unknown as PromptTypeHandlerDeps['logger'];

const PHASE_BREAKDOWN_DESIGN_DOC_BODY =
  '# Daily-session draft\n\nThe daily-session screen lets the user inspect and confirm the day plan.';

const makeJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeFetchImpl = (
  responder: (url: string) => Response | Promise<Response> = () =>
    makeJsonResponse({
      data: {
        sections: [
          { key: 'context', order: 0, materializedMarkdown: PHASE_BREAKDOWN_DESIGN_DOC_BODY },
        ],
      },
    }),
): typeof fetch =>
  vi.fn(async (input: RequestInfo | URL) =>
    responder(typeof input === 'string' ? input : input.toString()),
  ) as unknown as typeof fetch;

interface MakeDepsOptions {
  logger?: PromptTypeHandlerDeps['logger'];
  fetchImpl?: typeof fetch;
  auth?: PromptTypeHandlerDeps['auth'];
  apiBaseUrl?: string;
}

const makeDeps = (options: MakeDepsOptions = {}): PromptTypeHandlerDeps =>
  createPromptTypeHandlerTestDeps({
    logger: options.logger ?? makeLogger(),
    fetchImpl: options.fetchImpl ?? makeFetchImpl(),
    auth: options.auth ?? createPromptTypeHandlerTestAuth(),
    apiBaseUrl: options.apiBaseUrl ?? 'https://api.test.local',
  });

interface HandlerCase {
  readonly label: string;
  readonly handler: UserLaunchablePromptTypeHandler<
    | PlanShapingProposedStagesPromptPayload
    | PlanShapingRefineStagePromptPayload
    | PlanShapingFinalizePromptPayload
    | PlanShapingPhaseBreakdownPromptPayload
  >;
  readonly promptType: LocalPromptType;
  readonly expectedSubmissionTools: readonly string[];
  readonly expectedLogEvent: string;
  readonly buildPayload: () =>
    | PlanShapingProposedStagesPromptPayload
    | PlanShapingRefineStagePromptPayload
    | PlanShapingFinalizePromptPayload
    | PlanShapingPhaseBreakdownPromptPayload;
  /** Whether the prompt renders canonical task identity from handler context. */
  readonly rendersTaskId: boolean;
}

const stagesPayload = (
  overrides: Partial<PlanShapingProposedStagesPromptPayload> = {},
): PlanShapingProposedStagesPromptPayload =>
  ({
    designDocId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    planId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    userMessage: '',
    ...overrides,
  }) as PlanShapingProposedStagesPromptPayload;

const refineStagePayload = (
  overrides: Partial<PlanShapingRefineStagePromptPayload> = {},
): PlanShapingRefineStagePromptPayload =>
  ({
    planId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    stageId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    validation: PlanShapingValidationMode.On,
    userMessage: '',
    ...overrides,
  }) as PlanShapingRefineStagePromptPayload;

const finalizePayload = (
  overrides: Partial<PlanShapingFinalizePromptPayload> = {},
): PlanShapingFinalizePromptPayload =>
  ({ userMessage: '', ...overrides }) as PlanShapingFinalizePromptPayload;

const PHASE_BREAKDOWN_DESIGN_DOC_ID = '44444444-4444-4444-4444-444444444444';
const PHASE_BREAKDOWN_PLAN_ID = '55555555-5555-5555-5555-555555555555';
const PHASE_BREAKDOWN_STAGE_ID = '99999999-9999-4999-8999-999999999999';

const buildJourneyStep = () => ({
  id: 'journey-step-1',
  stageId: PHASE_BREAKDOWN_STAGE_ID,
  title: 'Open the daily-session draft',
  description: 'The user lands on the daily-session screen and sees their draft.',
  isUserInteractive: true,
  implementationNotes: [
    {
      text: 'Render the draft from the daily-session service.',
      serviceId: '66666666-6666-6666-6666-666666666666',
      serviceName: 'daily-session',
    },
  ],
});

const APPROVED_VISUALS: PlanShapingApprovedVisual[] = [
  {
    proposalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    entityType: 'MOCKUP',
    title: 'Daily-session draft screen',
    summary: 'Shows the saved day plan with a confirm button.',
  },
  {
    proposalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    entityId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    entityType: 'DIAGRAM',
    title: 'Draft confirmation sequence',
    summary: '',
  },
];

const phaseBreakdownPayload = (
  overrides: Partial<PlanShapingPhaseBreakdownPromptPayload> = {},
): PlanShapingPhaseBreakdownPromptPayload =>
  ({
    designDocId: PHASE_BREAKDOWN_DESIGN_DOC_ID,
    planId: PHASE_BREAKDOWN_PLAN_ID,
    stageIdx: 0,
    phaseIdx: 1,
    phasesInStage: 3,
    totalPhases: 3,
    journeyStep: buildJourneyStep(),
    approvedVisuals: APPROVED_VISUALS,
    userMessage: '',
    // `_designDocBody` is stamped by the handler's `prepare()` at runtime;
    // we mirror that here so prompt-render tests that bypass `prepare()` still
    // exercise the injected "## Design doc" block end-to-end.
    _designDocBody: PHASE_BREAKDOWN_DESIGN_DOC_BODY,
    ...overrides,
  }) as PlanShapingPhaseBreakdownPromptPayload;

const stepReviewPayload = (
  overrides: Partial<PlanShapingStepReviewPromptPayload> = {},
): PlanShapingStepReviewPromptPayload =>
  ({
    designDocId: PHASE_BREAKDOWN_DESIGN_DOC_ID,
    planId: PHASE_BREAKDOWN_PLAN_ID,
    stageIdx: 0,
    totalStages: 2,
    approvedVisuals: APPROVED_VISUALS,
    steps: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        stageId: PHASE_BREAKDOWN_STAGE_ID,
        title: 'Render the daily-session draft',
        description: 'Show the saved day plan before confirmation.',
        implementation: 'Read the draft state and render it in the daily-session surface.',
        type: 'TASK',
        sequenceOrder: 0,
        designDocMotivation:
          'The design doc requires the user to inspect the daily plan before confirming it.',
        acceptanceCriteria: '- The daily-session screen renders the saved draft.',
      },
    ],
    userMessage: '',
    _designDocBody: PHASE_BREAKDOWN_DESIGN_DOC_BODY,
    ...overrides,
  }) as PlanShapingStepReviewPromptPayload;

const HANDLERS: HandlerCase[] = [
  {
    label: 'proposed-stages',
    handler: planShapingProposedStagesHandler as HandlerCase['handler'],
    promptType: LocalPromptType.PlanShapingProposedStages,
    expectedSubmissionTools: ['submit_proposed_stages_ready'],
    expectedLogEvent: 'plan_shaping_proposed_stages.prepare.turn_starting',
    buildPayload: () => stagesPayload(),
    rendersTaskId: false,
  },
  {
    label: 'refine-stage',
    handler: planShapingRefineStageHandler as HandlerCase['handler'],
    promptType: LocalPromptType.PlanShapingRefineStage,
    expectedSubmissionTools: ['submit_ready'],
    expectedLogEvent: 'plan_shaping_refine_stage.prepare.turn_starting',
    buildPayload: () => refineStagePayload(),
    rendersTaskId: true,
  },
  {
    label: 'finalize',
    handler: planShapingFinalizeHandler as HandlerCase['handler'],
    promptType: LocalPromptType.PlanShapingFinalize,
    expectedSubmissionTools: ['submit_done'],
    expectedLogEvent: 'plan_shaping_finalize.prepare.turn_starting',
    buildPayload: () => finalizePayload(),
    rendersTaskId: true,
  },
  {
    label: 'phase-breakdown',
    handler: planShapingPhaseBreakdownHandler as HandlerCase['handler'],
    promptType: LocalPromptType.PlanShapingPhaseBreakdown,
    expectedSubmissionTools: ['submit_phase_breakdown', 'create_phase_grounding'],
    expectedLogEvent: 'plan_shaping_phase_breakdown.prepare.turn_starting',
    buildPayload: () => phaseBreakdownPayload(),
    rendersTaskId: true,
  },
];

const TASK_ID_RENDERING_HANDLERS: HandlerCase[] = HANDLERS.filter((h) => h.rendersTaskId);

const TASK_HANDLER_CONTEXT: PromptTypeHandlerContext = {
  entity: { entityType: 'TASK', entityId: 'task-456' },
  recentUserReplies: [],
  triggerParentMessageId: null,
};

describe.each(HANDLERS)(
  '$label handler',
  ({
    handler,
    promptType,
    expectedSubmissionTools,
    expectedLogEvent,
    buildPayload,
    rendersTaskId,
    label,
  }) => {
    it('registers under the expected prompt type', () => {
      expect(handler.promptType).toBe(promptType);
    });

    it(`exposes exactly the ${expectedSubmissionTools.join(' + ')} submission tool(s)`, () => {
      const names = handler.submissionTools?.map((t) => t.name) ?? [];
      expect(names).toEqual([...expectedSubmissionTools]);
    });

    it('runs on the run-persisted provider session', () => {
      expect(handler.runnerKind).toBe('provider_session');
    });

    describe('prepare', () => {
      it('logs the turn kind at info level for initial and follow-up turns', async () => {
        const logger = makeLogger();
        const deps = makeDeps({ logger });

        await handler.prepare!(makeSession(), buildPayload(), deps);
        await handler.prepare!(
          makeSession(),
          { ...buildPayload(), userMessage: 'adjust the third stage' } as ReturnType<
            typeof buildPayload
          >,
          deps,
        );

        const allInfoCalls = (logger.info as unknown as { mock: { calls: unknown[][] } }).mock
          .calls;
        const turnStartingCalls = allInfoCalls.filter(
          (call) => (call as [string, ...unknown[]])[0] === expectedLogEvent,
        );
        expect(turnStartingCalls).toHaveLength(2);

        const [initialEvent, initialFields] = turnStartingCalls[0] as [
          string,
          Record<string, unknown>,
        ];
        expect(initialEvent).toBe(expectedLogEvent);
        expect(initialFields).toMatchObject({
          runId: 'run-1',
          taskId: 'task-456',
          turnKind: 'initial',
          userMessageLength: 0,
        });

        const [followUpEvent, followUpFields] = turnStartingCalls[1] as [
          string,
          Record<string, unknown>,
        ];
        expect(followUpEvent).toBe(expectedLogEvent);
        expect(followUpFields).toMatchObject({
          runId: 'run-1',
          taskId: 'task-456',
          turnKind: 'follow_up',
        });
        expect((followUpFields['userMessageLength'] as number) > 0).toBe(true);
      });
    });

    describe('buildPrompt', () => {
      it('renders the termination suffix and no longer weaves in the user message', () => {
        const payload = {
          ...buildPayload(),
          userMessage: 'here is my outcome statement',
        } as ReturnType<typeof buildPayload>;
        const prompt = handler.buildPrompt(payload, TASK_HANDLER_CONTEXT);
        // Injection moved to the resolver via addUserMessage.
        expect(prompt).not.toContain('here is my outcome statement');
        expect(prompt).not.toContain('User message for this turn');
        for (const toolName of expectedSubmissionTools) {
          expect(prompt).toContain(toolName);
        }
        expect(prompt).toMatch(/submission tools appear in your catalog/i);
        if (rendersTaskId) {
          expect(prompt).toContain('task-456');
        } else {
          expect(prompt).not.toContain('Current task id:');
        }
      });

      it('omits the task-id line when unset', () => {
        const prompt = handler.buildPrompt(buildPayload());
        expect(prompt).not.toContain('User message for this turn');
        expect(prompt).not.toContain('Current task id:');
      });

      it('addUserMessage formats the message under the turn label, or null when unset', () => {
        expect(
          handler.addUserMessage({
            ...buildPayload(),
            userMessage: 'here is my outcome statement',
          } as ReturnType<typeof buildPayload>),
        ).toBe('\n\nUser message for this turn:\nhere is my outcome statement');
        expect(handler.addUserMessage(buildPayload())).toBeNull();
      });

      if (label === 'proposed-stages') {
        it('does not render the Current task id: line even when prepare ran with task context', async () => {
          const prepared = await handler.prepare!(makeSession(), buildPayload(), makeDeps());
          const prompt = handler.buildPrompt(prepared.payload, TASK_HANDLER_CONTEXT);
          expect(prompt).not.toContain('Current task id:');
          expect(prompt).not.toContain('task-456');
        });
      }

      it('enforces the user-facing register rules (no tool names, no meta-narration)', () => {
        const prompt = handler.buildPrompt(buildPayload());
        expect(prompt).toMatch(/(?:never name the tools you use|speak in product terms)/i);
        expect(prompt).toMatch(/(?:never meta-narrate|do not expose tool names)/i);
      });

      it('frames the agent to the user as a collaborative planner, not as "the plan-generation agent"', () => {
        const prompt = handler.buildPrompt(buildPayload());
        expect(prompt).toMatch(/collaborative planner/i);
        expect(prompt).not.toMatch(/you are the plan-generation[^.]*agent/i);
      });
    });
  },
);

describe.each(TASK_ID_RENDERING_HANDLERS)(
  '$label handler persisted Run identity',
  ({ handler, buildPayload }) => {
    it('does not duplicate Run identity onto the prepared payload', async () => {
      const result = await handler.prepare!(makeSession(), buildPayload(), makeDeps());
      expect(result.payload).not.toHaveProperty('_taskId');
    });

    it('ignores duplicate task identity in context metadata', async () => {
      const session = makeSession({
        contextMetadata: {
          ...makeSession().contextMetadata,
          task: { ...makeSession().contextMetadata.task!, id: 'stale-task' },
        },
      });
      const result = await handler.prepare!(session, buildPayload(), makeDeps());
      expect(result.payload).not.toHaveProperty('_taskId');
      expect(handler.buildPrompt(result.payload, TASK_HANDLER_CONTEXT)).toContain('task-456');
      expect(handler.buildPrompt(result.payload, TASK_HANDLER_CONTEXT)).not.toContain('stale-task');
    });
  },
);

describe('proposed-stages handler prompt', () => {
  const STAGES_DESIGN_DOC_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STAGES_PLAN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const buildStagesPrompt = (overrides: Partial<PlanShapingProposedStagesPromptPayload> = {}) =>
    planShapingProposedStagesHandler.buildPrompt({
      userMessage: '',
      designDocId: STAGES_DESIGN_DOC_ID,
      planId: STAGES_PLAN_ID,
      ...overrides,
    } as PlanShapingProposedStagesPromptPayload);

  it('names the canonical stage work-item authoring surface', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toContain('create_work_item');
    expect(prompt).toContain('PLAN_STAGE');
    expect(prompt).toContain('update_proposal');
    expect(prompt).toContain('independent SINGLE proposals');
    expect(prompt).toContain('do not start or require a proposal group');
    expect(prompt).not.toMatch(/groupContext|start_proposal_group|finalize_proposal_group/i);
  });

  it('spells out the independent proposal dependency sequence and exact response field', () => {
    const prompt = buildStagesPrompt();

    expect(prompt).toContain('structuredContent.proposalId');
    expect(prompt).toMatch(/Do not read `\.id`/);
    expect(prompt).toMatch(/do not use the nil `targetEntityId`/);
    expect(prompt).toContain('targetEntityType: "PROPOSAL"');
    expect(prompt).toContain('targetEntityId: predecessorProposalId');
    expect(prompt).toMatch(/missing or empty predecessor `proposalId` as a hard stop/i);
    expect(prompt).toMatch(/get_proposal[\s\S]*every Stage after the first/);
  });

  it('treats structured topology findings as correctable authoring feedback', () => {
    const prompt = buildStagesPrompt();

    expect(prompt).toContain('status: "invalid_change_set"');
    expect(prompt).toMatch(/field.*code.*reason.*metadata/);
    expect(prompt).toMatch(/correct the identified Stage or relationship and retry/i);
    expect(prompt).toMatch(/Do not call `submit_proposed_stages_ready`/);
  });

  it('does not advertise retired stage-specific tools', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).not.toContain('create_stage');
    expect(prompt).not.toContain('update_stage');
    expect(prompt).not.toContain('delete_stage');
    expect(prompt).not.toContain('reorder_stages');
  });

  it('does not name step-shaping tools — those belong to later steps', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).not.toContain('create_step');
    expect(prompt).not.toContain('update_step');
    expect(prompt).not.toContain('delete_step');
    expect(prompt).not.toContain('move_step');
  });

  it('defers step authoring, advance-to-next-stage, and status transitions', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toMatch(/stage backbone/i);
    expect(prompt).toMatch(/without authoring the steps/i);
    expect(prompt).toMatch(/do not author implementation tasks/i);
  });

  it('requires the decided total on every completion', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toContain('submit_proposed_stages_ready');
    expect(prompt).toContain('expectedStageCount');
    expect(prompt).toContain('including unchanged totals');
    expect(prompt).toContain('no new stage writes');
    expect(prompt).toMatch(/only legal turn termination on this step/i);
    expect(prompt).toMatch(/do not end the turn by asking the user a question/i);
  });

  it('covers the first-entry path and the re-entry path forwarded by Continue Revising (including tangential questions)', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toMatch(/next entry/i);
    expect(prompt).not.toMatch(/continuing the session/i);
    expect(prompt).toMatch(/continue revising/i);
    expect(prompt).toMatch(/tangential question/i);
    expect(buildStagesPrompt({ userMessage: 'revise stage 2' })).toMatch(/continuing the session/i);
  });

  it('renders the anchored design-doc and plan ids as @[type:id|...] mentions', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toContain(`@[design_doc:${STAGES_DESIGN_DOC_ID}|design doc]`);
    expect(prompt).toContain(`@[task:${STAGES_PLAN_ID}|plan]`);
  });

  it('directs the agent to fetch writing standards for PLAN_STAGE work items', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toMatch(/writing (?:standards|guidance)/i);
    expect(prompt).toContain('get_tool_guidance');
    expect(prompt).toMatch(/get_tool_guidance[\s\S]*create_work_item/);
  });

  it('requires a complete one-or-two-stage backbone to be consolidated before authoring', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toMatch(/complete stage backbone before the first .*create_work_item.* call/i);
    expect(prompt).toMatch(/expected backbone is one or two stages/i);
    expect(prompt).toMatch(/do not create three or more stages unless the user explicitly asks/i);
    expect(prompt).toMatch(/initial decomposition suggests three or more, consolidate it/i);
  });

  it('keeps component and service decomposition inside stages instead of multiplying stages', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toMatch(/components, services, technical layers, implementation phases/i);
    expect(prompt).toMatch(/belong in the steps under a stage/i);
    expect(prompt).toMatch(/not reasons to create separate stages/i);
  });

  it('directs the agent to read the design-doc body via get_full_entity, not from conversation history', () => {
    const prompt = buildStagesPrompt();
    expect(prompt).toContain('get_full_entity');
    expect(prompt).toMatch(/design-doc body/i);
    expect(prompt).toMatch(/do not rely on conversation history/i);
    expect(prompt).not.toMatch(/visible via your proposal-reading tools/i);
  });

  it('drops the "continuing the session" framing on a first-entry render and keeps it on a re-entry render', () => {
    const firstEntry = buildStagesPrompt({ userMessage: '' });
    expect(firstEntry).not.toMatch(/continuing the session/i);
    expect(firstEntry).toMatch(/stepping into a plan grounded in the user's design document/i);

    const reEntry = buildStagesPrompt({ userMessage: 'tweak stage 2 description' });
    expect(reEntry).toMatch(/continuing the session/i);
  });
});

describe('refine-stage handler prompt', () => {
  const REFINE_PLAN_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const REFINE_STAGE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  const buildRefinePrompt = (overrides: Partial<PlanShapingRefineStagePromptPayload> = {}) =>
    planShapingRefineStageHandler.buildPrompt({
      userMessage: '',
      planId: REFINE_PLAN_ID,
      stageId: REFINE_STAGE_ID,
      validation: PlanShapingValidationMode.On,
      ...overrides,
    } as PlanShapingRefineStagePromptPayload);

  it('names the canonical STANDARD work-item proposal surface', () => {
    const prompt = buildRefinePrompt();
    expect(prompt).toContain('create_work_item');
    expect(prompt).toContain('STANDARD');
    expect(prompt).toContain('update_proposal');
    expect(prompt).not.toMatch(/proposal[- ]group|groupContext/i);
  });

  it('does not advertise retired step-specific tools', () => {
    const prompt = buildRefinePrompt();
    expect(prompt).not.toContain('create_steps');
    expect(prompt).not.toContain('create_step');
    expect(prompt).not.toContain('update_step');
    expect(prompt).not.toContain('delete_step');
    expect(prompt).not.toContain('move_step');
  });

  it('does not name stage-shaping tools — refine-stage never reshapes the stage backbone', () => {
    const prompt = buildRefinePrompt();
    expect(prompt).not.toContain('create_stage');
    expect(prompt).not.toContain('update_stage');
    expect(prompt).not.toContain('delete_stage');
    expect(prompt).not.toContain('reorder_stages');
  });

  it('renders the anchored plan and stage ids as @[type:id|...] mentions', () => {
    const prompt = buildRefinePrompt();
    expect(prompt).toContain(`@[task:${REFINE_PLAN_ID}|plan]`);
    expect(prompt).toContain(`@[task:${REFINE_STAGE_ID}|stage]`);
  });

  it("directs the agent to read the stage's theme rows via get_full_entity, not from conversation history", () => {
    const prompt = buildRefinePrompt();
    expect(prompt).toContain('get_full_entity');
    expect(prompt).toMatch(/theme rows/i);
    expect(prompt).toMatch(/do not rely on conversation history/i);
  });

  it('renders a "Flags for this turn" block carrying validation but not fidelity', () => {
    const prompt = buildRefinePrompt({ validation: PlanShapingValidationMode.Off });
    expect(prompt).toMatch(/Flags for this turn/);
    expect(prompt).toMatch(/validation:\s*off/);
    expect(prompt).not.toMatch(/^\s*-\s*fidelity:/m);
  });

  it('keeps validation and fixed granular fidelity visible alongside authoring guidance', () => {
    const prompt = buildRefinePrompt();
    expect(prompt).toMatch(/get_tool_guidance[\s\S]*create_work_item/);
    expect(prompt).toMatch(/validation:\s*on/);
    expect(prompt).toMatch(/STANDARD/);
  });

  it('forbids deleting theme rows directly — the enactor handles the swap on approval', () => {
    const prompt = buildRefinePrompt();
    expect(prompt).toMatch(/existing materialized tasks remain canonical work items/i);
    expect(prompt).toMatch(/do not delete them as legacy theme rows/i);
  });

  it('documents the validation step title-prefix convention when validation=on', () => {
    const prompt = buildRefinePrompt({ validation: PlanShapingValidationMode.On });
    expect(prompt).toContain('validation:');
    expect(prompt).toMatch(/validation:\s*on/);
  });

  it('terminates the turn via submit_ready as the only legal turn termination', () => {
    const prompt = buildRefinePrompt();
    expect(prompt).toContain('submit_ready');
    expect(prompt).toMatch(/only legal turn termination on this step/i);
    expect(prompt).toMatch(/do not end the turn by asking the user a question/i);
  });

  it('drops the "continuing the session" framing on a first-entry render and keeps it on a re-entry render', () => {
    const firstEntry = buildRefinePrompt({ userMessage: '' });
    expect(firstEntry).not.toMatch(/continuing the session/i);
    expect(firstEntry).toMatch(/stepping into a stage whose theme rows the user has approved/i);

    const reEntry = buildRefinePrompt({ userMessage: 'tighten the third step' });
    expect(reEntry).toMatch(/continuing the session/i);
  });
});

describe('finalize handler prompt', () => {
  it('terminates the session via submit_done without re-proposing stages', () => {
    const prompt = planShapingFinalizeHandler.buildPrompt({
      userMessage: '',
    } as PlanShapingFinalizePromptPayload);
    expect(prompt).toContain('submit_done');
    expect(prompt).toMatch(/do not re-propose stages/i);
  });
});

describe('plan-shaping submission tools', () => {
  const makeCtx = (args: Record<string, unknown> = {}) => ({ runId: 'run-1', args });

  it('submit_ready emits a READY action with no payload', async () => {
    const result = await submitReadyTool.execute(makeCtx());
    expect(result).toEqual({ action: PLAN_SHAPING_ACTIONS.READY });
  });

  it.each([
    [2, 1],
    [2, 2],
    [0, 0],
  ])('emits decided totals %s then %s without proposal writes', async (first, second) => {
    for (const expectedStageCount of [first, second]) {
      expect(
        await submitProposedStagesReadyTool.execute({
          runId: 'run-1',
          args: { expectedStageCount },
        }),
      ).toEqual({
        action: PLAN_SHAPING_ACTIONS.READY,
        payload: { expectedStageCount },
      });
    }
  });

  it.each([undefined, -1, 1.5, '2', NaN, Infinity])(
    'rejects invalid decided total %s',
    (expectedStageCount) => {
      expect(() =>
        submitProposedStagesReadyTool.execute({ runId: 'run-1', args: { expectedStageCount } }),
      ).toThrow(/non-negative integer/);
    },
  );

  it('submit_done emits a DONE action with no payload', async () => {
    const result = await submitDoneTool.execute(makeCtx());
    expect(result).toEqual({ action: PLAN_SHAPING_ACTIONS.DONE });
  });

  it('declares empty-object input schemas for both tools', () => {
    for (const tool of [submitReadyTool, submitDoneTool]) {
      const schema = tool.inputSchema as { type: string; properties: Record<string, unknown> };
      expect(schema.type).toBe('object');
      expect(schema.properties).toEqual({});
    }
  });
});

describe('plan-shaping registry wiring', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('registers the proposed-stages, refine-stage, and finalize handlers under their promptType keys', async () => {
    expect(registry.get(LocalPromptType.PlanShapingProposedStages)?.promptType).toBe(
      LocalPromptType.PlanShapingProposedStages,
    );
    expect(registry.get(LocalPromptType.PlanShapingRefineStage)?.promptType).toBe(
      LocalPromptType.PlanShapingRefineStage,
    );
    expect(registry.get(LocalPromptType.PlanShapingFinalize)?.promptType).toBe(
      LocalPromptType.PlanShapingFinalize,
    );
  });

  it('resolves PlanShapingRefineStage to the real handler (not the prior stub)', async () => {
    const handler = registry.get(LocalPromptType.PlanShapingRefineStage);
    expect(handler).toBe(planShapingRefineStageHandler);
    // Real handler renders a non-empty prompt with the anchored mentions; the
    // stub returned ''. Pass a fully-formed payload so the builder does not
    // try to render `undefined` ids.
    const prompt = handler!.buildPrompt(refineStagePayload());
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('@[task:');
    expect(prompt).toContain('@[task:');
  });

  it('resolves PlanShapingPhaseBreakdown to a handler that exposes submit_phase_breakdown + the create_phase_grounding pass-through wrapper, and renders the phase opener + anchored mentions', async () => {
    const handler = registry.get(LocalPromptType.PlanShapingPhaseBreakdown);
    expect(handler?.promptType).toBe(LocalPromptType.PlanShapingPhaseBreakdown);
    // The deps-built handler wraps the static export — it must include both
    // the submit_phase_breakdown action tool and the create_phase_grounding
    // pass-through so the gate (which reads run.readReportChain()) has any
    // chance of finding a paired PHASE_GROUNDING entry.
    expect(handler?.submissionTools?.map((t) => t.name).sort()).toEqual(
      ['create_phase_grounding', 'submit_phase_breakdown'].sort(),
    );
    const prompt = handler!.buildPrompt(phaseBreakdownPayload());
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toMatch(/phase 2 of 3/);
    expect(prompt).toContain('@[design_doc:');
    expect(prompt).toContain('@[task:');
  });

  it('does not resolve typo or sibling-shaped promptTypes to a plan-shaping handler', async () => {
    expect(registry.get('plan_generation')).toBeUndefined();
    expect(registry.get('PLAN_GENERATION_INTAKE')).toBeUndefined();
    expect(registry.get('plan_generation_refine')).toBeUndefined();
  });
});

describe('mcp-server-config', () => {
  const PLAN_SHAPING_TOOL_NAMES = [
    'get_authoring_guidance',
    'create_work_item',
    'edit_work_item',
    'get_proposal',
    'update_proposal',
  ] as const;

  it('runs proposed-stages on the plan_shaping base and pins every stage+step authoring tool', async () => {
    const { PLAN_SHAPING_ALLOWED_TOOLS, planShapingProposedStagesHandler } =
      await import('../proposed-stages.handler');
    expect(planShapingProposedStagesHandler.mcpToolUseCase).toBe('plan_shaping');
    for (const name of PLAN_SHAPING_TOOL_NAMES) {
      expect(PLAN_SHAPING_ALLOWED_TOOLS).toContain(name);
      expect(planShapingProposedStagesHandler.additionalAllowedTools).toContain(name);
    }
    // create_report is the run-scoped submission tool wrapper, not a platform
    // MCP tool — the frozen allowedTools on a resumed session does not constrain
    // it, so proposed-stages no longer pins it.
    expect(planShapingProposedStagesHandler.additionalAllowedTools).not.toContain('create_report');
  });

  it('keeps plan-shaping tools off non-plan handlers', async () => {
    const { featureSyncAnalyzeHandler } = await import('../../feature-sync/analyze.handler');
    const { featureSyncIterateHandler } = await import('../../feature-sync/iterate.handler');
    const { codingPlanHandler } = await import('../../coding-plan/coding-plan.handler');
    const { implementHandler } = await import('../../implement/implement.handler');

    for (const handler of [
      featureSyncAnalyzeHandler,
      featureSyncIterateHandler,
      codingPlanHandler,
      implementHandler,
    ]) {
      const extras = handler.additionalAllowedTools ?? [];
      for (const name of PLAN_SHAPING_TOOL_NAMES) {
        expect(extras).not.toContain(name);
      }
    }
  });

  it('gives finalize its own correct surface — it declares no additional MCP tools', async () => {
    // Each plan-shaping step mints its own provider session on an in-memory
    // handler swap, so every handler must declare a surface that is correct
    // standalone — not lean on a single shared session seeded by
    // proposed-stages (that only holds in the rehydrate/resume path).
    // finalize authors no plan entities and reaches create_report via the
    // run-scoped submission tool wrapper, so it adds no additional MCP tools.
    const finalizeExtras = planShapingFinalizeHandler.additionalAllowedTools ?? [];
    expect(planShapingFinalizeHandler.mcpToolUseCase).toBe('plan_shaping');
    expect(finalizeExtras).toEqual([]);
    for (const name of PLAN_SHAPING_TOOL_NAMES) {
      expect(finalizeExtras).not.toContain(name);
    }
  });

  it('refine-stage handler exposes only the step-shaping subset of plan-shaping tools', async () => {
    // Refine-stage starts its own provider session (not the shared
    // plan-from-design-doc session), so it cannot inherit the
    // proposed-stages-seeded allowlist. It declares its own narrowed
    // subset — step-shaping tools only, never stage-shaping tools.
    const STEP_SHAPING_TOOLS = [
      'get_authoring_guidance',
      'create_work_item',
      'edit_work_item',
      'get_proposal',
      'update_proposal',
    ] as const;
    const STAGE_SHAPING_TOOLS = [
      'start_proposal_group',
      'get_proposal_group_authoring_snapshot',
      'finalize_proposal_group',
    ] as const;
    const extras = planShapingRefineStageHandler.additionalAllowedTools ?? [];
    for (const name of STEP_SHAPING_TOOLS) {
      expect(extras).toContain(name);
    }
    for (const name of STAGE_SHAPING_TOOLS) {
      expect(extras).not.toContain(name);
    }
  });

  it('phase-breakdown runs on the read-only plan_shaping base and adds no platform tools', async () => {
    // The whole surface comes from the `plan_shaping` use-case base — no
    // authoring tools, and crucially no platform `create_report`, so the
    // local `create_phase_grounding` wrapper is the only chain-populating
    // tool the agent can reach. (The wrapper itself is a submission tool,
    // not a platform allowlist entry.)
    expect(planShapingPhaseBreakdownHandler.mcpToolUseCase).toBe('plan_shaping');
    expect('additionalAllowedTools' in planShapingPhaseBreakdownHandler).toBe(false);
  });

  it('plan_shaping base does not expose platform create_report — the submission tool wrapper is the only path', () => {
    // The platform create_report is no longer in any MCP allowlist. All agents
    // reach it via the run-scoped submission tool wrapper, which fires
    // report-emission channel and appends to the run report chain.
    expect(PLAN_SHAPING_MCP_TOOLS).not.toContain('create_report');
  });
});

describe('phase-breakdown handler prompt', () => {
  const buildPhasePrompt = (overrides: Partial<PlanShapingPhaseBreakdownPromptPayload> = {}) =>
    planShapingPhaseBreakdownHandler.buildPrompt({
      ...phaseBreakdownPayload(overrides),
    });

  it('renders a per-stage "phase N of M in this stage" opener from phaseIdx + phasesInStage, not the whole-map totalPhases', () => {
    const prompt = buildPhasePrompt({ phaseIdx: 1, phasesInStage: 3, totalPhases: 7 });
    expect(prompt).toMatch(/phase 2 of 3 in this stage/);
    expect(prompt).not.toMatch(/phase 2 of 7/);
  });

  it('surfaces the payload stageIdx and phaseIdx in a dedicated identity block so the agent can echo the 2-D cursor verbatim', () => {
    const prompt = buildPhasePrompt({ stageIdx: 1, phaseIdx: 2, totalPhases: 4 });
    expect(prompt).toMatch(/Phase identity/);
    expect(prompt).toMatch(/stageIdx:\s*1/);
    expect(prompt).toMatch(/phaseIdx:\s*2/);
    expect(prompt).toMatch(/echo|verbatim/i);
  });

  it('renders the anchored design-doc and plan ids as @[type:id|...] mentions', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toContain(`@[design_doc:${PHASE_BREAKDOWN_DESIGN_DOC_ID}|design doc]`);
    expect(prompt).toContain(`@[task:${PHASE_BREAKDOWN_PLAN_ID}|plan]`);
  });

  it('renders the current journey step title, description, isUserInteractive, and implementation notes', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toContain('Open the daily-session draft');
    expect(prompt).toContain('The user lands on the daily-session screen and sees their draft.');
    expect(prompt).toMatch(/isUserInteractive: true/);
    expect(prompt).toContain('Render the draft from the daily-session service.');
    expect(prompt).toContain('daily-session');
  });

  it('renders the approved visuals as binding references', () => {
    const prompt = buildPhasePrompt();

    expect(prompt).toContain(renderApprovedVisualsBlock(APPROVED_VISUALS)!);
    expect(prompt).toContain(
      '- @[mockup:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb|Daily-session draft screen] — Shows the saved day plan with a confirm button.',
    );
    expect(prompt).toContain(
      '- @[diagram:dddddddd-dddd-4ddd-8ddd-dddddddddddd|Draft confirmation sequence]\n',
    );
    expect(prompt).toContain('the tasks you plan must implement what they show');
  });

  it('omits the approved-visuals block when no visual was approved', () => {
    expect(buildPhasePrompt({ approvedVisuals: [] })).not.toContain('## Approved visuals');
  });

  it('gives phase breakdown and step review the identical approved-visuals block', () => {
    const block = renderApprovedVisualsBlock(APPROVED_VISUALS)!;
    expect(buildPhasePrompt()).toContain(block);
    expect(planShapingStepReviewHandler.buildPrompt(stepReviewPayload())).toContain(block);
  });

  it('pushes the agent to verify against the actual code before drafting, treating implementation notes as a hint rather than a spec', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(/verify against the actual code/i);
    expect(prompt).toMatch(/hint, not a spec/i);
    expect(prompt).toContain('Glob');
    expect(prompt).toContain('Grep');
    expect(prompt).toContain('Read');
  });

  it('demands enumeration of every distinct unit of work and forbids silently dropping steps', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(/every distinct unit of work/i);
    expect(prompt).toMatch(/do not leave any out/i);
    expect(prompt).toMatch(
      /prefer drafting an extra small step over silently swallowing a missed one/i,
    );
  });

  it('steers routine unit tests into the implementation step they cover while allowing standalone e2e/integration/involved test steps', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(
      /fold routine unit-test coverage into the implementation step it validates/i,
    );
    expect(prompt).toMatch(/reserve standalone test steps for end-to-end suites/i);
    expect(prompt).toMatch(/cross-service-boundary integration tests/i);
  });

  it('omits the prior-phases block on phase 0 when no earlier phase output exists', () => {
    const prompt = buildPhasePrompt({ phaseIdx: 0, priorPhases: [] });
    expect(prompt).not.toMatch(/## Prior phases/);
  });

  it('renders earlier phases — their journey-step titles and steps — as the inter-phase handoff block', () => {
    const prompt = buildPhasePrompt({
      stageIdx: 0,
      phaseIdx: 1,
      priorPhases: [
        {
          stageIdx: 0,
          phaseIdx: 0,
          journeyStep: {
            id: 'journey-step-0',
            stageId: '77777777-7777-4777-8777-777777777777',
            title: 'Land on the dashboard',
            description: 'The user opens the dashboard.',
            isUserInteractive: true,
            implementationNotes: [],
          },
          plan: {
            steps: [
              {
                id: '88888888-8888-4888-8888-888888888888',
                stageId: '77777777-7777-4777-8777-777777777777',
                title: 'Add the dashboard route',
                description: 'Wire the dashboard route handler.',
                implementation: 'Add a new route handler for the dashboard page.',
                type: 'TASK' as const,
                sequenceOrder: 0,
                dependsOnStepIds: ['99999999-9999-4999-8999-999999999999'],
                serviceIds: ['service-id'],
                designDocMotivation: 'Section 3 of the design doc specifies the dashboard route.',
                acceptanceCriteria: '- The dashboard route renders the page.',
              },
            ],
          },
        },
      ],
    });
    expect(prompt).toMatch(/## Prior phases/);
    expect(prompt).toContain('Land on the dashboard');
    expect(prompt).toContain('Add the dashboard route');
    expect(prompt).toContain('Add a new route handler for the dashboard page.');
    expect(prompt).toContain('id: 88888888-8888-4888-8888-888888888888');
    expect(prompt).toContain('dependsOnStepIds: ["99999999-9999-4999-8999-999999999999"]');
    expect(prompt).toMatch(/already-owned/i);
    expect(prompt).toMatch(/do not re-author work|consistent/i);
  });

  it('renders a prior step with empty implementation as title-only with no blank line', () => {
    const prompt = buildPhasePrompt({
      stageIdx: 0,
      phaseIdx: 1,
      priorPhases: [
        {
          stageIdx: 0,
          phaseIdx: 0,
          journeyStep: {
            id: 'journey-step-0',
            stageId: '77777777-7777-4777-8777-777777777777',
            title: 'Land on the dashboard',
            description: 'The user opens the dashboard.',
            isUserInteractive: true,
            implementationNotes: [],
          },
          plan: {
            steps: [
              {
                id: '88888888-8888-4888-8888-888888888888',
                stageId: '77777777-7777-4777-8777-777777777777',
                title: 'Add the dashboard route',
                description: 'Wire the dashboard route handler.',
                implementation: '   ',
                type: 'TASK' as const,
                sequenceOrder: 0,
                serviceIds: ['service-id'],
                designDocMotivation: 'Section 3 of the design doc specifies the dashboard route.',
                acceptanceCriteria: '- The dashboard route renders the page.',
              },
            ],
          },
        },
      ],
    });
    expect(prompt).toContain('[TASK] Add the dashboard route');
    // No indented implementation line (or its whitespace artifact) follows the title.
    expect(prompt).not.toContain('Add the dashboard route\n    ');
  });

  it('names only the read-only investigation tools — no plan-authoring or backing-entity tools', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toContain('list_services');
    expect(prompt).toContain('get_full_entity');
    expect(prompt).toContain('get_context');
    expect(prompt).not.toContain('create_stage');
    expect(prompt).not.toContain('create_steps');
    expect(prompt).not.toContain('create_work_item');
    expect(prompt).not.toContain('create_design_doc');
  });

  it('lists submit_phase_breakdown as the only legal turn termination on this step', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toContain('submit_phase_breakdown');
    expect(prompt).not.toContain('submit_phase_breakdown_report');
    expect(prompt).toMatch(/only legal turn termination on this step/i);
    expect(prompt).toMatch(/do not end the turn by asking the user a question/i);
    expect(prompt).toContain('status: "correctable_rejection"');
    expect(prompt).toMatch(/fix the payload or grounding prerequisite and retry/i);
    expect(prompt).toMatch(/rejected attempt has not advanced/i);
  });

  it('documents the steps-only plan schema (steps, stageId binding to an existing stage, TASK-only type)', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(/stageIdx/);
    expect(prompt).toMatch(/phaseIdx/);
    expect(prompt).toMatch(/plan:\s*\{\s*steps\s*\}/i);
    expect(prompt).toMatch(/stageId/);
    expect(prompt).not.toMatch(/plan:\s*\{\s*stages,\s*steps\s*\}/i);
    expect(prompt).toMatch(/TASK/);
    expect(prompt).not.toMatch(/DESIGN_DOC/);
  });

  it('requires acceptanceCriteria to be one newline-delimited Markdown string', () => {
    const prompt = buildPhasePrompt();

    expect(prompt).toContain('must be one JSON string');
    expect(prompt).toContain('never emit it as a JSON array');
  });

  it('renders the current journey step stageId and binds emitted steps to it', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toContain(`stageId: ${PHASE_BREAKDOWN_STAGE_ID}`);
    expect(prompt).toMatch(/existing durable stage/i);
  });

  it('makes clear the agent does not author platform proposals on this step', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(/you do not author platform proposals/i);
  });

  it('frames the agent as a collaborative planner and enforces the user-facing register rules', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(/collaborative planner/i);
    expect(prompt).toMatch(/never name the tools you use/i);
    expect(prompt).toMatch(/never meta-narrate/i);
  });

  it('requires preventative Service ownership guidance while preserving submission progress', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(/at least one project-valid Service/i);
    expect(prompt).toContain('list_services');
    expect(prompt).toMatch(/description.*implementation/i);
    expect(prompt).toMatch(/split only when the work itself/i);
    expect(prompt).toMatch(/missing, empty, invalid, unresolved, or incomplete/i);
    expect(prompt).toMatch(/omit inactive, out-of-project, or guessed IDs/i);
    expect(prompt).toMatch(/Repeated valid IDs.*one assignment per unique ID/i);
    expect(prompt).toMatch(/still submit the plan/i);
  });

  it('opens with investigation framing — not "expanding ... into the steps that deliver it"', () => {
    const prompt = buildPhasePrompt({ phaseIdx: 0, phasesInStage: 1, totalPhases: 1 });
    expect(prompt).toMatch(/investigating phase/i);
    expect(prompt).not.toMatch(
      /expanding phase \d+ of \d+ of an approved user journey into the steps that deliver it/i,
    );
  });

  it('hoists "verify against the code" as a first-class gate before any step-authoring instruction', () => {
    const prompt = buildPhasePrompt();
    // The verification heading must appear before the "What to do on this step" list.
    const verifyIdx = prompt.search(/Verify against the actual code first/i);
    const stepListIdx = prompt.search(/## What to do on this step/);
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(stepListIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(stepListIdx);
  });

  it('documents the PHASE_GROUNDING submission contract — emit a PHASE_GROUNDING entry via create_phase_grounding before submit_phase_breakdown', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toContain('create_phase_grounding');
    expect(prompt).toContain('PHASE_GROUNDING');
    expect(prompt).toMatch(/touchPoints/);
    // The contract section must explicitly chain the two calls.
    expect(prompt).toMatch(/before.*submit_phase_breakdown|before you submit/i);
  });

  it('scopes work to the current journey step only — does not draft steps for other phases', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toMatch(/this phase only|current journey step's outcomes/i);
    expect(prompt).toMatch(/do not draft steps for other phases/i);
  });

  it('injects the design-doc body under a "## Design doc" heading instead of telling the agent to fetch it', () => {
    const prompt = buildPhasePrompt();
    expect(prompt).toContain('## Design doc');
    expect(prompt).toContain(PHASE_BREAKDOWN_DESIGN_DOC_BODY);
    // The anchored block must no longer instruct the agent to re-fetch the
    // design doc via get_full_entity — the body is in the prompt.
    expect(prompt).not.toMatch(
      /Read the design-doc body and the plan's current state via `get_full_entity`/,
    );
    expect(prompt).not.toMatch(/call `get_full_entity` on the design doc/);
  });

  it('places the "## Design doc" block before the journey-step block (and after the anchored entities block)', () => {
    const prompt = buildPhasePrompt();
    const anchoredIdx = prompt.search(/## Anchored entities/);
    const designDocIdx = prompt.search(/## Design doc/);
    const journeyStepIdx = prompt.search(/## Current journey step/);
    expect(anchoredIdx).toBeGreaterThan(-1);
    expect(designDocIdx).toBeGreaterThan(anchoredIdx);
    expect(journeyStepIdx).toBeGreaterThan(designDocIdx);
  });
});

describe('step-review handler prompt', () => {
  const buildStepReviewPrompt = (overrides: Partial<PlanShapingStepReviewPromptPayload> = {}) =>
    planShapingStepReviewHandler.buildPrompt(stepReviewPayload(overrides));

  it('renders explicit prerequisite handles and merge correction instructions for review', () => {
    const payload = stepReviewPayload();
    const prompt = buildStepReviewPrompt({
      steps: payload.steps.map((step) => ({
        ...step,
        dependsOnStepIds: ['99999999-9999-4999-8999-999999999999'],
      })),
    });
    expect(prompt).toContain('dependsOnStepIds: ["99999999-9999-4999-8999-999999999999"]');
    expect(prompt).toContain('redirect references to merged steps to the retained handle');
  });

  it('renders each drafted step stageId inline so submit_step_review can copy it exactly', () => {
    const prompt = buildStepReviewPrompt();

    expect(prompt).toContain(
      '- [TASK] Render the daily-session draft (id: 88888888-8888-4888-8888-888888888888, sequenceOrder: 0)',
    );
    expect(prompt).toContain(`  - stageId: ${PHASE_BREAKDOWN_STAGE_ID}`);
    expect(prompt).toContain(
      `Every step you keep or add binds to this stage's \`stageId\` (${PHASE_BREAKDOWN_STAGE_ID})`,
    );
  });

  it('lints Service coverage as advisory and always continues to final submission', () => {
    const prompt = buildStepReviewPrompt();

    expect(prompt).toContain('list_services');
    expect(prompt).toMatch(/description.*implementation/i);
    expect(prompt).toMatch(/at least one project-valid Service/i);
    expect(prompt).toMatch(/Multi-Service scope is valid/i);
    expect(prompt).toMatch(/missing or empty assignments, invalid project Services/i);
    expect(prompt).toMatch(/unresolved Service references/i);
    expect(prompt).toMatch(/incomplete referenced-Service coverage/i);
    expect(prompt).toMatch(/preserve conservative additional project-valid assignments/i);
    expect(prompt).toMatch(/Omit inactive or out-of-project IDs/i);
    expect(prompt).toMatch(/Repeated valid IDs.*one materialized assignment per unique ID/i);
    expect(prompt).toMatch(/never.*withhold.*submit_step_review/i);
    expect(prompt).toMatch(/Service-coverage findings never change this termination rule/i);
    expect(prompt).toContain('status: "correctable_rejection"');
    expect(prompt).toMatch(/fix the reviewed set and retry.*same turn/i);
  });

  it.each([
    [
      PlanCombinationAggressiveness.Low,
      'Selected value: low',
      'Do not try to reduce the step count beyond obvious cleanup.',
    ],
    [
      PlanCombinationAggressiveness.Medium,
      'Selected value: medium',
      'Aim to reduce the drafted step count by about one third',
    ],
    [
      PlanCombinationAggressiveness.High,
      'Selected value: high',
      'Aim to reduce the drafted step count by about two thirds',
    ],
  ])(
    'renders %s plan-combination aggressiveness instructions',
    (planCombinationAggressiveness, expectedValue, expectedInstruction) => {
      const prompt = buildStepReviewPrompt({
        _planCombinationAggressiveness: planCombinationAggressiveness,
      } as Partial<PlanShapingStepReviewPromptPayload>);

      expect(prompt).toContain('## Plan-combination aggressiveness');
      expect(prompt).toContain(expectedValue);
      expect(prompt).toContain(expectedInstruction);
      expect(prompt).toContain('Never combine steps across stages');
      expect(prompt).toContain('may cross code/service boundaries');
      expect(prompt).toContain('materially different acceptance criteria');
      expect(prompt).toContain('If the reduction target conflicts with clarity, clarity wins.');
    },
  );
});

describe('step-review handler prepare — plan-combination aggressiveness', () => {
  it('defaults absent config to medium and logs the resolved value', async () => {
    const logger = makeLogger();
    const result = await planShapingStepReviewHandler.prepare!(
      makeSession(),
      stepReviewPayload(),
      makeDeps({ logger }),
    );

    expect(
      (result.payload as { _planCombinationAggressiveness?: PlanCombinationAggressiveness })
        ._planCombinationAggressiveness,
    ).toBe(PlanCombinationAggressiveness.Medium);
    expect(logger.info).toHaveBeenCalledWith(
      'plan_shaping_step_review.prepare.turn_starting',
      expect.objectContaining({
        planCombinationAggressiveness: PlanCombinationAggressiveness.Medium,
      }),
    );
  });

  it('uses explicit low config from the AgentSession', async () => {
    const result = await planShapingStepReviewHandler.prepare!(
      makeSession({
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          model: 'claude-opus-4-7',
          planCombinationAggressiveness: PlanCombinationAggressiveness.Low,
        },
      }),
      stepReviewPayload(),
      makeDeps(),
    );

    expect(
      (result.payload as { _planCombinationAggressiveness?: PlanCombinationAggressiveness })
        ._planCombinationAggressiveness,
    ).toBe(PlanCombinationAggressiveness.Low);
  });

  it('throws when explicit config carries an invalid value', async () => {
    await expect(
      planShapingStepReviewHandler.prepare!(
        makeSession({
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'claude-opus-4-7',
            planCombinationAggressiveness: 'extreme',
          },
        } as unknown as Partial<AgenticSession>),
        stepReviewPayload(),
        makeDeps(),
      ),
    ).rejects.toThrow(/planCombinationAggressiveness/);
  });
});

describe('phase-breakdown handler prepare — design-doc fetch', () => {
  const designDocId = PHASE_BREAKDOWN_DESIGN_DOC_ID;

  it('stashes the fetched design-doc body on the prepared payload as `_designDocBody`', async () => {
    const fetchImpl = makeFetchImpl();
    const result = await planShapingPhaseBreakdownHandler.prepare!(
      makeSession(),
      phaseBreakdownPayload({ designDocId }),
      makeDeps({ fetchImpl }),
    );
    expect((result.payload as { _designDocBody?: string })._designDocBody).toBe(
      PHASE_BREAKDOWN_DESIGN_DOC_BODY,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [requestedUrl] = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]!;
    expect(String(requestedUrl)).toContain(`/design-docs/${designDocId}`);
  });

  it('throws when the design-doc fetch returns a non-OK status', async () => {
    const fetchImpl = makeFetchImpl(() => makeJsonResponse({ message: 'not found' }, 404));
    await expect(
      planShapingPhaseBreakdownHandler.prepare!(
        makeSession(),
        phaseBreakdownPayload({ designDocId }),
        makeDeps({ fetchImpl }),
      ),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('throws when the design-doc has no section content', async () => {
    const fetchImpl = makeFetchImpl(() =>
      makeJsonResponse({
        data: { sections: [{ key: 'context', order: 0, materializedMarkdown: '   ' }] },
      }),
    );
    await expect(
      planShapingPhaseBreakdownHandler.prepare!(
        makeSession(),
        phaseBreakdownPayload({ designDocId }),
        makeDeps({ fetchImpl }),
      ),
    ).rejects.toThrow(/empty body/);
  });

  it('throws when the run has no organizationId on contextMetadata', async () => {
    const session = makeSession({
      contextMetadata: {
        capturedAt: '2026-04-24T00:00:00Z',
        projectId: 'proj-1',
        task: { id: 'task-456', title: 'Test task' },
        fileReferences: { resolved: [], unresolved: [] },
      } as unknown as AgenticSession['contextMetadata'],
    });
    await expect(
      planShapingPhaseBreakdownHandler.prepare!(
        session,
        phaseBreakdownPayload({ designDocId }),
        makeDeps(),
      ),
    ).rejects.toThrow(/organizationId/);
  });
});

describe('submit_phase_breakdown submission tool', () => {
  const STAGE_UUID = '11111111-1111-4111-8111-111111111111';
  const STEP_UUID = '22222222-2222-4222-8222-222222222222';
  const TOUCHPOINT_FILE = 'cli/src/agents/plan-shaping/submission-tools.ts';

  const validPayload = () => ({
    stageIdx: 0,
    phaseIdx: 1,
    plan: {
      steps: [
        {
          id: STEP_UUID,
          stageId: STAGE_UUID,
          title: 'Wire daily-session service auth header',
          description:
            'Pass the user session token to the daily-session service when fetching the draft.',
          implementation: `Update ${TOUCHPOINT_FILE} to attach the auth header when proxying.`,
          type: 'TASK' as const,
          sequenceOrder: 0,
          designDocMotivation:
            'Design doc section 2.3 specifies auth header propagation for the daily-session service.',
          acceptanceCriteria: '- The daily-session request carries the auth header.',
        },
      ],
    },
  });

  const makeRun = (chain: ReadonlyArray<ReportChainEntry>) => {
    const run = createTestRun();
    vi.spyOn(run, 'readReportChain').mockReturnValue(chain.slice());
    return run;
  };

  const groundingEntry = (files: string[] = [TOUCHPOINT_FILE]): ReportChainEntry => ({
    createdAt: '2026-04-24T00:00:00.000Z',
    phase: LocalPromptType.PlanShapingPhaseBreakdown,
    reportId: 'phase-grounding-report-1',
    reportType: 'PHASE_GROUNDING',
    summary: 'Ground the phase in its implementation touch points.',
    audience: 'EXTERNAL',
    touchPoints: files.map((file) => ({ file, expectedOutcome: 'expected change' })),
  });

  it('preserves explicit prerequisite handles in both completion schemas', () => {
    const payload = validPayload();
    const steps = payload.plan.steps.map((step) => ({ ...step, dependsOnStepIds: [STAGE_UUID] }));
    expect(
      phaseBreakdownCompletionPayloadSchema.parse({ ...payload, plan: { steps } }).plan.steps[0]
        ?.dependsOnStepIds,
    ).toEqual([STAGE_UUID]);
    expect(
      stepReviewCompletionPayloadSchema.parse({ stageIdx: 0, plan: { steps } }).plan.steps[0]
        ?.dependsOnStepIds,
    ).toEqual([STAGE_UUID]);
    expect(() =>
      phaseBreakdownCompletionPayloadSchema.parse({
        ...payload,
        plan: { steps: [{ ...steps[0], dependsOnStepIds: ['invalid'] }] },
      }),
    ).toThrow();
  });

  it('declares an inputSchema requiring stageIdx, phaseIdx, and a steps-only plan whose steps require implementation', () => {
    const schema = submitPhaseBreakdownTool.inputSchema as {
      type: string;
      required: string[];
      properties: {
        stageIdx: { type: string };
        phaseIdx: { type: string };
        plan: {
          required: string[];
          properties: {
            steps: { items: { required: string[]; properties: Record<string, unknown> } };
          };
        };
      };
    };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['stageIdx', 'phaseIdx', 'plan']));
    expect(schema.properties.plan.required).toEqual(['steps']);
    expect(schema.properties.plan.properties.steps.items.required).toEqual(
      expect.arrayContaining(['implementation']),
    );
    expect(schema.properties.plan.properties.steps.items.properties).toHaveProperty(
      'implementation',
    );
  });

  it('describes acceptanceCriteria to the agent as one newline-delimited Markdown string', () => {
    const schema = submitPhaseBreakdownTool.inputSchema as {
      properties: {
        plan: {
          properties: {
            steps: {
              items: {
                properties: {
                  acceptanceCriteria: { type: string; description: string };
                };
              };
            };
          };
        };
      };
    };
    const acceptanceCriteria =
      schema.properties.plan.properties.steps.items.properties.acceptanceCriteria;

    expect(acceptanceCriteria.type).toBe('string');
    expect(acceptanceCriteria.description).toContain('single Markdown string');
    expect(acceptanceCriteria.description).toContain('Do not pass a JSON array');
  });

  it('describes optional advisory Service arrays using the shared assignment semantics', () => {
    const schema = submitPhaseBreakdownTool.inputSchema as {
      properties: {
        plan: {
          properties: {
            steps: {
              items: {
                required: string[];
                properties: {
                  serviceIds: {
                    type: string;
                    description: string;
                    items: { type: string; format: string };
                  };
                };
              };
            };
          };
        };
      };
    };
    const stepSchema = schema.properties.plan.properties.steps.items;
    const serviceIds = stepSchema.properties.serviceIds;

    expect(stepSchema.required).not.toContain('serviceIds');
    expect(serviceIds).toMatchObject({
      type: 'array',
      items: { type: 'string', format: 'uuid' },
    });
    expect(serviceIds.description).toMatch(/coverage is advisory/i);
    expect(serviceIds.description).toMatch(/Coherent multi-Service scope is accepted/i);
    expect(serviceIds.description).toMatch(/Repeated valid IDs.*assigned once per unique ID/i);

    const reviewSchema = submitStepReviewTool.inputSchema as {
      properties: {
        plan: {
          properties: {
            steps: {
              items: {
                properties: { serviceIds: { description: string } };
              };
            };
          };
        };
      };
    };
    expect(
      reviewSchema.properties.plan.properties.steps.items.properties.serviceIds.description,
    ).toBe(serviceIds.description);
  });

  it('declares a steps-only plan schema — no stages key, additionalProperties locked', () => {
    const schema = submitPhaseBreakdownTool.inputSchema as {
      properties: {
        plan: {
          additionalProperties: boolean;
          properties: Record<string, unknown>;
        };
      };
    };
    expect(schema.properties.plan.additionalProperties).toBe(false);
    expect(schema.properties.plan.properties).not.toHaveProperty('stages');
    expect(schema.properties.plan.properties).toHaveProperty('steps');
  });

  it('emits { action: DONE, payload: { stageIdx, phaseIdx, plan } } for a well-formed steps-only input when paired with a matching PHASE_GROUNDING entry', async () => {
    const payload = validPayload();
    const result = await submitPhaseBreakdownTool.execute({
      runId: 'run-1',
      args: { stageIdx: payload.stageIdx, phaseIdx: payload.phaseIdx, plan: payload.plan },
      run: makeRun([groundingEntry()]),
    });
    expect(result).toEqual({
      action: PLAN_SHAPING_ACTIONS.DONE,
      payload,
    });
  });

  it('keeps a rejected admission correctable and emits only the normalized corrected retry', async () => {
    const base = validPayload();
    const payload = {
      ...base,
      plan: { steps: base.plan.steps.map((step) => ({ ...step, dependsOnStepIds: [STAGE_UUID] })) },
    };
    const admit = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'rejected',
        findings: [
          {
            field: '/submission/plan/steps/0/dependsOnStepIds',
            code: 'unresolved_reference',
            reason: 'Prerequisite handle was removed.',
          },
        ],
        advisories: [],
      })
      .mockResolvedValueOnce({
        status: 'accepted',
        submission: {
          ...payload,
          plan: {
            steps: payload.plan.steps.map((entry) => ({
              ...entry,
              title: entry.title.trim(),
              dependsOnStepIds: [],
            })),
          },
        },
        advisories: [],
      });
    const tool = createSubmitPhaseBreakdownTool({
      admit,
    } as unknown as PlanSubmissionAdmissionClient);
    const context = {
      runId: 'run-1',
      args: payload,
      run: makeRun([groundingEntry()]),
    };

    await expect(tool.execute(context)).rejects.toBeInstanceOf(SubmissionToolCorrectableError);
    payload.plan.steps[0]!.dependsOnStepIds = [];
    await expect(tool.execute(context)).resolves.toEqual({
      action: PLAN_SHAPING_ACTIONS.DONE,
      payload: expect.objectContaining({
        plan: expect.objectContaining({
          steps: [
            expect.objectContaining({
              title: payload.plan.steps[0]!.title.trim(),
              dependsOnStepIds: [],
            }),
          ],
        }),
      }),
    });
    expect(admit).toHaveBeenCalledTimes(2);
    expect(admit.mock.calls[1]?.[1].submission.plan.steps[0].dependsOnStepIds).toEqual([]);
  });

  it('distinguishes a concurrent Plan conflict from deterministic bad input', async () => {
    const payload = validPayload();
    const tool = createSubmitPhaseBreakdownTool({
      admit: vi.fn().mockResolvedValue({
        status: 'conflict',
        findings: [
          {
            field: '/triggerMessageId',
            code: 'admission_context_changed',
            reason: 'The active Plan-generation context changed.',
          },
        ],
      }),
    } as unknown as PlanSubmissionAdmissionClient);

    await expect(
      tool.execute({
        runId: 'run-1',
        args: payload,
        run: makeRun([groundingEntry()]),
      }),
    ).rejects.toMatchObject({
      reason: 'The Plan changed while this submission was being admitted.',
    });
  });

  it('leaves infrastructure failures terminal instead of relabeling them as input findings', async () => {
    const payload = validPayload();
    const failure = new Error('admission transport unavailable');
    const tool = createSubmitPhaseBreakdownTool({
      admit: vi.fn().mockRejectedValue(failure),
    } as unknown as PlanSubmissionAdmissionClient);

    await expect(
      tool.execute({
        runId: 'run-1',
        args: payload,
        run: makeRun([groundingEntry()]),
      }),
    ).rejects.toBe(failure);
  });

  it('throws when stageIdx is missing', async () => {
    const payload = validPayload();
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { phaseIdx: payload.phaseIdx, plan: payload.plan },
        run: makeRun([groundingEntry()]),
      }),
    ).rejects.toThrow(/invalid payload/);
  });

  it('throws when phaseIdx is negative', async () => {
    const payload = validPayload();
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { stageIdx: payload.stageIdx, phaseIdx: -1, plan: payload.plan },
        run: makeRun([groundingEntry()]),
      }),
    ).rejects.toThrow(/invalid payload/);
  });

  it("throws when a step's stageId is not a UUID", async () => {
    const payload = validPayload();
    payload.plan.steps[0]!.stageId = 'not-a-uuid';
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { stageIdx: payload.stageIdx, phaseIdx: payload.phaseIdx, plan: payload.plan },
        run: makeRun([groundingEntry()]),
      }),
    ).rejects.toThrow(/invalid payload/);
  });

  it('throws when a step is missing implementation', async () => {
    const payload = validPayload();
    delete (payload.plan.steps[0] as Partial<(typeof payload.plan.steps)[0]>).implementation;
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { stageIdx: payload.stageIdx, phaseIdx: payload.phaseIdx, plan: payload.plan },
        run: makeRun([groundingEntry()]),
      }),
    ).rejects.toThrow(/invalid payload/);
  });

  it('throws when steps is missing', async () => {
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { stageIdx: 0, phaseIdx: 0, plan: {} },
        run: makeRun([groundingEntry()]),
      }),
    ).rejects.toThrow(/invalid payload/);
  });

  it('rejects when no PHASE_GROUNDING report has been posted on this turn — the gate refuses an unmotivated submission', async () => {
    const payload = validPayload();
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { stageIdx: payload.stageIdx, phaseIdx: payload.phaseIdx, plan: payload.plan },
        run: makeRun([]),
      }),
    ).rejects.toThrow(/PHASE_GROUNDING entry/);
  });

  it('rejects when the paired PHASE_GROUNDING report has no touchPoints — the report failed its forcing-function contract', async () => {
    const payload = validPayload();
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { stageIdx: payload.stageIdx, phaseIdx: payload.phaseIdx, plan: payload.plan },
        run: makeRun([groundingEntry([])]),
      }),
    ).rejects.toThrow(/no touchPoints/);
  });

  it('rejects when ctx.run is not resolved — the gate cannot run without a Run', async () => {
    const payload = validPayload();
    await expect(
      submitPhaseBreakdownTool.execute({
        runId: 'run-1',
        args: { stageIdx: payload.stageIdx, phaseIdx: payload.phaseIdx, plan: payload.plan },
      }),
    ).rejects.toThrow(/ctx\.run/);
  });
});

describe('phase-breakdown per-phase step ceiling (schema boundary)', () => {
  const STAGE_UUID = '11111111-1111-4111-8111-111111111111';
  const STEP_UUID = '22222222-2222-4222-8222-222222222222';

  const phaseStep = (n: number) => ({
    id: STEP_UUID,
    stageId: STAGE_UUID,
    title: `Step ${n}`,
    description: 'Do the work for this step.',
    implementation: 'Change the relevant file.',
    type: 'TASK' as const,
    sequenceOrder: n,
    designDocMotivation: 'Design doc section motivates this step.',
    acceptanceCriteria: 'Done when the relevant file is changed.',
  });

  const planOfLength = (length: number) => ({
    stageIdx: 0,
    phaseIdx: 0,
    plan: { steps: Array.from({ length }, (_unused, i) => phaseStep(i)) },
  });

  it(`accepts a phase plan with exactly ${PHASE_STEP_CEILING} steps`, () => {
    const result = phaseBreakdownCompletionPayloadSchema.safeParse(
      planOfLength(PHASE_STEP_CEILING),
    );
    expect(result.success).toBe(true);
  });

  it(`rejects a phase plan exceeding the per-phase ceiling of ${PHASE_STEP_CEILING}`, () => {
    const result = phaseBreakdownCompletionPayloadSchema.safeParse(
      planOfLength(PHASE_STEP_CEILING + 1),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a step typed DESIGN_DOC — steps are TASK-only', () => {
    const result = phaseBreakdownCompletionPayloadSchema.safeParse({
      stageIdx: 0,
      phaseIdx: 0,
      plan: { steps: [{ ...phaseStep(0), type: 'DESIGN_DOC' }] },
    });
    expect(result.success).toBe(false);
  });
});

describe('plan-shaping step-count caps in prompt text', () => {
  it('states the soft per-phase step budget of 3–5 steps', () => {
    const prompt = planShapingPhaseBreakdownHandler.buildPrompt(phaseBreakdownPayload());
    expect(prompt).toMatch(/Aim for roughly 3–5 steps/);
  });
});
