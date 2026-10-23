import { LocalPromptType } from 'src/generated/local';
import { WorkflowReviewAction } from 'src/generated';
import {
  ExternalAgentValidationError,
  FeatureSyncFlowContext,
  FlowUserMessage,
  NodeType,
  validateExternalAgentCompletion,
} from 'src/types/flow-internal.types';
import {
  createMutableContextHandle,
  MutableContextHandle,
} from 'src/utils/mutable-context';
import * as TestUtils from 'src/utils/testUtils';
import { FEATURE_SYNC_NODES } from '../../../constants/node-ids';
import { FeatureSyncAnalyzeNode } from '../analyze.node';
import { FeatureSyncCodingPlanNode } from '../coding-plan.node';
import { FeatureSyncImplementNode } from '../implement.node';
import { ImplementRuntimeService } from '../implement-runtime.service';
import { FeatureSyncIterateNode } from '../iterate.node';
import { FeatureSyncImplementationReadinessReviewNode } from '../implementation-readiness-review.node';
import {
  FEATURE_SYNC_ACTIONS,
  IMPLEMENTATION_READINESS_REVIEW_ACTIONS,
  featureSyncAnalyzeActions,
  featureSyncCodingPlanActions,
  featureSyncImplementActions,
  featureSyncIterateActions,
} from '../schemas';

const buildContext = (
  overrides: Partial<FeatureSyncFlowContext> = {},
): FeatureSyncFlowContext => {
  return TestUtils.createMockFlowContext({
    flowId: 'feature-sync',
    ...overrides,
  }) as FeatureSyncFlowContext;
};

const buildAgentMessage = (data: Record<string, unknown>): FlowUserMessage =>
  TestUtils.createMockFlowUserMessage({ data });

