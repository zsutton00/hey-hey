import { describe, expect, it } from 'vitest';
import type {
  RunContextMetadata,
  RunCreatePayload,
  RunCreatePayloadQuick,
  RunCreatePayloadRunEval,
  StartRunPromptPayload,
  AgentSessionConfig,
} from '../../shared/api/generated/api';

/**
 * Compile-time contract test for the start-run wire envelope.
 *
 * `StartRunPromptPayload` (and the `ConversationStartRunRequestDto` the UI
 * actually constructs) is generated from the shared `RunContextMetadata` /
 * `RunCreatePayload` schemas in openapi/specs/schemas — the same schemas the
 * CLI's internal agent bridge consumes. This file pins the producer-side guarantee:
 * the UI's TypeScript can no longer construct an envelope missing a
 * load-bearing `contextMetadata` field or carrying a `payload.promptType`
 * outside the union. The original dropped-trigger incident on conversation
 * 1ab0a49a-05e8-411e-be55-ae3fd13116e5 — a frame missing
 * `contextMetadata.capturedAt` reaching the CLI — cannot recur, because the
 * frame cannot be built.
 *
 * The `@ts-expect-error` lines ARE the assertions: each marks a construction
 * that MUST fail to typecheck. If the shared schema ever loosens such that one
 * of these compiles, `pnpm typecheck` fails on the now-unused directive.
 */

const VALID_FILE_REFERENCES: RunContextMetadata['fileReferences'] = {
  resolved: [],
  unresolved: [],
};

const VALID_CONTEXT_METADATA: RunContextMetadata = {
  capturedAt: '2026-01-01T00:00:00Z',
  organizationId: 'org-1',
  projectId: 'proj-1',
  agentSessionId: 'sess-1',
  userComments: [],
  fileReferences: VALID_FILE_REFERENCES,
};

const VALID_PAYLOAD: RunCreatePayload = {
  entity: { entityType: 'TASK', entityId: '11111111-1111-4111-8111-111111111111' },
  promptType: 'plan_shaping_finalize',
};

const VALID_QUICK_STARTUP_INPUT: NonNullable<RunCreatePayloadQuick['startupInput']> = {
  task: {
    taskType: 'STANDARD',
    description: 'Typed quick-start task context.',
  },
  adjacentScopeTasks: [],
  evidenceItems: [],
};

const VALID_EVAL_STARTUP_INPUT: NonNullable<RunCreatePayloadRunEval['startupInput']> = {
  task: {
    taskType: 'EVAL',
    description: 'Typed EVAL startup context.',
  },
  adjacentScopeTasks: [],
  evidenceItems: [],
};

const VALID_ENVELOPE: StartRunPromptPayload = {
  attachments: [],
  handlerPromptType: 'plan_shaping_finalize',
  payload: VALID_PAYLOAD,
  model: 'claude-opus-4-8',
  reasoningEffort: 'high',
  provider: 'claude',
  contextMetadata: VALID_CONTEXT_METADATA,
  serviceIds: ['svc-1'],
  launchServiceId: 'svc-1',
  agentSessionId: 'sess-1',
};

const VALID_AGENT_SESSION_CONFIG: AgentSessionConfig = {
  type: 'CODING_SESSION',
  version: 'v2',
  model: 'claude-opus-4-8',
  fastMode: true,
  projectAssistant: {
    enabled: false,
    allowEdgeUpdates: true,
    notifyDiscrepancies: false,
    allowUpdateProposals: true,
  },
};

const ENTITY_CONVERSATION_CONFIGS: AgentSessionConfig[] = [
  {
    type: 'ENTITY_CONVERSATION',
    version: 'v1',
    model: 'gpt-5.6-luna',
  },
  {
    type: 'ENTITY_CONVERSATION',
    version: 'v1',
    model: 'gpt-5.6-luna',
    projectAssistant: { enabled: true },
  },
  {
    type: 'ENTITY_CONVERSATION',
    version: 'v1',
    model: 'gpt-5.6-luna',
    projectAssistant: { enabled: false },
  },
];

