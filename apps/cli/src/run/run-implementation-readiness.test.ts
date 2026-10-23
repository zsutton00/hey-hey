import { describe, expect, it, vi } from 'vitest';

import type { AgentStartupPromptInputResult } from '../agents/prompt-type-handler';
import {
  createReadinessSourceSnapshotFromStartupInput,
  type ReadinessSourceSnapshotFromStartupInput,
} from '../agents/implementation-readiness/source-snapshot';
import type { ImplementationReadinessDisposition } from '../shared/api/generated/api';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import type { RunStore } from '../run-store/run-store';
import { createTestMessagePoster, createTestRun, createTestRunStore } from './run.test-support';
import type { Run } from './run';

const makeStartupPromptInput = (displayName: string): AgentStartupPromptInputResult => ({
  startupInput: {
    task: {
      id: 'task-1',
      title: 'Readiness-gated task',
      taskType: 'STANDARD',
      description: displayName,
    },
    focalEntity: { entityType: 'TASK', entityId: 'task-1' },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  renderedInput: displayName,
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: 'task-1' },
    entity: {
      id: 'task-1',
      title: 'Readiness-gated task',
      type: 'STANDARD',
      summary: displayName,
      sections: [],
    } as never,
    context: {
      entityId: 'task-1',
      entityType: 'TASK',
      displayName,
      taskType: 'STANDARD',
      content: {
        sections: { description: displayName },
        status: 'ACTIVE',
        priority: 'MEDIUM',
        assigneeId: null,
        dueDate: null,
      },
      featureHierarchy: [],
      relatedEntities: [],
      planContext: null,
    } as never,
  },
  provenance: {
    templateKey: 'task',
    ownershipSource: { scope: 'CANONICAL' },
    revisionId: 'template-revision-1',
    revisionNumber: 1,
  },
  template: {
    templateKey: 'task',
    selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
    syntaxVersion: 'V1',
    content: displayName,
    provenance: {
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'template-revision-1',
      revisionNumber: 1,
    },
  },
});

const makeSession = (implementationReadiness: ImplementationReadinessDisposition): AgenticSession =>
  ({
    entity: { entityType: 'TASK', entityId: 'task-1' },
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'idle',
    services: [],
    conversationId: 'conversation-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'project-1' },
    sessionContext: { implementationReadiness },
    events: [],
  }) as unknown as AgenticSession;

type ReadinessAdmission = {
  enforceImplementationReadinessAdmission(
    input: InternalRunPromptRequest,
    startupPromptInput: AgentStartupPromptInputResult | null,
  ): Promise<void>;
  startupPromptInputResult: AgentStartupPromptInputResult | null;
};

const callAdmission = (
  run: Run,
  input: InternalRunPromptRequest,
  startupPromptInput: AgentStartupPromptInputResult,
): Promise<void> => {
  const owner = run as unknown as ReadinessAdmission;
  owner.startupPromptInputResult = startupPromptInput;
  return owner.enforceImplementationReadinessAdmission(input, startupPromptInput);
};

const makeInput = (
  triggerContext: InternalRunPromptRequest['triggerContext'],
  options: {
    promptType?: LocalPromptType;
    implementationReadiness?: ImplementationReadinessDisposition;
  } = {},
): InternalRunPromptRequest =>
  ({
    promptType: options.promptType ?? LocalPromptType.StartupSession,
    payload: {
      promptType: options.promptType ?? LocalPromptType.StartupSession,
      ...(options.implementationReadiness
        ? { implementationReadiness: options.implementationReadiness }
        : {}),
    },
    references: { resolved: [], unresolved: [] },
    triggerContext,
  }) as InternalRunPromptRequest;