describe('FeatureSyncAnalyzeNode', () => {
  let node: FeatureSyncAnalyzeNode;

  beforeEach(() => {
    node = new FeatureSyncAnalyzeNode();
  });

  it('emits an EXTERNAL_AGENT result carrying an ANALYZE trigger with the typed taskId payload on entry', async () => {
    const context = buildContext({
      taskId: 'task-abc' as FeatureSyncFlowContext['taskId'],
    });
    const tracker = createMutableContextHandle(context);

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.uiElements).toHaveLength(1);
    expect(result.triggersAgent).toEqual({
      promptType: LocalPromptType.feature_sync_analyze,
      nodeId: FEATURE_SYNC_NODES.ANALYZE,
      payload: { taskId: 'task-abc' },
    });
  });

  it('folds featureSyncInitialPrompt into the trigger payload as userMessage', async () => {
    const context = buildContext({
      taskId: 'task-abc' as FeatureSyncFlowContext['taskId'],
      featureSyncInitialPrompt: '  focus on the auth subtree  ',
    });
    const tracker = createMutableContextHandle(context);

    const result = await node.execute(tracker);

    expect(
      (result.triggersAgent as unknown as { payload: unknown }).payload,
    ).toEqual({
      taskId: 'task-abc',
      userMessage: 'focus on the auth subtree',
    });
  });

  it('folds a pending readiness clarification into the next analyze trigger and clears it', async () => {
    const context = buildContext({
      taskId: 'task-abc' as FeatureSyncFlowContext['taskId'],
      featureSyncInitialPrompt: 'original launch context',
      featureSyncPendingUserReply: '  the API owns persistence  ',
    });
    const tracker = createMutableContextHandle(context);

    const result = await node.execute(tracker);

    expect(
      (result.triggersAgent as unknown as { payload: unknown }).payload,
    ).toEqual({
      taskId: 'task-abc',
      userMessage: 'the API owns persistence',
    });
    expect(tracker.getContext().featureSyncPendingUserReply).toBeUndefined();
  });

  it('throws when context.taskId is missing rather than shipping an unbound trigger payload', async () => {
    const context = buildContext();
    const tracker = createMutableContextHandle(context);

    await expect(node.execute(tracker)).rejects.toThrow(
      /feature_sync_analyze requires context\.taskId/,
    );
  });

  it('declares the NO_DISCREPANCY and DISCREPANCY action schemas', () => {
    expect(node.actions).toBe(featureSyncAnalyzeActions);
    expect(Object.keys(node.actions).sort()).toEqual(
      [
        FEATURE_SYNC_ACTIONS.DISCREPANCY,
        FEATURE_SYNC_ACTIONS.NO_DISCREPANCY,
        FEATURE_SYNC_ACTIONS.READINESS_CLEAR,
        FEATURE_SYNC_ACTIONS.READINESS_REVIEW_REQUIRED,
      ].sort(),
    );
  });

  it('declares promptType that matches the literal emitted on triggersAgent', async () => {
    expect(node.promptType).toBe(LocalPromptType.feature_sync_analyze);
    const result = await node.execute(
      createMutableContextHandle(
        buildContext({
          taskId: 'task-abc' as FeatureSyncFlowContext['taskId'],
        }),
      ),
    );
    expect(result.triggersAgent?.promptType).toBe(node.promptType);
  });

  it('validates NO_DISCREPANCY via the EXTERNAL_AGENT engine validator (no payload)', () => {
    const result = validateExternalAgentCompletion({
      nodeId: FEATURE_SYNC_NODES.ANALYZE,
      actions: node.actions,
      message: buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY,
      }),
    });
    expect(result.action).toBe(FEATURE_SYNC_ACTIONS.NO_DISCREPANCY);
  });

  it('validates DISCREPANCY with a populated discrepancies array', () => {
    const result = validateExternalAgentCompletion({
      nodeId: FEATURE_SYNC_NODES.ANALYZE,
      actions: node.actions,
      message: buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
        payload: {
          discrepancies: [
            {
              summary: 'Feature X missing service call',
              rationale: 'service.ts:47 no longer wires feature X',
            },
          ],
        },
      }),
    });
    expect(result.action).toBe(FEATURE_SYNC_ACTIONS.DISCREPANCY);
  });

  it('rejects DISCREPANCY with empty discrepancies array', () => {
    expect(() =>
      validateExternalAgentCompletion({
        nodeId: FEATURE_SYNC_NODES.ANALYZE,
        actions: node.actions,
        message: buildAgentMessage({
          action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
          payload: { discrepancies: [] },
        }),
      }),
    ).toThrow(ExternalAgentValidationError);
  });

  it('stashes discrepancies onto context when processUserResponse sees a DISCREPANCY', async () => {
    const context = buildContext();
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
        payload: {
          discrepancies: [
            {
              summary: 'feature drift',
              rationale: 'tasks no longer reflect feature X',
            },
          ],
        },
      }),
    );

    const updated = tracker.getContext();
    expect(updated.featureSyncDiscrepancies).toHaveLength(1);
    expect(updated.featureSyncResolved).toBe(false);
  });

  it('clears discrepancies when processUserResponse sees a NO_DISCREPANCY', async () => {
    const context = buildContext({
      featureSyncDiscrepancies: [
        { summary: 'stale', rationale: 'should be cleared' },
      ],
    });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({ action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY }),
    );

    const updated = tracker.getContext();
    expect(updated.featureSyncDiscrepancies).toBeUndefined();
    expect(updated.featureSyncResolved).toBe(true);
  });

  it('does not allow the legacy structural fast-path to bypass readiness', async () => {
    expect(
      await node.determineRoutingFromAgentCompletion!(
        buildContext(),
        FEATURE_SYNC_ACTIONS.NO_DISCREPANCY,
      ),
    ).toBe(FEATURE_SYNC_NODES.ANALYZE);
  });

  it('leaves context untouched on an unknown action', async () => {
    const seeded = [{ summary: 'pre-existing', rationale: 'should persist' }];
    const context = buildContext({
      featureSyncDiscrepancies: seeded,
      featureSyncResolved: false,
    });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({ action: 'DISCREPENCY' /* typo */ }),
    );

    const updated = tracker.getContext();
    expect(updated.featureSyncDiscrepancies).toEqual(seeded);
    expect(updated.featureSyncResolved).toBe(false);
  });

  it('leaves context untouched when DISCREPANCY payload is malformed', async () => {
    const context = buildContext({ featureSyncResolved: false });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
        payload: { discrepancies: [] },
      }),
    );

    const updated = tracker.getContext();
    expect(updated.featureSyncDiscrepancies).toBeUndefined();
    expect(updated.featureSyncResolved).toBe(false);
  });
});

