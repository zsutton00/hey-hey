import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LocalPromptType,
  PlanCombinationAggressiveness,
  PlanShapingValidationMode,
} from '../../shared/agent-bridge-contract/generated/api';
import { WorkflowName } from '../../shared/api/generated/api';
import {
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import {
  START_RUN_TRIGGER_SENTINEL,
  TriggerPayloadValidationError,
  USER_MESSAGE_TRIGGER_SENTINEL,
  validateTriggerPayload,
  validateUserMessageTriggerPayload,
} from './trigger-payload-schemas';
import { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../agents/prompt-type-registry.test-support';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

const VALID_DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';
const VALID_PLAN_ID = '22222222-2222-4222-8222-222222222222';

describe('validateTriggerPayload', () => {
  it.each(['planId', 'designDocId'])('rejects a revision missing canonical %s', (field) => {
    const payload = {
      planId: VALID_PLAN_ID,
      designDocId: VALID_PLAN_ID,
      discrepancies: [],
      decisions: [],
      [field]: undefined,
    };
    expect(() =>
      validateTriggerPayload(LocalPromptType.PlanShapingFeatureSyncIterate, payload),
    ).toThrow(TriggerPayloadValidationError);
    expect(() =>
      validateUserMessageTriggerPayload(
        {
          handlerPromptType: LocalPromptType.PlanShapingFeatureSyncIterate,
          userMessage: 'Refine',
          attachments: [],
          featureSyncContext: payload,
        },
        promptTypeRegistry,
      ),
    ).toThrow(TriggerPayloadValidationError);
  });

  it.each([LocalPromptType.WorkTrackerConnect, LocalPromptType.WorkTrackerImport])(
    'validates %s without a Service and isolates invalid requests',
    (promptType) => {
      const payload = {
        projectId: VALID_DESIGN_DOC_ID,
        conversationId: VALID_PLAN_ID,
        workflowId: VALID_DESIGN_DOC_ID,
        workflowNodeId: 'tracker-phase',
        machineId: VALID_PLAN_ID,
        source: 'jira',
        provider: 'claude',
        resolvedFrontierModel: 'selected-model',
        reasoningEffort: 'high',
      };
      expect(() => validateTriggerPayload(promptType, { ...payload, source: 'notion' })).toThrow(
        TriggerPayloadValidationError,
      );
      expect(() =>
        validateTriggerPayload(promptType, { ...payload, serviceId: VALID_PLAN_ID }),
      ).toThrow(TriggerPayloadValidationError);
      expect(validateTriggerPayload(promptType, payload)).toEqual(payload);
    },
  );
  it.each([
    [
      LocalPromptType.FeatureSyncIterate,
      {
        discrepancies: [
          { id: 'fs-2', summary: 'second', rationale: 'two' },
          { id: 'fs-5', summary: 'fifth', rationale: 'five' },
        ],
      },
    ],
    [
      LocalPromptType.PlanShapingFeatureSyncIterate,
      {
        planId: VALID_PLAN_ID,
        designDocId: VALID_PLAN_ID,
        discrepancies: [],
        decisions: [{ itemId: 'fs-9', choice: 'dismiss' }],
      },
    ],
  ])(
    'preserves producer-shaped %s iterate context, including explicit empty arrays',
    (promptType, payload) => {
      expect(validateTriggerPayload(promptType, payload)).toEqual(payload);
    },
  );

  it.each([
    [LocalPromptType.FeatureSyncIterate, { promptType: LocalPromptType.FeatureSyncIterate }],
    [
      LocalPromptType.PlanShapingFeatureSyncIterate,
      {
        promptType: LocalPromptType.PlanShapingFeatureSyncIterate,
        discrepancies: [],
      },
    ],
  ])('rejects %s iterate context with missing required arrays', (promptType, payload) => {
    expect(() => validateTriggerPayload(promptType, payload)).toThrow(
      TriggerPayloadValidationError,
    );
  });

  it('admits immutable repository-placement roots with one instruction per root', () => {
    const rootKey = '66666666-6666-4666-8666-666666666666';
    const payload = {
      promptType: LocalPromptType.RepositoryPlacement,
      projectId: '11111111-1111-4111-8111-111111111111',
      conversationId: '22222222-2222-4222-8222-222222222222',
      workflowId: '33333333-3333-4333-8333-333333333333',
      workflowNodeId: 'repository-placement',
      serviceId: '44444444-4444-4444-8444-444444444444',
      machineId: '55555555-5555-4555-8555-555555555555',
      provider: 'codex',
      resolvedFrontierModel: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      fastMode: true,
      candidates: [
        {
          rootKey,
          name: 'Reporting',
          description: 'Reporting capability',
          tag: 'product',
          children: [],
        },
      ],
      instructions: [{ rootKey, instruction: 'Select exactly one parent.' }],
    };

    expect(validateTriggerPayload(LocalPromptType.RepositoryPlacement, payload)).toEqual(payload);
    expect(() =>
      validateTriggerPayload(LocalPromptType.RepositoryPlacement, {
        ...payload,
        instructions: [...payload.instructions, { rootKey, instruction: 'Duplicate instruction.' }],
      }),
    ).toThrow(TriggerPayloadValidationError);
  });

  it('accepts the complete repository-grounding runtime selection without usage metadata', () => {
    const payload = {
      promptType: LocalPromptType.RepositoryGrounding,
      projectId: '11111111-1111-4111-8111-111111111111',
      conversationId: '22222222-2222-4222-8222-222222222222',
      workflowId: '33333333-3333-4333-8333-333333333333',
      workflowNodeId: 'repository-analysis',
      entryMode: 'existing_project',
      serviceId: '44444444-4444-4444-8444-444444444444',
      confirmedServiceBrief: 'The service owns repository onboarding.',
      machineId: '55555555-5555-4555-8555-555555555555',
      scope: { scope: 'comprehensive' },
      provider: 'codex',
      resolvedFrontierModel: 'gpt-5.6',
      reasoningEffort: 'high',
      fastMode: true,
      bounds: {
        maxFiles: 100,
        maxTotalBytes: 1_000_000,
        maxFileBytes: 100_000,
        maxDepth: 8,
        maxGeneratedFiles: 20,
        maxIgnoredFiles: 20,
        maxUnsupportedFiles: 20,
        maxBinaryFiles: 20,
      },
    };

    expect(validateTriggerPayload(LocalPromptType.RepositoryGrounding, payload)).toEqual(payload);
    expect(() =>
      validateTriggerPayload(LocalPromptType.RepositoryGrounding, {
        ...payload,
        qualifiedUsageClass: 'repository_analysis',
      }),
    ).toThrow(TriggerPayloadValidationError);
  });

  it('accepts code review with an optional or empty focus message', () => {
    expect(validateTriggerPayload(LocalPromptType.CodeReview, {})).toEqual({});
    expect(validateTriggerPayload(LocalPromptType.CodeReview, { userMessage: '' })).toEqual({
      userMessage: '',
    });
    expect(
      validateTriggerPayload(LocalPromptType.CodeReview, {
        userMessage: 'focus on error handling',
      }),
    ).toEqual({ userMessage: 'focus on error handling' });
  });

  it('rejects removed terminal-policy review fields', () => {
    expect(() =>
      validateTriggerPayload(LocalPromptType.CodeReview, {
        launchSource: 'terminal_policy',
      }),
    ).toThrow(TriggerPayloadValidationError);
  });

  it('returns the payload unchanged for a promptType with no registered schema', () => {
    const payload = { userMessage: 'hello' };
    const result = validateTriggerPayload(LocalPromptType.PlanShapingFinalize, payload);
    expect(result).toBe(payload);
  });

  it('TriggerPayloadValidationError carries the zod issues passed to it', () => {
    const issues: z.ZodIssue[] = [
      { code: 'custom', path: ['conversationId'], message: 'invalid' } as z.ZodIssue,
    ];
    const error = new TriggerPayloadValidationError(LocalPromptType.PlanShapingFinalize, issues);
    expect(error.promptType).toBe(LocalPromptType.PlanShapingFinalize);
    expect(error.issues).toBe(issues);
    expect(error.message).toContain('plan_shaping_finalize');
  });

  for (const promptType of [LocalPromptType.PlanShapingProposedStages] as const) {
    describe(`${promptType}`, () => {
      it('parses a valid payload unchanged (no userMessage)', () => {
        const payload = {
          designDocId: VALID_DESIGN_DOC_ID,
          planId: VALID_PLAN_ID,
        };
        const result = validateTriggerPayload(promptType, payload);
        expect(result).toEqual(payload);
      });

      it('parses a valid payload unchanged (with optional userMessage)', () => {
        const payload = {
          designDocId: VALID_DESIGN_DOC_ID,
          planId: VALID_PLAN_ID,
          userMessage: 'rework stage 2',
        };
        const result = validateTriggerPayload(promptType, payload);
        expect(result).toEqual(payload);
      });

      it('rejects a payload missing designDocId with a field-named message', () => {
        const payload = { planId: VALID_PLAN_ID };
        let caught: TriggerPayloadValidationError | undefined;
        try {
          validateTriggerPayload(promptType, payload);
        } catch (err) {
          caught = err as TriggerPayloadValidationError;
        }
        expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
        expect(caught?.message).toContain('designDocId');
      });

      it('rejects a payload missing planId with a field-named message', () => {
        const payload = { designDocId: VALID_DESIGN_DOC_ID };
        let caught: TriggerPayloadValidationError | undefined;
        try {
          validateTriggerPayload(promptType, payload);
        } catch (err) {
          caught = err as TriggerPayloadValidationError;
        }
        expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
        expect(caught?.message).toContain('planId');
      });

      it('rejects a non-UUID designDocId with a field-named message', () => {
        const payload = {
          designDocId: 'not-a-uuid',
          planId: VALID_PLAN_ID,
        };
        let caught: TriggerPayloadValidationError | undefined;
        try {
          validateTriggerPayload(promptType, payload);
        } catch (err) {
          caught = err as TriggerPayloadValidationError;
        }
        expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
        expect(caught?.message).toContain('designDocId');
      });

      it('rejects a non-UUID planId with a field-named message', () => {
        const payload = {
          designDocId: VALID_DESIGN_DOC_ID,
          planId: 'not-a-uuid',
        };
        let caught: TriggerPayloadValidationError | undefined;
        try {
          validateTriggerPayload(promptType, payload);
        } catch (err) {
          caught = err as TriggerPayloadValidationError;
        }
        expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
        expect(caught?.message).toContain('planId');
      });
    });
  }

  describe(`${LocalPromptType.PlanShapingRefineStage}`, () => {
    const promptType = LocalPromptType.PlanShapingRefineStage;
    const VALID_STAGE_ID = '33333333-3333-4333-8333-333333333333';
    const validPayload = () => ({
      planId: VALID_PLAN_ID,
      stageId: VALID_STAGE_ID,
      validation: PlanShapingValidationMode.On,
    });

    const expectRejection = (payload: unknown, expectedField: string) => {
      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateTriggerPayload(promptType, payload);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain(expectedField);
    };

    it('parses a valid payload unchanged (no userMessage)', () => {
      const payload = validPayload();
      const result = validateTriggerPayload(promptType, payload);
      expect(result).toEqual(payload);
    });

    it('parses a valid payload unchanged (with optional userMessage)', () => {
      const payload = { ...validPayload(), userMessage: 'expand the auth stage' };
      const result = validateTriggerPayload(promptType, payload);
      expect(result).toEqual(payload);
    });

    it('rejects a payload missing planId with a field-named message', () => {
      const { planId: _planId, ...rest } = validPayload();
      expectRejection(rest, 'planId');
    });

    it('rejects a payload missing stageId with a field-named message', () => {
      const { stageId: _stageId, ...rest } = validPayload();
      expectRejection(rest, 'stageId');
    });

    it('rejects a payload missing validation with a field-named message', () => {
      const { validation: _validation, ...rest } = validPayload();
      expectRejection(rest, 'validation');
    });

    it('rejects a non-UUID planId with a field-named message', () => {
      expectRejection({ ...validPayload(), planId: 'not-a-uuid' }, 'planId');
    });

    it('rejects a non-UUID stageId with a field-named message', () => {
      expectRejection({ ...validPayload(), stageId: 'not-a-uuid' }, 'stageId');
    });

    it('rejects a validation value outside the on | off enum with a field-named message', () => {
      expectRejection({ ...validPayload(), validation: 'maybe' }, 'validation');
    });

    it('rejects a pre-flag payload (planId + stageId only) — validation is required', () => {
      const payload = { planId: VALID_PLAN_ID, stageId: VALID_STAGE_ID };
      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateTriggerPayload(promptType, payload);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain('validation');
    });
  });

  describe(`${LocalPromptType.PlanShapingPhaseBreakdown}`, () => {
    const promptType = LocalPromptType.PlanShapingPhaseBreakdown;
    const VALID_SERVICE_ID = '55555555-5555-4555-8555-555555555555';
    const VALID_STAGE_ID = '66666666-6666-4666-8666-666666666666';
    const validJourneyStep = () => ({
      id: 'step-1-open-conversation',
      stageId: VALID_STAGE_ID,
      title: 'User opens the conversation',
      description: 'The user opens the project conversation in the web UI.',
      isUserInteractive: true,
      implementationNotes: [
        {
          text: 'Render conversation entry-point on the project page',
          serviceId: VALID_SERVICE_ID,
          serviceName: 'ui',
        },
        {
          text: 'Cross-cutting telemetry for conversation opens',
          serviceId: null,
          serviceName: null,
        },
      ],
    });
    const validPayload = () => ({
      journeyStep: validJourneyStep(),
      stageIdx: 0,
      phaseIdx: 0,
      phasesInStage: 2,
      totalPhases: 3,
      designDocId: VALID_DESIGN_DOC_ID,
      planId: VALID_PLAN_ID,
      approvedVisuals: [
        {
          proposalId: VALID_PLAN_ID,
          entityId: VALID_DESIGN_DOC_ID,
          entityType: 'MOCKUP',
          title: 'Conversation entry point',
          summary: 'Shows where a conversation opens.',
        },
      ],
    });

    const expectRejection = (payload: unknown, expectedField: string) => {
      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateTriggerPayload(promptType, payload);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain(expectedField);
    };

    it('parses a valid payload unchanged (no userMessage)', () => {
      const payload = validPayload();
      const result = validateTriggerPayload(promptType, payload);
      expect(result).toEqual(payload);
    });

    it('parses a valid payload unchanged (with optional userMessage)', () => {
      const payload = { ...validPayload(), userMessage: 'tighten phase 1' };
      const result = validateTriggerPayload(promptType, payload);
      expect(result).toEqual(payload);
    });

    it('rejects a payload missing journeyStep with a field-named message', () => {
      const { journeyStep: _journeyStep, ...rest } = validPayload();
      expectRejection(rest, 'journeyStep');
    });

    it('rejects a journeyStep missing isUserInteractive with a field-named message', () => {
      const { isUserInteractive: _flag, ...stepRest } = validJourneyStep();
      expectRejection({ ...validPayload(), journeyStep: stepRest }, 'isUserInteractive');
    });

    it('rejects a journeyStep missing stageId with a field-named message', () => {
      const { stageId: _stageId, ...stepRest } = validJourneyStep();
      expectRejection({ ...validPayload(), journeyStep: stepRest }, 'stageId');
    });

    it('rejects a journeyStep with a non-UUID stageId', () => {
      const step = { ...validJourneyStep(), stageId: 'not-a-uuid' };
      expectRejection({ ...validPayload(), journeyStep: step }, 'stageId');
    });

    it('rejects a journeyStep with an empty implementation note text', () => {
      const step = {
        ...validJourneyStep(),
        implementationNotes: [{ text: '', serviceId: null, serviceName: null }],
      };
      expectRejection({ ...validPayload(), journeyStep: step }, 'text');
    });

    it('rejects a payload missing stageIdx with a field-named message', () => {
      const { stageIdx: _stageIdx, ...rest } = validPayload();
      expectRejection(rest, 'stageIdx');
    });

    it('rejects a negative stageIdx with a field-named message', () => {
      expectRejection({ ...validPayload(), stageIdx: -1 }, 'stageIdx');
    });

    it('rejects a payload missing phaseIdx with a field-named message', () => {
      const { phaseIdx: _phaseIdx, ...rest } = validPayload();
      expectRejection(rest, 'phaseIdx');
    });

    it('rejects a negative phaseIdx with a field-named message', () => {
      expectRejection({ ...validPayload(), phaseIdx: -1 }, 'phaseIdx');
    });

    it('rejects a totalPhases below 1 with a field-named message', () => {
      expectRejection({ ...validPayload(), totalPhases: 0 }, 'totalPhases');
    });

    it('rejects a payload missing the approved visuals with a field-named message', () => {
      const { approvedVisuals: _approvedVisuals, ...rest } = validPayload();
      expectRejection(rest, 'approvedVisuals');
    });

    it('rejects a non-UUID designDocId with a field-named message', () => {
      expectRejection({ ...validPayload(), designDocId: 'not-a-uuid' }, 'designDocId');
    });

    it('rejects a non-UUID planId with a field-named message', () => {
      expectRejection({ ...validPayload(), planId: 'not-a-uuid' }, 'planId');
    });
  });

  describe(`${USER_MESSAGE_TRIGGER_SENTINEL}`, () => {
    const sentinel = USER_MESSAGE_TRIGGER_SENTINEL;
    const validPayload = () => ({
      handlerPromptType: LocalPromptType.CodingFreeform,
      userMessage: 'hi',
      attachments: [],
    });

    const expectRejection = (payload: unknown, expectedField: string) => {
      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateUserMessageTriggerPayload(payload, promptTypeRegistry);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain(expectedField);
    };

    it('parses a valid payload unchanged', () => {
      const payload = validPayload();
      const result = validateUserMessageTriggerPayload(payload, promptTypeRegistry);
      expect(result).toEqual(payload);
    });

    it('accepts empty userMessage for Open Items triage guidance', () => {
      const payload = {
        handlerPromptType: LocalPromptType.OpenItemsTriage,
        userMessage: '',
        attachments: [],
      };

      expect(validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toEqual(payload);
    });

    it('requires matching typed context for feature-sync iterate follow-ups and preserves it unchanged', () => {
      const payload = {
        handlerPromptType: LocalPromptType.PlanShapingFeatureSyncIterate,
        userMessage: 'Keep refining.',
        attachments: [],
        featureSyncContext: {
          planId: 'canonical-plan',
          designDocId: 'seed-doc',
          discrepancies: [
            { id: 'fs-7', summary: 'seventh', rationale: 'seven' },
            { id: 'fs-2', summary: 'second', rationale: 'two' },
          ],
          decisions: [{ itemId: 'fs-2', choice: 'amend', note: 'Narrow scope' }],
        },
      };

      expect(validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toEqual(payload);
      expect(() =>
        validateUserMessageTriggerPayload(
          {
            handlerPromptType: LocalPromptType.PlanShapingFeatureSyncIterate,
            userMessage: 'Keep refining.',
            attachments: [],
          },
          promptTypeRegistry,
        ),
      ).toThrow(TriggerPayloadValidationError);
      expect(() =>
        validateUserMessageTriggerPayload(
          {
            ...payload,
            featureSyncContext: {
              ...payload.featureSyncContext,
              decisions: undefined,
            },
          },
          promptTypeRegistry,
        ),
      ).toThrow(TriggerPayloadValidationError);
      expect(() =>
        validateUserMessageTriggerPayload(
          {
            ...payload,
            handlerPromptType: LocalPromptType.FeatureSyncIterate,
            featureSyncContext: {
              ...payload.featureSyncContext,
              decisions: undefined,
            },
          },
          promptTypeRegistry,
        ),
      ).toThrow(TriggerPayloadValidationError);
    });

    it('accepts explicit empty arrays in feature-sync iterate follow-up context', () => {
      const payload = {
        handlerPromptType: LocalPromptType.PlanShapingFeatureSyncIterate,
        userMessage: 'The list is empty.',
        attachments: [],
        featureSyncContext: {
          planId: 'canonical-plan',
          designDocId: 'seed-doc',
          discrepancies: [],
          decisions: [],
        },
      };

      expect(validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toEqual(payload);
    });

    it('parses a start-run-only handlerPromptType unchanged (free_form) — user_message accepts any known LocalPromptType', () => {
      // A follow-up turn re-enters whatever handler the run is paused on, so
      // handlerPromptType is no longer narrowed to the follow-up-only union.
      // A formerly start-run-only variant like free_form now validates and
      // round-trips unchanged at the wire edge.
      const payload = { ...validPayload(), handlerPromptType: LocalPromptType.FreeForm };
      const result = validateUserMessageTriggerPayload(payload, promptTypeRegistry);
      expect(result).toEqual(payload);
    });

    it('parses another start-run-only handlerPromptType unchanged (daily_session)', () => {
      const payload = { ...validPayload(), handlerPromptType: LocalPromptType.DailySession };
      const result = validateUserMessageTriggerPayload(payload, promptTypeRegistry);
      expect(result).toEqual(payload);
    });

    it('parses a final_assessment handlerPromptType unchanged', () => {
      const payload = { ...validPayload(), handlerPromptType: LocalPromptType.FinalAssessment };
      const result = validateUserMessageTriggerPayload(payload, promptTypeRegistry);
      expect(result).toEqual(payload);
    });

    it('rejects a payload missing handlerPromptType with a field-named message', () => {
      const { handlerPromptType: _handlerPromptType, ...rest } = validPayload();
      expectRejection(rest, 'handlerPromptType');
    });

    it('rejects a payload missing userMessage with a field-named message', () => {
      const { userMessage: _userMessage, ...rest } = validPayload();
      expectRejection(rest, 'userMessage');
    });

    it('rejects an empty-string userMessage with a field-named message', () => {
      expectRejection({ ...validPayload(), userMessage: '' }, 'userMessage');
    });

    it('accepts an empty-string userMessage for the commit handler (optional guide)', () => {
      const payload = {
        handlerPromptType: LocalPromptType.Commit,
        userMessage: '',
        attachments: [],
      };
      const result = validateUserMessageTriggerPayload(payload, promptTypeRegistry);
      expect(result).toEqual(payload);
    });

    it('accepts a typed Task Monitor follow-up with an empty display message', () => {
      const payload = {
        handlerPromptType: LocalPromptType.TaskMonitor,
        userMessage: '',
        attachments: [],
        taskMonitorPayload: {
          monitorId: '11111111-1111-4111-8111-111111111111',
          cause: 'PAUSE',
          correlationId: '22222222-2222-4222-8222-222222222222',
        },
      };

      expect(validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toEqual(payload);
    });

    it('accepts a resolved judgment with its canonical request Message identity', () => {
      const payload = {
        handlerPromptType: LocalPromptType.TaskMonitor,
        userMessage: '',
        attachments: [],
        taskMonitorPayload: {
          monitorId: '11111111-1111-4111-8111-111111111111',
          cause: 'JUDGMENT_RESOLVED',
          correlationId: '22222222-2222-4222-8222-222222222222',
          judgment: {
            requestMessageId: '22222222-2222-4222-8222-222222222222',
            label: 'Your judgment',
            conclusion: 'Proceed with the safer behavior.',
          },
        },
      };

      expect(validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toEqual(payload);
    });

    it('round-trips the complete generated Task Monitor prompt payload', () => {
      const payload = {
        handlerPromptType: LocalPromptType.TaskMonitor,
        userMessage: '',
        attachments: [],
        taskMonitorPayload: {
          monitorId: '11111111-1111-4111-8111-111111111111',
          cause: 'CONTINUE',
          correlationId: '22222222-2222-4222-8222-222222222222',
          launchConfig: {
            taskId: '33333333-3333-4333-8333-333333333333',
            method: 'plan',
            provider: 'codex',
            model: 'gpt-5.6',
            reasoningEffort: 'medium',
            fastMode: true,
            worktree: { enabled: true, branch: 'task-monitor/decision' },
          },
          judgment: {
            requestMessageId: '44444444-4444-4444-8444-444444444444',
            label: 'Your judgment',
            conclusion: 'Proceed with the safer behavior.',
          },
          settledTurn: {
            turnId: '55555555-5555-4555-8555-555555555555',
            promptType: 'task_monitor',
            terminalOutcome: 'COMPLETED',
            completedAssistantMessage: {
              messageId: '66666666-6666-4666-8666-666666666666',
              content: 'The turn completed.',
            },
            reports: [
              {
                reportId: '77777777-7777-4777-8777-777777777777',
                reportType: 'TASK_MONITOR',
              },
            ],
          },
        },
      };

      expect(validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toEqual(payload);
    });

    it('rejects a Task Monitor follow-up that omits its typed lifecycle payload', () => {
      expectRejection(
        {
          handlerPromptType: LocalPromptType.TaskMonitor,
          userMessage: '',
          attachments: [],
        },
        'taskMonitorPayload',
      );
    });

    it('still rejects a missing userMessage for the commit handler', () => {
      expectRejection(
        { handlerPromptType: LocalPromptType.Commit, attachments: [] },
        'userMessage',
      );
    });

    it('accepts an empty-string userMessage for the code_review handler (optional guide)', () => {
      const payload = {
        handlerPromptType: LocalPromptType.CodeReview,
        userMessage: '',
        attachments: [],
      };
      const result = validateUserMessageTriggerPayload(payload, promptTypeRegistry);
      expect(result).toEqual(payload);
    });

    it('still rejects a missing userMessage for the code_review handler', () => {
      expectRejection(
        { handlerPromptType: LocalPromptType.CodeReview, attachments: [] },
        'userMessage',
      );
    });

    it('parses attachment references unchanged', () => {
      const payload = {
        ...validPayload(),
        attachments: [
          { attachmentId: '11111111-1111-4111-8111-111111111111', fileName: 'notes.md' },
        ],
      };
      expect(validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toEqual(payload);
    });

    it('rejects a payload missing attachments with a field-named message', () => {
      const { attachments: _attachments, ...rest } = validPayload();
      expectRejection(rest, 'attachments');
    });

    it.each([
      ['a non-uuid attachmentId', { attachmentId: 'not-a-uuid', fileName: 'notes.md' }],
      ['an empty fileName', { attachmentId: '11111111-1111-4111-8111-111111111111', fileName: '' }],
      [
        'an unknown key',
        {
          attachmentId: '11111111-1111-4111-8111-111111111111',
          fileName: 'notes.md',
          bytes: 'aGk=',
        },
      ],
    ])('rejects an attachment reference with %s', (_label, attachment) => {
      expectRejection({ ...validPayload(), attachments: [attachment] }, 'attachments');
    });

    it('rejects a handlerPromptType value outside the LocalPromptType enum', () => {
      expectRejection(
        { ...validPayload(), handlerPromptType: 'not_a_local_prompt_type' },
        'handlerPromptType',
      );
    });
  });

  // -----------------------------------------------------------------
  // start_run sentinel — envelope acceptance
  //
  // The start_run envelope's `payload` carries the shared `RunCreatePayload`
  // type verbatim (`z.custom`, no runtime shape re-validation — both sides are
  // generated from one OpenAPI source). `contextMetadata` is the exception: its
  // shape is shared too, but completeness is NOT a guarantee the producer
  // honors (the platform has shipped frames carrying only `agentSessionId`), so
  // its load-bearing fields are runtime-checked via `isRunContextMetadata`. The
  // other surviving guards are the envelope-level enum checks and the two
  // `.refine()`s (the workflow-vs-turn-firing arm XOR and
  // `handlerPromptType === payload.promptType`). Each handlerPromptType is
  // exercised below to prove it round-trips through the wire-edge contract.
  // -----------------------------------------------------------------
  describe(`${START_RUN_TRIGGER_SENTINEL}`, () => {
    const VALID_PROJECT_ID = '77777777-7777-4777-8777-777777777777';
    const VALID_STAGE_ID = '99999999-9999-4999-8999-999999999999';
    const VALID_JOURNEY_STEP = {
      id: 'step-1',
      stageId: VALID_STAGE_ID,
      title: 'Step',
      description: 'Description',
      isUserInteractive: true,
      implementationNotes: [],
    };
    const VALID_CONTEXT_METADATA = {
      capturedAt: '2026-01-01T00:00:00Z',
      organizationId: 'org-1',
      projectId: VALID_PROJECT_ID,
      agentSessionId: 'sess-abc',
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    };

    const buildEnvelope = (
      handlerPromptType: LocalPromptType,
      payload: Record<string, unknown>,
    ): Record<string, unknown> => ({
      attachments: [],
      handlerPromptType,
      payload,
      model: 'claude-opus-4-7',
      reasoningEffort: LocalReasoningEffort.High,
      provider: LocalRunProvider.Claude,
      contextMetadata: VALID_CONTEXT_METADATA,
      serviceIds: ['svc-1'],
      launchServiceId: 'svc-1',
      agentSessionId: 'sess-abc',
    });

    it('validates only the task fields the CLI reads from contextMetadata', () => {
      const envelope = buildEnvelope(LocalPromptType.AgentSearch, {
        promptType: LocalPromptType.AgentSearch,
      });
      const task = {
        id: 'task-1',
        name: 'Task',
        initiativeId: null,
        archivedAt: null,
        designDocCount: null,
        sections: [{ id: 'section-1', materializedProposalId: 'not-a-uuid' }],
      };
      expect(() =>
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, {
          ...envelope,
          contextMetadata: { ...VALID_CONTEXT_METADATA, task },
        }),
      ).not.toThrow();
    });

    it('accepts handler launches without attachment references and validates each reference', () => {
      const envelope = buildEnvelope(LocalPromptType.AgentSearch, {
        promptType: LocalPromptType.AgentSearch,
      });
      const { attachments: _attachments, ...missing } = envelope;
      expect(validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, missing)).not.toHaveProperty(
        'attachments',
      );
      expect(() =>
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, {
          ...envelope,
          attachments: [{ attachmentId: 'invalid', fileName: 'a.md' }],
        }),
      ).toThrow();
      expect(validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toMatchObject({
        attachments: [],
      });
    });

    const memberFixtures: Array<{
      handlerPromptType: LocalPromptType;
      payload: Record<string, unknown>;
    }> = [
      {
        handlerPromptType: LocalPromptType.AgentSearch,
        payload: {
          promptType: LocalPromptType.AgentSearch,
          payloadVersion: 1,
          userMessage: 'find tasks',
        },
      },
      {
        handlerPromptType: LocalPromptType.DailySession,
        payload: { promptType: LocalPromptType.DailySession, payloadVersion: 1 },
      },
      {
        handlerPromptType: LocalPromptType.DesignDocRefiner,
        payload: {
          promptType: LocalPromptType.DesignDocRefiner,
          payloadVersion: 1,
          designDoc: { id: 'doc-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.EntityConversation,
        payload: {
          promptType: LocalPromptType.EntityConversation,
          entity: { id: 'ent-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.FeatureRefiner,
        payload: {
          promptType: LocalPromptType.FeatureRefiner,
          payloadVersion: 1,
          feature: { id: 'feat-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.FeatureSyncAnalyze,
        payload: {
          promptType: LocalPromptType.FeatureSyncAnalyze,
          taskId: 'task-1',
        },
      },
      {
        handlerPromptType: LocalPromptType.FeatureSyncIterate,
        payload: {
          promptType: LocalPromptType.FeatureSyncIterate,
          discrepancies: [],
        },
      },
      {
        handlerPromptType: LocalPromptType.FeatureTreeConversation,
        payload: {
          promptType: LocalPromptType.FeatureTreeConversation,
          projectId: VALID_PROJECT_ID,
        },
      },
      {
        handlerPromptType: LocalPromptType.FreeForm,
        payload: {
          promptType: LocalPromptType.FreeForm,
          startupInput: { id: 'startup-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.PlanExecution,
        payload: {
          promptType: LocalPromptType.PlanExecution,
          plan: { id: 'plan-1' },
          review: { id: 'rev-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.PlanShapingFinalize,
        payload: { promptType: LocalPromptType.PlanShapingFinalize },
      },
      {
        handlerPromptType: LocalPromptType.PlanShapingPhaseBreakdown,
        payload: {
          promptType: LocalPromptType.PlanShapingPhaseBreakdown,
          journeyStep: VALID_JOURNEY_STEP,
          stageIdx: 0,
          phaseIdx: 0,
          totalPhases: 1,
          designDocId: VALID_DESIGN_DOC_ID,
          planId: VALID_PLAN_ID,
        },
      },
      {
        handlerPromptType: LocalPromptType.PlanShapingProposedStages,
        payload: {
          promptType: LocalPromptType.PlanShapingProposedStages,
          designDocId: VALID_DESIGN_DOC_ID,
          planId: VALID_PLAN_ID,
        },
      },
      {
        handlerPromptType: LocalPromptType.PlanShapingRefineStage,
        payload: {
          promptType: LocalPromptType.PlanShapingRefineStage,
          planId: VALID_PLAN_ID,
          stageId: VALID_STAGE_ID,
          validation: PlanShapingValidationMode.On,
        },
      },
      {
        handlerPromptType: LocalPromptType.ProposalRefiner,
        payload: {
          promptType: LocalPromptType.ProposalRefiner,
          payloadVersion: 1,
          proposal: { id: 'prop-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.ReportUpdate,
        payload: {
          promptType: LocalPromptType.ReportUpdate,
          payloadVersion: 1,
          reportId: 'report-1',
          reportType: 'GOAL_PROGRESS',
          text: 'report body',
          entities: [],
          changedEntities: [],
        },
      },
      {
        handlerPromptType: LocalPromptType.SetSplitting,
        payload: {
          promptType: LocalPromptType.SetSplitting,
          startupInput: { id: 'startup-1' },
          splitMode: 'service',
        },
      },
      {
        handlerPromptType: LocalPromptType.StartupSession,
        payload: {
          promptType: LocalPromptType.StartupSession,
          startupInput: { id: 'startup-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.TaskRefiner,
        payload: {
          promptType: LocalPromptType.TaskRefiner,
          payloadVersion: 1,
          task: { id: 'task-1' },
        },
      },
      {
        handlerPromptType: LocalPromptType.ValidationWalkthrough,
        payload: {
          promptType: LocalPromptType.ValidationWalkthrough,
          scope: 'task',
          entityId: 'task-1',
        },
      },
    ];

    for (const fixture of memberFixtures) {
      it(`parses a valid envelope for the ${fixture.handlerPromptType} union member`, () => {
        const envelope = buildEnvelope(fixture.handlerPromptType, fixture.payload);
        const result = validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
        expect(result).toEqual(envelope);
      });
    }

    it('rejects an envelope whose handlerPromptType disagrees with payload.promptType', () => {
      // The surviving cross-field guard: the envelope's routing key must match
      // the payload's own discriminator. A `coding_freeform` payload riding a
      // `free_form` handler (or any mismatch) is rejected here. (A start_run
      // carrying a follow-up-only variant on a *matching* handler is no longer
      // a runtime concern — `RunCreatePayload` has no such member, so the
      // producer's TypeScript cannot construct it; see the type-level test.)
      const envelope = buildEnvelope(LocalPromptType.FreeForm, {
        promptType: LocalPromptType.CodingFreeform,
        userMessage: 'hi',
      });
      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain('handlerPromptType');
    });

    it('accepts an envelope without re-validating inner payload shape (producer type guarantees it)', () => {
      // `payload` is no longer re-validated for shape at the wire edge — the
      // shared `RunCreatePayload` type is the single source of truth, generated
      // for both producer and consumer. An inner payload missing a field the
      // handler reads is a compile-time error at the producer, not a runtime
      // drop here. The envelope still round-trips so long as the envelope-level
      // guards (enums, arm XOR, handler/discriminator match) hold.
      const envelope = buildEnvelope(LocalPromptType.PlanShapingProposedStages, {
        promptType: LocalPromptType.PlanShapingProposedStages,
        designDocId: VALID_DESIGN_DOC_ID,
      });
      const result = validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      expect(result).toEqual(envelope);
    });

    it('rejects an envelope whose contextMetadata is missing organizationId', () => {
      // The exact regression: the platform shipped start_run frames whose
      // contextMetadata omitted org/project. An empty/missing org 404s the
      // downstream message POST, so the frame must drop cleanly here instead.
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      const { organizationId: _omitted, ...withoutOrg } = VALID_CONTEXT_METADATA;
      envelope['contextMetadata'] = withoutOrg;

      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain('contextMetadata');
    });

    it('rejects an envelope whose contextMetadata.organizationId is an empty string', () => {
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      envelope['contextMetadata'] = { ...VALID_CONTEXT_METADATA, organizationId: '' };

      expect(() => validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toThrow(
        TriggerPayloadValidationError,
      );
    });

    // -----------------------------------------------------------------
    // Materialize-only (workflow) arm
    //
    // The workflow arm carries `workflowName`, no `handlerPromptType`, and an
    // optional typed `workflow_kickoff` payload. The arm-XOR `.refine()`
    // accepts both bind-only and kickoff-bearing workflow launches, accepts
    // the turn-firing arm (both fields, no workflowName), and rejects
    // everything in between — both arms present, a wrong workflow payload,
    // or a partial turn-firing arm.
    // -----------------------------------------------------------------
    const buildWorkflowArmEnvelope = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      workflowName: 'plan-from-design-doc',
      payload: {
        promptType: 'workflow_kickoff',
        entity: {
          entityType: 'TASK',
          entityId: '11111111-1111-4111-8111-111111111111',
        },
        userMessage: 'Plan this task',
      },
      model: 'claude-opus-4-7',
      reasoningEffort: LocalReasoningEffort.High,
      provider: LocalRunProvider.Claude,
      contextMetadata: VALID_CONTEXT_METADATA,
      serviceIds: ['svc-1'],
      launchServiceId: 'svc-1',
      agentSessionId: 'sess-abc',
      ...overrides,
    });

    it('accepts the materialize-only arm with a valid workflow kickoff payload', () => {
      const envelope = buildWorkflowArmEnvelope();
      const result = validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      expect(result).toEqual(envelope);
    });

    it('accepts the payload-free bind-only workflow arm', () => {
      const envelope = buildWorkflowArmEnvelope();
      delete envelope['payload'];

      const result = validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);

      expect(result).toEqual(envelope);
    });

    it('accepts repository-import as a materialize-only workflow identity', () => {
      const envelope = buildWorkflowArmEnvelope({
        workflowName: WorkflowName.RepositoryImport,
      });
      delete envelope['payload'];

      expect(validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toEqual(envelope);
    });

    it('accepts an explicitly unscoped workflow kickoff payload', () => {
      const envelope = buildWorkflowArmEnvelope({
        payload: { promptType: 'workflow_kickoff', userMessage: 'Plan generally' },
      });
      const result = validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      expect(result).toEqual(envelope);
    });

    it('rejects a workflow arm carrying a non-kickoff payload', () => {
      const envelope = buildWorkflowArmEnvelope({
        payload: { promptType: LocalPromptType.DailySession, payloadVersion: 1 },
      });

      expect(() => validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toThrow(
        TriggerPayloadValidationError,
      );
    });

    it('rejects a workflow kickoff payload with malformed focal identity', () => {
      const envelope = buildWorkflowArmEnvelope({
        payload: {
          promptType: 'workflow_kickoff',
          entity: { entityType: 'TASK', entityId: 'not-a-uuid' },
          userMessage: 'Plan this task',
        },
      });
      expect(() => validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toThrow(
        TriggerPayloadValidationError,
      );
    });

    it('rejects an envelope carrying both arms (workflowName plus handlerPromptType and payload)', () => {
      const envelope = buildWorkflowArmEnvelope({
        attachments: [],
        handlerPromptType: LocalPromptType.DailySession,
        payload: { promptType: LocalPromptType.DailySession, payloadVersion: 1 },
      });
      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain('workflowName');
    });

    it('rejects a partial turn-firing arm (handlerPromptType without payload, no workflowName)', () => {
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      delete envelope['payload'];
      let caught: TriggerPayloadValidationError | undefined;
      try {
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      } catch (err) {
        caught = err as TriggerPayloadValidationError;
      }
      expect(caught).toBeInstanceOf(TriggerPayloadValidationError);
      expect(caught?.message).toContain('workflowName');
    });

    it('accepts an envelope without reasoningEffort (providers like OpenCode do not support it)', () => {
      const envelopeWithoutReasoningEffort = {
        attachments: [],
        handlerPromptType: LocalPromptType.DailySession,
        payload: { promptType: LocalPromptType.DailySession, payloadVersion: 1 },
        model: 'claude-opus-4-7',
        // reasoningEffort omitted - providers like OpenCode don't support it
        provider: LocalRunProvider.Claude,
        contextMetadata: VALID_CONTEXT_METADATA,
        serviceIds: ['svc-1'],
        launchServiceId: 'svc-1',
        agentSessionId: 'sess-abc',
      };
      const result = validateTriggerPayload(
        START_RUN_TRIGGER_SENTINEL,
        envelopeWithoutReasoningEffort,
      );
      expect(result).toEqual(envelopeWithoutReasoningEffort);
    });

    it.each([
      [LocalRunProvider.Codex, true],
      [LocalRunProvider.Codex, false],
      [LocalRunProvider.Claude, true],
      [LocalRunProvider.Claude, false],
    ])('preserves %s fastMode=%s unchanged', (provider, fastMode) => {
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      envelope['provider'] = provider;
      envelope['fastMode'] = fastMode;

      expect(validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toEqual(envelope);
    });

    it('rejects fastMode for an OpenCode provider', () => {
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      envelope['provider'] = LocalRunProvider.Opencode;
      envelope['fastMode'] = false;

      expect(() => validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toThrow(
        /fastMode is supported only when provider is codex or claude/,
      );
    });

    it('accepts an envelope carrying typed AgentSession config', () => {
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      envelope['config'] = {
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'claude-opus-4-7',
        planCombinationAggressiveness: PlanCombinationAggressiveness.Medium,
        projectAssistant: {
          enabled: true,
          allowEdgeUpdates: true,
          notifyDiscrepancies: false,
          allowUpdateProposals: true,
        },
      };

      const result = validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope);
      expect(result).toEqual(envelope);
    });

    it.each([
      ['omitted', undefined],
      ['enabled', { enabled: true }],
      ['disabled', { enabled: false }],
    ] as const)(
      'preserves Entity Conversation Project Assistant %s',
      (_state, projectAssistant) => {
        const envelope = buildEnvelope(LocalPromptType.EntityConversation, {
          promptType: LocalPromptType.EntityConversation,
          entity: { id: VALID_DESIGN_DOC_ID },
          userMessage: 'Discuss this task.',
        });
        envelope['config'] = {
          type: 'ENTITY_CONVERSATION',
          version: 'v1',
          model: 'gpt-5.6-luna',
          ...(projectAssistant === undefined ? {} : { projectAssistant }),
        };

        expect(validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toEqual(envelope);
      },
    );

    it.each([true, false])(
      'preserves the Codex system-prompt pilot independently of Project Assistant (%s)',
      (disableCodexSystemPrompt) => {
        const envelope = buildEnvelope(LocalPromptType.EntityConversation, {
          promptType: LocalPromptType.EntityConversation,
          entity: { id: VALID_DESIGN_DOC_ID },
          userMessage: 'Discuss this task.',
        });
        envelope['config'] = {
          type: 'ENTITY_CONVERSATION',
          version: 'v1',
          model: 'gpt-5.6-luna',
          disableCodexSystemPrompt,
        };

        expect(validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toEqual(envelope);
      },
    );

    it('rejects an envelope carrying malformed plan-combination aggressiveness config', () => {
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      envelope['config'] = {
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'claude-opus-4-7',
        planCombinationAggressiveness: 'extreme',
      };

      expect(() => validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toThrow(
        TriggerPayloadValidationError,
      );
    });

    it('rejects an envelope carrying malformed AgentSession config', () => {
      const envelope = buildEnvelope(LocalPromptType.DailySession, {
        promptType: LocalPromptType.DailySession,
        payloadVersion: 1,
      });
      envelope['config'] = {
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'claude-opus-4-7',
        projectAssistant: {
          enabled: 'yes',
        },
      };

      expect(() => validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toThrow(
        TriggerPayloadValidationError,
      );
    });

    it('rejects malformed Entity Conversation Project Assistant intent', () => {
      const envelope = buildEnvelope(LocalPromptType.EntityConversation, {
        promptType: LocalPromptType.EntityConversation,
        entity: { id: VALID_DESIGN_DOC_ID },
        userMessage: 'Discuss this task.',
      });
      envelope['config'] = {
        type: 'ENTITY_CONVERSATION',
        version: 'v1',
        model: 'gpt-5.6-luna',
        projectAssistant: { enabled: 'yes' },
      };

      expect(() => validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toThrow(
        TriggerPayloadValidationError,
      );
    });

    it('validates the ID-only project-report payload, bound session config, and repository-free launch', () => {
      const requestId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const attemptId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
      const envelope = buildEnvelope(LocalPromptType.ProjectReport, {
        promptType: LocalPromptType.ProjectReport,
        request: { requestId, attemptId, projectId: VALID_PROJECT_ID },
      });
      envelope['provider'] = LocalRunProvider.Codex;
      envelope['model'] = 'gpt-5.6-sol';
      envelope['serviceIds'] = [];
      delete envelope['launchServiceId'];
      envelope['fastMode'] = true;
      const projectReportConfig = {
        type: 'PROJECT_REPORT',
        version: 'v1',
        requestId,
        attemptId,
        model: envelope['model'],
        effort: 'high',
        fastMode: true,
      };
      envelope['config'] = projectReportConfig;

      expect(validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, envelope)).toEqual(envelope);
      expect(() =>
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, {
          ...envelope,
          config: { ...projectReportConfig, attemptId: requestId },
        }),
      ).toThrow(TriggerPayloadValidationError);
      expect(() =>
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, {
          ...envelope,
          serviceIds: ['service'],
        }),
      ).toThrow(TriggerPayloadValidationError);
      expect(() =>
        validateTriggerPayload(START_RUN_TRIGGER_SENTINEL, {
          ...envelope,
          worktree: { enabled: true },
        }),
      ).toThrow(TriggerPayloadValidationError);
    });
  });
});