const makeReply = (promptType: LocalPromptType): InternalRunPromptRequest =>
  ({
    promptType,
    payload: { promptType, userMessage: 'The API owns it.' },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

const routeClarification = (run: Run, input: InternalRunPromptRequest): InternalRunPromptRequest =>
  (
    run as unknown as {
      routeImplementationReadinessClarification(
        input: InternalRunPromptRequest,
      ): InternalRunPromptRequest;
    }
  ).routeImplementationReadinessClarification(input);

const makeSnapshot = (
  startupPromptInput: AgentStartupPromptInputResult,
): NonNullable<ReturnType<typeof createReadinessSourceSnapshotFromStartupInput>> => {
  const input: ReadinessSourceSnapshotFromStartupInput = {
    runId: 'run-1',
    startupPromptInput,
    capturedAt: '2026-09-17T20:00:00.000Z',
  };
  const snapshot = createReadinessSourceSnapshotFromStartupInput(input);
  if (!snapshot) throw new Error('Expected a task startup context.');
  return snapshot;
};

const makeFinding = () => ({
  affectedSourceContext: 'The task and its design document',
  unresolvedDecision: 'Which service owns the write path?',
  consequentialInventionRisk: 'Implementation could place durable state in the wrong service.',
  boundedEvidence: [
    {
      category: 'behavior' as const,
      statement: 'The checked context leaves two observable outcomes open.',
      sourceRef: 'task.description',
    },
  ],
  answerKind: 'Name the authoritative service.',
});

const makeRunHarness = (disposition: ImplementationReadinessDisposition) => {
  const session = makeSession(disposition);
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'updateRunImplementationReadiness').mockResolvedValue(session);
  const poster = createTestMessagePoster({
    submitExternalAgentCompletion: vi.fn().mockResolvedValue('refresh-completion-1'),
  });
  const run = createTestRun(
    {
      runId: 'run-1',
      session,
      skipProjectAssistant: true,
    },
    { runStore, poster },
  );
  return { run, runStore, poster };
};

describe('Run implementation-readiness admission', () => {
  it('keeps a clear disposition terminal when source context changes', async () => {
    const checkedContext = makeStartupPromptInput('Original source context');
    const currentContext = makeStartupPromptInput('Changed source context');
    const disposition: ImplementationReadinessDisposition = {
      state: 'CLEAR',
      sourceSnapshot: makeSnapshot(checkedContext),
      finding: null,
      resolution: { kind: 'NONE' },
    };
    const { run, runStore, poster } = makeRunHarness(disposition);

    await expect(callAdmission(run, makeInput(null), currentContext)).resolves.toBeUndefined();
    expect(runStore.updateRunImplementationReadiness).not.toHaveBeenCalled();
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  it('does not permit a review-required disposition to reach a coding turn', async () => {
    const startupPromptInput = makeStartupPromptInput('Needs a behavior decision');
    const disposition: ImplementationReadinessDisposition = {
      state: 'REVIEW_REQUIRED',
      sourceSnapshot: makeSnapshot(startupPromptInput),
      finding: makeFinding(),
      resolution: { kind: 'NONE' },
    };
    const { run, poster } = makeRunHarness(disposition);

    await expect(callAdmission(run, makeInput(null), startupPromptInput)).rejects.toThrow(
      'requires a clarification or dismissal',
    );
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  it.each([LocalPromptType.CodingFreeform, LocalPromptType.FreeForm, LocalPromptType.Quick])(
    'routes a %s reply to a review-required finding into the free-form readiness assessment',
    async (promptType) => {
      const startupPromptInput = makeStartupPromptInput('Needs a behavior decision');
      const { run } = makeRunHarness({
        state: 'REVIEW_REQUIRED',
        sourceSnapshot: makeSnapshot(startupPromptInput),
        finding: makeFinding(),
        resolution: { kind: 'NONE' },
      });

      const routed = routeClarification(run, makeReply(promptType));

      expect(routed.promptType).toBe(LocalPromptType.FreeForm);
      expect(routed.triggerContext).toBeNull();
      expect(routed.payload).toEqual({
        promptType: LocalPromptType.FreeForm,
        userMessage: 'The API owns it.',
      });
      // The routed turn is the assessment itself, so admission lets it run.
      await expect(callAdmission(run, routed, startupPromptInput)).resolves.toBeUndefined();
    },
  );

  it('leaves a reply to a live workflow review with that workflow', () => {
    const startupPromptInput = makeStartupPromptInput('Needs a behavior decision');
    const { run } = makeRunHarness({
      state: 'REVIEW_REQUIRED',
      sourceSnapshot: makeSnapshot(startupPromptInput),
      finding: makeFinding(),
      resolution: { kind: 'NONE' },
    });
    const reply = { ...makeReply(LocalPromptType.CodingFreeform), awaitingUserReview: true };

    expect(routeClarification(run, reply)).toBe(reply);
  });

  it('accepts a CLEAR from the clarification and admits later coding replies unrouted', async () => {
    const startupPromptInput = makeStartupPromptInput('Needs a behavior decision');
    const sourceSnapshot = makeSnapshot(startupPromptInput);
    const { run, runStore } = makeRunHarness({
      state: 'REVIEW_REQUIRED',
      sourceSnapshot,
      finding: makeFinding(),
      resolution: { kind: 'NONE' },
    });
    vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue(undefined as never);
    (run as unknown as ReadinessAdmission).startupPromptInputResult = startupPromptInput;

    await run.persistImplementationReadinessFromAgentResponse({
      state: 'CLEAR',
      sourceSnapshot,
      finding: null,
      resolution: { kind: 'NONE' },
    });

    const reply = makeReply(LocalPromptType.CodingFreeform);
    expect(routeClarification(run, reply)).toBe(reply);
    await expect(callAdmission(run, reply, startupPromptInput)).resolves.toBeUndefined();
    expect(() =>
      run.validateImplementationReadinessFromAgentResponse({
        state: 'REVIEW_REQUIRED',
        sourceSnapshot,
        finding: makeFinding(),
        resolution: { kind: 'NONE' },
      }),
    ).toThrow('already complete');
  });

  it('keeps an unresolved reassessment reviewable and routes the next reply again', async () => {
    const startupPromptInput = makeStartupPromptInput('Needs a behavior decision');
    const sourceSnapshot = makeSnapshot(startupPromptInput);
    const { run, runStore } = makeRunHarness({
      state: 'REVIEW_REQUIRED',
      sourceSnapshot,
      finding: makeFinding(),
      resolution: { kind: 'NONE' },
    });
    vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue(undefined as never);
    (run as unknown as ReadinessAdmission).startupPromptInputResult = startupPromptInput;

    await run.persistImplementationReadinessFromAgentResponse({
      state: 'REVIEW_REQUIRED',
      sourceSnapshot,
      finding: { ...makeFinding(), unresolvedDecision: 'Which API version owns it?' },
      resolution: { kind: 'NONE' },
    });

    const reply = makeReply(LocalPromptType.CodingFreeform);
    await expect(callAdmission(run, reply, startupPromptInput)).rejects.toThrow(
      'requires a clarification or dismissal',
    );
    expect(routeClarification(run, reply).promptType).toBe(LocalPromptType.FreeForm);
  });

  it.each([
    LocalPromptType.PlanExecution,
    LocalPromptType.CodeReview,
    LocalPromptType.StartupSession,
    LocalPromptType.Implement,
  ])('does not route workflow-generated %s prompts into a readiness check', (promptType) => {
    const startupPromptInput = makeStartupPromptInput('Needs a behavior decision');
    const { run } = makeRunHarness({
      state: 'REVIEW_REQUIRED',
      sourceSnapshot: makeSnapshot(startupPromptInput),
      finding: makeFinding(),
      resolution: { kind: 'NONE' },
    });
    const input = {
      promptType,
      payload: { promptType },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    } as unknown as InternalRunPromptRequest;

    expect(routeClarification(run, input)).toBe(input);
  });

  it('normalizes every submitted source snapshot from the authoritative startup context', () => {
    const startupPromptInput = makeStartupPromptInput('Authoritative source context');
    const submittedSnapshot = {
      ...makeSnapshot(startupPromptInput),
      capturedAt: '2020-01-01T00:00:00.000Z',
    };
    const disposition: ImplementationReadinessDisposition = {
      state: 'REVIEW_REQUIRED',
      sourceSnapshot: submittedSnapshot,
      finding: makeFinding(),
      resolution: { kind: 'NONE' },
    };
    const { run } = makeRunHarness(disposition);
    (run as unknown as ReadinessAdmission).startupPromptInputResult = startupPromptInput;

    const normalized = run.normalizeImplementationReadinessForSubmission(disposition);

    expect(normalized.sourceSnapshot).toMatchObject({
      runId: 'run-1',
      focalEntityId: 'task-1',
      focalEntityType: 'TASK',
      sourceRevision: makeSnapshot(startupPromptInput).sourceRevision,
    });
    expect(normalized.sourceSnapshot.capturedAt).not.toBe(submittedSnapshot.capturedAt);
  });

  it('admits a run-bound dismissal after later source changes', async () => {
    const startupPromptInput = makeStartupPromptInput('Dismissed source context');
    const sourceSnapshot = makeSnapshot(startupPromptInput);
    const disposition: ImplementationReadinessDisposition = {
      state: 'DISMISSED',
      sourceSnapshot,
      finding: makeFinding(),
      resolution: {
        kind: 'DISMISSED',
        runId: 'run-1',
        sourceRevision: sourceSnapshot.sourceRevision,
        resolvedAt: '2026-09-17T20:01:00.000Z',
      },
    };
    const { run, poster } = makeRunHarness(disposition);

    await expect(
      callAdmission(run, makeInput(null), makeStartupPromptInput('Later changed context')),
    ).resolves.toBeUndefined();
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  it('does not let an agent author dismissal or reopen a terminal decision', () => {
    const startupPromptInput = makeStartupPromptInput('Already admitted source context');
    const sourceSnapshot = makeSnapshot(startupPromptInput);
    const terminal: ImplementationReadinessDisposition = {
      state: 'CLEAR',
      sourceSnapshot,
      finding: null,
      resolution: { kind: 'NONE' },
    };
    const review: ImplementationReadinessDisposition = {
      state: 'REVIEW_REQUIRED',
      sourceSnapshot,
      finding: makeFinding(),
      resolution: { kind: 'NONE' },
    };
    const { run } = makeRunHarness(terminal);
    (run as unknown as ReadinessAdmission).startupPromptInputResult = startupPromptInput;

    expect(() => run.validateImplementationReadinessFromAgentResponse(review)).toThrow(
      'already complete',
    );
    expect(() =>
      run.validateImplementationReadinessFromAgentResponse({
        ...review,
        state: 'DISMISSED',
        resolution: {
          kind: 'DISMISSED',
          runId: sourceSnapshot.runId,
          sourceRevision: sourceSnapshot.sourceRevision,
          resolvedAt: '2026-09-17T20:01:00.000Z',
        },
      }),
    ).toThrow('reserved for the confirmed user-facing Dismiss action');
  });

  it.each([LocalPromptType.StartupSession, LocalPromptType.CodingFreeform])(
    'does not let a later %s payload reopen a terminal readiness result',
    async (promptType) => {
      const startupPromptInput = makeStartupPromptInput('Already admitted source context');
      const terminal: ImplementationReadinessDisposition = {
        state: 'CLEAR',
        sourceSnapshot: makeSnapshot(startupPromptInput),
        finding: null,
        resolution: { kind: 'NONE' },
      };
      const attemptedReopen: ImplementationReadinessDisposition = {
        state: 'REVIEW_REQUIRED',
        sourceSnapshot: makeSnapshot(makeStartupPromptInput('Later review context')),
        finding: makeFinding(),
        resolution: { kind: 'NONE' },
      };
      const { run } = makeRunHarness(terminal);

      await expect(
        callAdmission(
          run,
          makeInput(null, { promptType, implementationReadiness: attemptedReopen }),
          startupPromptInput,
        ),
      ).resolves.toBeUndefined();
    },
  );
});