describe('FeatureSyncImplementationReadinessReviewNode', () => {
  const sourceSnapshot = {
    runId: 'run-1',
    focalEntityId: 'task-abc',
    focalEntityType: 'TASK' as const,
    sourceRevision: 'sha256:source-1',
    capturedAt: '2026-09-17T20:00:00.000Z',
  };
  const disposition = {
    state: 'REVIEW_REQUIRED' as const,
    sourceSnapshot,
    finding: {
      affectedSourceContext: 'Task description and design doc',
      unresolvedDecision: 'Which service owns the state?',
      consequentialInventionRisk:
        'The implementation could assign ownership incorrectly.',
      boundedEvidence: [
        {
          category: 'ownership' as const,
          statement: 'Both services are named without an authoritative choice.',
        },
      ],
      answerKind: 'Name the owning service.',
    },
    resolution: { kind: 'NONE' as const },
  };

  it('renders the complete finding with Clarify and Dismiss actions', async () => {
    const node = new FeatureSyncImplementationReadinessReviewNode();
    const tracker = createMutableContextHandle(
      buildContext({ implementationReadiness: disposition }),
    );

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements).toHaveLength(1);
    expect(result.uiElements?.[0]).toMatchObject({
      type: 'implementation_readiness',
      payload: {
        responseType: 'implementation_readiness_v1',
        disposition,
      },
    });
    const secondaryActions = (
      result.data as { secondaryActions?: Array<{ label: string }> } | undefined
    )?.secondaryActions;
    expect(secondaryActions?.map((action) => action.label)).toEqual([
      'Clarify',
      'Dismiss',
    ]);
  });

  it('requires confirmation and the displayed source binding for dismissal actions', async () => {
    const node = new FeatureSyncImplementationReadinessReviewNode();
    const tracker = createMutableContextHandle(
      buildContext({ implementationReadiness: disposition }),
    );

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS,
        payload: {
          runId: sourceSnapshot.runId,
          sourceRevision: sourceSnapshot.sourceRevision,
        },
      }),
    );
    expect(tracker.getContext().implementationReadiness).toMatchObject({
      state: 'REVIEW_REQUIRED',
      resolution: { kind: 'NONE' },
    });
    expect(
      await node.determineRoutingFromUserMessage(
        tracker.getContext(),
        buildAgentMessage({
          action: IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS,
          payload: {
            runId: sourceSnapshot.runId,
            sourceRevision: sourceSnapshot.sourceRevision,
          },
        }),
      ),
    ).toBe(FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS,
        payload: {
          runId: sourceSnapshot.runId,
          sourceRevision: sourceSnapshot.sourceRevision,
          confirmed: true,
        },
      }),
    );
    expect(tracker.getContext().implementationReadiness).toMatchObject({
      state: 'DISMISSED',
      resolution: {
        kind: 'DISMISSED',
        runId: sourceSnapshot.runId,
        sourceRevision: sourceSnapshot.sourceRevision,
      },
    });
    expect(
      await node.determineRoutingFromUserMessage(
        tracker.getContext(),
        buildAgentMessage({
          action: IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS,
          payload: {
            runId: sourceSnapshot.runId,
            sourceRevision: sourceSnapshot.sourceRevision,
            confirmed: true,
          },
        }),
      ),
    ).toBe(FEATURE_SYNC_NODES.CODING_PLAN);
  });

  it('rejects stale dismissal actions', async () => {
    const node = new FeatureSyncImplementationReadinessReviewNode();
    const tracker = createMutableContextHandle(
      buildContext({ implementationReadiness: disposition }),
    );

    await expect(
      node.processUserResponse(
        tracker,
        buildAgentMessage({
          action: IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS,
          payload: {
            runId: sourceSnapshot.runId,
            sourceRevision: 'sha256:changed',
            confirmed: true,
          },
        }),
      ),
    ).rejects.toThrow(/stale/i);
  });

  it('captures standard-composer clarification and routes it to a fresh analyze turn', async () => {
    const node = new FeatureSyncImplementationReadinessReviewNode();
    const tracker = createMutableContextHandle(
      buildContext({ implementationReadiness: disposition }),
    );
    const clarification = buildAgentMessage({
      comment: 'The API service owns persistence.',
    });

    await node.processUserResponse(tracker, clarification);

    expect(tracker.getContext().featureSyncPendingUserReply).toBe(
      'The API service owns persistence.',
    );
    expect(
      await node.determineRoutingFromUserMessage(
        tracker.getContext(),
        clarification,
      ),
    ).toBe(FEATURE_SYNC_NODES.ANALYZE);
  });
});