describe('StartRunPromptPayload compile-time contract', () => {
  it('accepts a fully-formed envelope (positive control)', () => {
    expect(VALID_ENVELOPE.contextMetadata.capturedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('accepts typed AgentSession config on the start-run envelope', () => {
    const envelope: StartRunPromptPayload = {
      ...VALID_ENVELOPE,
      config: VALID_AGENT_SESSION_CONFIG,
    };

    expect(envelope.config).toEqual(VALID_AGENT_SESSION_CONFIG);
  });

  it.each(ENTITY_CONVERSATION_CONFIGS)(
    'accepts Entity Conversation participation intent on the start-run envelope',
    (config) => {
      const envelope: StartRunPromptPayload = {
        ...VALID_ENVELOPE,
        config,
      };

      expect(envelope.config).toEqual(config);
    },
  );

  it('accepts optional Fast mode intent on a Codex start-run envelope', () => {
    const enabled: StartRunPromptPayload = {
      ...VALID_ENVELOPE,
      provider: 'codex',
      fastMode: true,
    };
    const disabled: StartRunPromptPayload = { ...enabled, fastMode: false };
    const { fastMode: _omitted, ...omitted } = enabled;

    expect(enabled.fastMode).toBe(true);
    expect(disabled.fastMode).toBe(false);
    expect(omitted).not.toHaveProperty('fastMode');
  });

  it('rejects (at compile time) a contextMetadata missing any load-bearing field', () => {
    // @ts-expect-error — capturedAt is required
    const missingCapturedAt: RunContextMetadata = {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'sess-1',
      userComments: [],
      fileReferences: VALID_FILE_REFERENCES,
    };
    // @ts-expect-error — organizationId is required
    const missingOrganizationId: RunContextMetadata = {
      capturedAt: '2026-01-01T00:00:00Z',
      projectId: 'proj-1',
      agentSessionId: 'sess-1',
      userComments: [],
      fileReferences: VALID_FILE_REFERENCES,
    };
    // @ts-expect-error — projectId is required
    const missingProjectId: RunContextMetadata = {
      capturedAt: '2026-01-01T00:00:00Z',
      organizationId: 'org-1',
      agentSessionId: 'sess-1',
      userComments: [],
      fileReferences: VALID_FILE_REFERENCES,
    };
    // @ts-expect-error — agentSessionId is required
    const missingAgentSessionId: RunContextMetadata = {
      capturedAt: '2026-01-01T00:00:00Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      userComments: [],
      fileReferences: VALID_FILE_REFERENCES,
    };
    // @ts-expect-error — userComments is required
    const missingUserComments: RunContextMetadata = {
      capturedAt: '2026-01-01T00:00:00Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'sess-1',
      fileReferences: VALID_FILE_REFERENCES,
    };
    // @ts-expect-error — fileReferences is required
    const missingFileReferences: RunContextMetadata = {
      capturedAt: '2026-01-01T00:00:00Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'sess-1',
      userComments: [],
    };

    // Reference the bindings so they are not unused — the assertions live in
    // the `@ts-expect-error` directives above, not in any runtime check.
    expect([
      missingCapturedAt,
      missingOrganizationId,
      missingProjectId,
      missingAgentSessionId,
      missingUserComments,
      missingFileReferences,
    ]).toHaveLength(6);
  });

  it('rejects (at compile time) a payload.promptType outside the RunCreatePayload union', () => {
    const followUpOnlyPayload: RunCreatePayload = {
      // @ts-expect-error — coding_freeform is a follow-up-only variant, not a
      // member of RunCreatePayload, so it cannot ride a start-run envelope.
      promptType: 'coding_freeform',
      userMessage: 'hi',
    };
    expect(followUpOnlyPayload).toBeDefined();
  });

  // quick rides the start-run envelope (explicit-selection-only, no follow-up
  // analogue, not in PROJECT_ASSISTANT_ELIGIBLE_PROMPT_TYPES). This pins, at compile
  // time, that the union retains the quick arm; if a regen ever drops the arm,
  // the positive construction stops compiling.
  it('keeps userMessage required while making deprecated startupInput optional', () => {
    const quickPayload: RunCreatePayloadQuick = {
      entity: { entityType: 'TASK', entityId: '11111111-1111-4111-8111-111111111111' },
      promptType: 'quick',
      startupInput: VALID_QUICK_STARTUP_INPUT,
      userMessage: 'do the thing quickly',
    };

    const quickPayloadWithoutDeprecatedInput: RunCreatePayloadQuick = {
      entity: { entityType: 'TASK', entityId: '11111111-1111-4111-8111-111111111111' },
      promptType: 'quick',
      userMessage: 'do the thing quickly',
    };

    // @ts-expect-error — userMessage is required on the quick arm
    const missingUserMessage: RunCreatePayloadQuick = {
      entity: { entityType: 'TASK', entityId: '11111111-1111-4111-8111-111111111111' },
      promptType: 'quick',
      startupInput: VALID_QUICK_STARTUP_INPUT,
    };

    expect(quickPayload.promptType).toBe('quick');
    expect(quickPayloadWithoutDeprecatedInput.promptType).toBe('quick');
    expect(missingUserMessage).toBeDefined();
  });

  it('accepts an EVAL RunCreatePayload member with its typed startup input', () => {
    const evalPayload: RunCreatePayloadRunEval = {
      entity: { entityType: 'TASK', entityId: '11111111-1111-4111-8111-111111111111' },
      promptType: 'run_eval',
      startupInput: VALID_EVAL_STARTUP_INPUT,
      userMessage: 'run the selected evaluation',
      evalRunId: '22222222-2222-4222-8222-222222222222',
      judgeSetup: { provider: 'claude', model: 'sonnet' },
      settings: { maxConcurrentAttempts: 3 },
      attempts: [
        {
          attemptId: '33333333-3333-4333-8333-333333333333',
          targetSessionId: '77777777-7777-4777-8777-777777777777',
          targetConversationId: '88888888-8888-4888-8888-888888888888',
          configuration: {
            id: '44444444-4444-4444-8444-444444444444',
            target: { provider: 'claude', model: 'sonnet' },
          },
          caseInput: {
            id: '55555555-5555-4555-8555-555555555555',
            evalCaseId: '66666666-6666-4666-8666-666666666666',
            title: 'Recognises a stale requirement',
            target: {
              situation: 'A requirement no longer matches the shipped behaviour.',
              initiatingRequest: 'Update the feature.',
              targetHandler: 'refine',
            },
            grading: { checks: [], rubric: [] },
          },
        },
      ],
    };

    expect(evalPayload.promptType).toBe('run_eval');
    expect(evalPayload.startupInput?.task.taskType).toBe('EVAL');
  });

  // daily_session rides the start-run envelope (it is intentionally absent from
  // the per-variant triggerPayloadSchemas registry — its shape is guaranteed by
  // the shared RunCreatePayload union, not a runtime mirror). This pins, at
  // compile time, that the union retains the daily_session arm carrying its
  // LocalDailySessionPromptPayload body; if a regen ever drops the arm, the
  // positive construction stops compiling and the negative directive goes unused.
  it('accepts a daily_session RunCreatePayload member and requires its payloadVersion', () => {
    const dailySessionPayload: RunCreatePayload = {
      promptType: 'daily_session',
      payloadVersion: 1,
      userMessage: 'do the thing',
    };

    // @ts-expect-error — payloadVersion is required on the daily_session arm
    const missingPayloadVersion: RunCreatePayload = {
      promptType: 'daily_session',
    };

    expect(dailySessionPayload.promptType).toBe('daily_session');
    expect(missingPayloadVersion).toBeDefined();
  });
});
