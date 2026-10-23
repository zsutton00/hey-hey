import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';
import { Run, type RunCollaborators } from './run';
import type {
  InternalRunPromptRequest,
  ProjectAssistantConfig,
} from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import { freeFormHandler } from '../agents/coding-conversation';
import { projectModeHandler } from '../agents/project-mode';
import type { ProjectAssistantPromptPayload } from '../agents/project-assistant/project-assistant.handler';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import type { ProjectModeSnapshot } from '../shared/agent-bridge-contract/generated/api';

const MODE_ID = '11111111-1111-4111-8111-111111111111';

const PROJECT_MODE_POLICY = {
  allowEdgeUpdates: false,
  notifyDiscrepancies: false,
  workItemProposalMode: 'all',
};

type CapturedSetting = boolean | 'v1';

const makeSnapshot = (captured: CapturedSetting): ProjectModeSnapshot => ({
  schemaVersion: captured === 'v1' ? 'project-mode-snapshot.v1' : 'project-mode-snapshot.v2',
  modeId: MODE_ID,
  catalogDescription: 'A careful coding mode.',
  applicableWorkItemTypeKeys: ['STANDARD'],
  files: {
    schemaVersion: 'project-mode-files.v1',
    files: { 'MODE.md': 'Work carefully.' },
  },
  ...(captured === 'v1' ? {} : { projectAssistant: { enabled: captured } }),
  snapshotHash: 'a'.repeat(64),
});

const makeSession = (
  captured: CapturedSetting | null,
  projectAssistant?: ProjectAssistantConfig,
): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    conversationId: 'conv-1',
    events: [],
    entity: { entityType: 'TASK', entityId: 'task-1' },
    config: {
      type: 'CODING_SESSION',
      version: 'v2',
      model: 'claude-opus-4-7',
      ...(captured === null
        ? {}
        : {
            projectModeSelection: { schemaVersion: 'project-mode-selection.v1', modeId: MODE_ID },
            projectModeSnapshot: makeSnapshot(captured),
          }),
      ...(projectAssistant !== undefined ? { projectAssistant } : {}),
    },
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      task: { id: 'task-1', name: 'Task one', type: 'STANDARD', sections: [] },
    },
  }) as unknown as AgenticSession;

const makeInput = (promptType: LocalPromptType): InternalRunPromptRequest =>
  ({
    promptType,
    payload: { userMessage: 'Implement the task.' },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as unknown as InternalRunPromptRequest;

const buildHarness = (session: AgenticSession) => {
  const runStore = createTestRunStore();
  const updateRunProjectAssistantDone = vi
    .spyOn(runStore, 'updateRunProjectAssistantDone')
    .mockResolvedValue(session);
  const handlers: Record<string, PromptTypeHandler<unknown>> = {
    [LocalPromptType.ProjectMode]: projectModeHandler as unknown as PromptTypeHandler<unknown>,
    [LocalPromptType.FreeForm]: freeFormHandler as unknown as PromptTypeHandler<unknown>,
  };
  const collaborators: RunCollaborators = {
    runStore,
    repoStore: createTestRepoMappingStore(),
    poster: createTestMessagePoster({ createOutOfBand: vi.fn().mockResolvedValue('m-1') }),
    broadcaster: createTestRunEventPublisher(),
    ...createTestRunOwnership((promptType) =>
      promptType === undefined ? undefined : handlers[promptType],
    ),
    handlerDeps: {} as unknown as PromptTypeHandlerDeps,
    runnerPicker: createTestRunnerPicker(),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RunCollaborators['logger'],
  };
  const run = new Run(
    {
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      provider: 'claude',
      session,
    },
    collaborators,
  );
  const startTurn = vi
    .spyOn(
      run as unknown as { startTurn: (input: InternalRunPromptRequest) => Promise<void> },
      'startTurn',
    )
    .mockResolvedValue(undefined);
  return { run, startTurn, updateRunProjectAssistantDone };
};

describe('Run Project Assistant participation for Agent Modes', () => {
  it('runs Project Assistant with the fixed authority policy when the captured setting is on', async () => {
    const h = buildHarness(makeSession(true));
    const original = makeInput(LocalPromptType.ProjectMode);

    await h.run.handleMessage(original);

    const bootstrap = h.startTurn.mock.calls[0]![0];
    expect(bootstrap.promptType).toBe(LocalPromptType.ProjectAssistant);
    const payload = bootstrap.payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.projectAssistantHandoff).toEqual({
      consumerHandlerId: 'project_mode',
      policy: PROJECT_MODE_POLICY,
    });
    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    expect(h.run.dequeue()).toBe(original);
  });

  it('skips Project Assistant when the captured setting is off', async () => {
    const h = buildHarness(makeSession(false));
    const original = makeInput(LocalPromptType.ProjectMode);

    await h.run.handleMessage(original);

    expect(h.startTurn).toHaveBeenCalledOnce();
    expect(h.startTurn.mock.calls[0]![0]).toBe(original);
    expect(h.updateRunProjectAssistantDone).not.toHaveBeenCalled();
  });

  it('still lets session configuration disable Project Assistant when the setting is on', async () => {
    const h = buildHarness(makeSession(true, { enabled: false }));
    const original = makeInput(LocalPromptType.ProjectMode);

    await h.run.handleMessage(original);

    expect(h.startTurn).toHaveBeenCalledOnce();
    expect(h.startTurn.mock.calls[0]![0]).toBe(original);
  });

  it('lets session configuration narrow authority but not broaden it', async () => {
    const h = buildHarness(
      makeSession(true, { allowUpdateProposals: false, allowEdgeUpdates: true }),
    );

    await h.run.handleMessage(makeInput(LocalPromptType.ProjectMode));

    const payload = h.startTurn.mock.calls[0]![0]
      .payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.projectAssistantHandoff.policy).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    });
  });

  it.each([
    ['off', false as const, false],
    ['a pre-setting v1 capture', 'v1' as const, true],
  ])(
    'a restored Run uses the captured value for %s rather than the current MODE',
    async (_label, captured, expectsBootstrap) => {
      const h = buildHarness(makeSession(captured));

      await h.run.handleMessage(makeInput(LocalPromptType.ProjectMode));

      expect(h.startTurn.mock.calls[0]![0].promptType).toBe(
        expectsBootstrap ? LocalPromptType.ProjectAssistant : LocalPromptType.ProjectMode,
      );
    },
  );

  it('leaves built-in handler participation unchanged', async () => {
    const h = buildHarness(makeSession(null));

    await h.run.handleMessage(makeInput(LocalPromptType.FreeForm));

    const payload = h.startTurn.mock.calls[0]![0]
      .payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.projectAssistantHandoff).toEqual({
      consumerHandlerId: 'free_form',
      policy: freeFormHandler.projectAssistant,
    });
  });
});