describe('FeatureSyncIterateNode', () => {
  let node: FeatureSyncIterateNode;

  beforeEach(() => {
    node = new FeatureSyncIterateNode();
  });

  it('emits an EXTERNAL_AGENT result carrying an ITERATE trigger with the typed discrepancies payload on entry', async () => {
    const discrepancies = [
      {
        summary: 'auth feature missing',
        rationale: 'no impl in auth dir',
        entityType: 'FEATURE' as const,
        entityId: 'feat-1',
      },
    ];
    const context = buildContext({ featureSyncDiscrepancies: discrepancies });
    const tracker = createMutableContextHandle(context);

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.triggersAgent).toEqual({
      promptType: LocalPromptType.feature_sync_iterate,
      nodeId: FEATURE_SYNC_NODES.ITERATE,
      payload: { discrepancies },
    });
  });

  it('throws when context.featureSyncDiscrepancies is empty rather than silently shipping an empty list', async () => {
    const trackerEmpty = createMutableContextHandle(
      buildContext({ featureSyncDiscrepancies: [] }),
    );
    await expect(node.execute(trackerEmpty)).rejects.toThrow(
      /feature_sync_iterate requires context\.featureSyncDiscrepancies/,
    );

    const trackerMissing = createMutableContextHandle(buildContext());
    await expect(node.execute(trackerMissing)).rejects.toThrow(
      /feature_sync_iterate requires context\.featureSyncDiscrepancies/,
    );
  });

  it('declares the RESOLVED and REVISED action schemas', () => {
    expect(node.actions).toBe(featureSyncIterateActions);
    expect(Object.keys(node.actions).sort()).toEqual(
      [FEATURE_SYNC_ACTIONS.RESOLVED, FEATURE_SYNC_ACTIONS.REVISED].sort(),
    );
  });

  it('declares promptType that matches the literal emitted on triggersAgent', async () => {
    expect(node.promptType).toBe(LocalPromptType.feature_sync_iterate);
    const result = await node.execute(
      createMutableContextHandle(
        buildContext({
          featureSyncDiscrepancies: [{ summary: 'x', rationale: 'y' }],
        }),
      ),
    );
    expect(result.triggersAgent?.promptType).toBe(node.promptType);
  });

  it('clears outstanding discrepancies on RESOLVED', async () => {
    const context = buildContext({
      featureSyncDiscrepancies: [{ summary: 'x', rationale: 'y' }],
      featureSyncResolved: false,
    });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({ action: FEATURE_SYNC_ACTIONS.RESOLVED }),
    );

    const updated = tracker.getContext();
    expect(updated.featureSyncResolved).toBe(true);
    expect(updated.featureSyncDiscrepancies).toBeUndefined();
  });

  it('replaces outstanding discrepancies on REVISED', async () => {
    const context = buildContext({
      featureSyncDiscrepancies: [{ summary: 'old', rationale: 'old' }],
    });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: FEATURE_SYNC_ACTIONS.REVISED,
        payload: {
          discrepancies: [{ summary: 'new', rationale: 'new' }],
        },
      }),
    );

    const updated = tracker.getContext();
    expect(updated.featureSyncDiscrepancies).toHaveLength(1);
    expect(updated.featureSyncDiscrepancies?.[0]?.summary).toBe('new');
    expect(updated.featureSyncResolved).toBe(false);
  });
});

describe('FeatureSyncCodingPlanNode', () => {
  const mockTaskId = 'task-abc-123';
  const mockTask = {
    id: mockTaskId,
    name: 'Wire up startup trigger',
    type: 'STANDARD',
    sections: [
      {
        id: 'sec-desc',
        key: 'description',
        order: 0,
        materializedMarkdown: 'Body of the task description.',
      },
      {
        id: 'sec-ac',
        key: 'acceptanceCriteria',
        order: 1,
        materializedMarkdown: 'AC items for the task.',
      },
    ],
  };

  const buildNode = (task: typeof mockTask | null = mockTask) => {
    const taskService = {
      findOneForAdapter: jest.fn().mockResolvedValue(task),
    } as unknown as import('src/services/tasks/task.service').TaskService;
    return {
      node: new FeatureSyncCodingPlanNode(taskService),
      taskService,
    };
  };

  it('emits a startup_session trigger with a LocalStartupSessionPromptPayload on entry', async () => {
    const { node, taskService } = buildNode();
    const context = buildContext({
      taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
      featureSyncResolved: true,
    });
    const tracker: MutableContextHandle<FeatureSyncFlowContext> =
      createMutableContextHandle(context);

    const result = await node.execute(tracker);

    expect(taskService.findOneForAdapter).toHaveBeenCalledWith(
      mockTaskId,
      context.core.organizationId,
    );
    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.uiElements).toHaveLength(1);
    expect(result.uiElements?.[0]?.secondaryAction).toBeUndefined();
    expect(result.triggersAgent).toEqual({
      promptType: LocalPromptType.startup_session,
      nodeId: FEATURE_SYNC_NODES.CODING_PLAN,
      payload: {},
    });
  });

  it('sends no copied task content for a project-defined work-item type', async () => {
    const { node } = buildNode({
      ...mockTask,
      type: 'JOB_APPLICATION_RECORD',
      sections: mockTask.sections.slice(0, 1),
    });
    const tracker = createMutableContextHandle(
      buildContext({
        taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
      }),
    );

    const result = await node.execute(tracker);

    expect(
      (result.triggersAgent as { payload?: unknown } | undefined)?.payload,
    ).toEqual({});
  });

  it('carries the implementation-readiness disposition on the payload', async () => {
    const { node } = buildNode();
    const disposition = {
      state: 'CLEAR' as const,
      sourceSnapshot: {
        runId: 'run-1',
        focalEntityId: mockTaskId,
        focalEntityType: 'TASK' as const,
        sourceRevision: 'sha256:source-1',
        capturedAt: '2026-09-17T20:00:00.000Z',
      },
      finding: null,
      resolution: { kind: 'NONE' as const },
    };
    const tracker = createMutableContextHandle(
      buildContext({
        taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
        implementationReadiness: disposition,
      }),
    );

    const result = await node.execute(tracker);

    expect(
      (result.triggersAgent as { payload?: unknown } | undefined)?.payload,
    ).toEqual({ implementationReadiness: disposition });
  });

  it('declares only the REFINE and APPROVED action schemas', () => {
    const { node } = buildNode();
    expect(node.actions).toBe(featureSyncCodingPlanActions);
    expect(Object.keys(node.actions).sort()).toEqual(
      [WorkflowReviewAction.Refine, WorkflowReviewAction.Approved].sort(),
    );
  });

  it('declares promptType that matches the literal emitted on triggersAgent', async () => {
    const { node } = buildNode();
    expect(node.promptType).toBe(LocalPromptType.startup_session);
    const tracker = createMutableContextHandle(
      buildContext({
        taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
      }),
    );
    const result = await node.execute(tracker);
    expect(result.triggersAgent?.promptType).toBe(node.promptType);
  });

  const codingPlanPayload = {
    responseType: 'startup_plan_v1',
    sessionTitle: 'Refine the plan',
    requiredServiceIds: ['service-1'],
    primaryImplementations: [
      {
        title: 'Canonical workflow answer',
        content: 'Submit the action-specific startup-plan payload.',
        rationale: 'The workflow must receive the reviewed plan exactly.',
      },
    ],
    executionPlan: [],
    discrepancies: [],
    clarificationQuestions: [],
  } as const;

  it('validates APPROVED with its canonical plan payload', () => {
    const { node } = buildNode();
    const result = validateExternalAgentCompletion({
      nodeId: FEATURE_SYNC_NODES.CODING_PLAN,
      actions: node.actions,
      message: buildAgentMessage({
        action: WorkflowReviewAction.Approved,
        payload: codingPlanPayload,
      }),
    });
    expect(result.action).toBe(WorkflowReviewAction.Approved);
  });

  it('validates a user-authored REFINE answer with its canonical plan payload', () => {
    const { node } = buildNode();
    const payload = {
      ...codingPlanPayload,
      feedback: 'Keep the API behavior explicit.',
    };

    const result = validateExternalAgentCompletion({
      nodeId: FEATURE_SYNC_NODES.CODING_PLAN,
      actions: node.actions,
      message: buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload,
      }),
    });

    expect(result.action).toBe(WorkflowReviewAction.Refine);
  });

  it.each([WorkflowReviewAction.Refine, WorkflowReviewAction.Approved])(
    'rejects %s without the required startup-plan payload',
    (action) => {
      const { node } = buildNode();

      expect(() =>
        validateExternalAgentCompletion({
          nodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          actions: node.actions,
          message: buildAgentMessage({ action }),
        }),
      ).toThrow(ExternalAgentValidationError);
    },
  );

  it('rejects REFINE when the startup-plan payload is incomplete', () => {
    const { node } = buildNode();

    expect(() =>
      validateExternalAgentCompletion({
        nodeId: FEATURE_SYNC_NODES.CODING_PLAN,
        actions: node.actions,
        message: buildAgentMessage({
          action: WorkflowReviewAction.Refine,
          payload: { feedback: 'This must not bypass the plan contract.' },
        }),
      }),
    ).toThrow(ExternalAgentValidationError);
  });

  it('rejects unknown actions with ExternalAgentValidationError', () => {
    const { node } = buildNode();
    expect(() =>
      validateExternalAgentCompletion({
        nodeId: FEATURE_SYNC_NODES.CODING_PLAN,
        actions: node.actions,
        message: buildAgentMessage({ action: 'APPROOVED' /* typo */ }),
      }),
    ).toThrow(ExternalAgentValidationError);
  });

  it.each(['REVISED', 'submit_approved'])(
    'rejects legacy coding-plan action %s',
    (action) => {
      const { node } = buildNode();
      expect(() =>
        validateExternalAgentCompletion({
          nodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          actions: node.actions,
          message: buildAgentMessage({ action, payload: codingPlanPayload }),
        }),
      ).toThrow(expect.objectContaining({ reason: 'unknown_action' }));
    },
  );

  it('re-emits the trigger on two consecutive REFINE re-entries', async () => {
    const { node, taskService } = buildNode();
    const context = buildContext({
      taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
    });
    const tracker: MutableContextHandle<FeatureSyncFlowContext> =
      createMutableContextHandle(context);

    const firstEntry = await node.execute(tracker);
    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: {},
      }),
    );
    const secondEntry = await node.execute(tracker);
    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Refine,
        payload: {},
      }),
    );
    const thirdEntry = await node.execute(tracker);

    expect(firstEntry.triggersAgent?.promptType).toBe(
      LocalPromptType.startup_session,
    );
    expect(secondEntry.triggersAgent?.promptType).toBe(
      LocalPromptType.startup_session,
    );
    expect(thirdEntry.triggersAgent?.promptType).toBe(
      LocalPromptType.startup_session,
    );
    expect(taskService.findOneForAdapter).toHaveBeenCalledTimes(3);
  });

  it('ends the flow on APPROVED without re-emitting the trigger', async () => {
    const { node, taskService } = buildNode();
    const context = buildContext({
      taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
    });
    const tracker: MutableContextHandle<FeatureSyncFlowContext> =
      createMutableContextHandle(context);

    await node.execute(tracker);
    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Approved,
        payload: codingPlanPayload,
      }),
    );

    // APPROVED routes to the terminal implement node in the flow template,
    // so coding_plan.execute() must not run a second time; the
    // task-lookup count proves the trigger was not re-emitted.
    expect(taskService.findOneForAdapter).toHaveBeenCalledTimes(1);
  });

  it('leaves context untouched on APPROVED (plan lives in conversation history)', async () => {
    const { node } = buildNode();
    const context = buildContext({
      taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
      featureSyncDiscrepancies: [
        { summary: 'pre-existing', rationale: 'must persist' },
      ],
      featureSyncResolved: true,
    });
    const tracker: MutableContextHandle<FeatureSyncFlowContext> =
      createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Approved,
        payload: codingPlanPayload,
      }),
    );

    const updated = tracker.getContext();
    expect(updated.featureSyncDiscrepancies).toEqual([
      { summary: 'pre-existing', rationale: 'must persist' },
    ]);
    expect(updated.featureSyncResolved).toBe(true);
  });

  it('records the approved runtime without moving the plan or feedback into routing context', async () => {
    const { node } = buildNode();
    const tracker = createMutableContextHandle(buildContext());
    const payload = {
      ...codingPlanPayload,
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      fastMode: false,
      feedback: 'Keep the approved scope.',
    };
    const message = buildAgentMessage({
      action: WorkflowReviewAction.Approved,
      payload,
    });
    message.workflowAnswerOperationId = '20000000-0000-4000-8000-000000000002';
    await node.processUserResponse(tracker, message);
    expect(tracker.getContext().implementRuntime).toEqual({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      fastMode: false,
    });
    expect(tracker.getContext().implementApprovalOperationId).toBe(
      message.workflowAnswerOperationId,
    );
    expect(message.data?.payload).toEqual(payload);
    await node.processUserResponse(
      tracker,
      buildAgentMessage({
        action: WorkflowReviewAction.Approved,
        payload: codingPlanPayload,
      }),
    );
    expect(tracker.getContext().implementRuntime).toBeUndefined();
  });

  it('throws when context.taskId is missing', async () => {
    const { node } = buildNode();
    const context = buildContext({ featureSyncResolved: true });
    const tracker: MutableContextHandle<FeatureSyncFlowContext> =
      createMutableContextHandle(context);

    await expect(node.execute(tracker)).rejects.toThrow(
      /coding_plan requires context\.taskId/,
    );
  });

  it('throws when the task lookup returns null', async () => {
    const { node } = buildNode(null);
    const context = buildContext({
      taskId: mockTaskId as FeatureSyncFlowContext['taskId'],
    });
    const tracker: MutableContextHandle<FeatureSyncFlowContext> =
      createMutableContextHandle(context);

    await expect(node.execute(tracker)).rejects.toThrow(/could not find task/);
  });
});

describe('FeatureSyncImplementNode', () => {
  let node: FeatureSyncImplementNode;

  beforeEach(() => {
    const runtime = Object.create(
      ImplementRuntimeService.prototype,
    ) as ImplementRuntimeService;
    jest.spyOn(runtime, 'prepare').mockResolvedValue();
    node = new FeatureSyncImplementNode(runtime);
  });

  it('emits an EXTERNAL_AGENT result carrying an IMPLEMENT trigger on entry', async () => {
    const context = buildContext();
    const tracker = createMutableContextHandle(context);

    const result = await node.execute(tracker);

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.uiElements).toHaveLength(1);
    expect(result.triggersAgent).toEqual({
      promptType: LocalPromptType.implement,
      nodeId: FEATURE_SYNC_NODES.IMPLEMENT,
    });
  });

  it('declares only the DONE action schema', () => {
    expect(node.actions).toBe(featureSyncImplementActions);
    expect(Object.keys(node.actions).sort()).toEqual([
      FEATURE_SYNC_ACTIONS.DONE,
    ]);
  });

  it('declares promptType that matches the literal emitted on triggersAgent', async () => {
    expect(node.promptType).toBe(LocalPromptType.implement);
    const result = await node.execute(
      createMutableContextHandle(buildContext()),
    );
    expect(result.triggersAgent?.promptType).toBe(node.promptType);
  });

  it('validates DONE via the EXTERNAL_AGENT engine validator (no payload)', () => {
    const result = validateExternalAgentCompletion({
      nodeId: FEATURE_SYNC_NODES.IMPLEMENT,
      actions: node.actions,
      message: buildAgentMessage({ action: FEATURE_SYNC_ACTIONS.DONE }),
    });
    expect(result.action).toBe(FEATURE_SYNC_ACTIONS.DONE);
  });

  it('rejects unknown actions with ExternalAgentValidationError so the trigger stays pending', () => {
    expect(() =>
      validateExternalAgentCompletion({
        nodeId: FEATURE_SYNC_NODES.IMPLEMENT,
        actions: node.actions,
        message: buildAgentMessage({
          action: 'APPROVED' /* not on this node */,
        }),
      }),
    ).toThrow(ExternalAgentValidationError);
  });

  it('re-emits the trigger on every entry so DONE self-loops keep dispatching', async () => {
    const tracker = createMutableContextHandle(buildContext());

    const first = await node.execute(tracker);
    const second = await node.execute(tracker);
    const third = await node.execute(tracker);

    for (const entry of [first, second, third]) {
      expect(entry.triggersAgent?.promptType).toBe(LocalPromptType.implement);
      expect(entry.triggersAgent?.nodeId).toBe(FEATURE_SYNC_NODES.IMPLEMENT);
    }
  });
});
