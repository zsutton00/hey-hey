import { featureSyncFlow } from '../feature-sync.flow';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';
import { FEATURE_SYNC_ACTIONS } from '../../nodes/feature-sync/schemas';
import { WorkflowReviewAction } from 'src/generated';
import type {
  NodeRoutingConfig,
  TransitionDefinition,
} from 'src/types/flow-internal.types';

function getNodeConfig(nodeId: string): NodeRoutingConfig {
  const config = featureSyncFlow.nodes[nodeId];
  if (!config) {
    throw new Error(`featureSyncFlow is missing node ${nodeId}`);
  }
  return config;
}

function getTransition(
  nodeId: string,
  transitionKey: string,
): TransitionDefinition {
  const node = getNodeConfig(nodeId);
  if (!node.transitions) {
    throw new Error(`Node ${nodeId} must have transitions`);
  }
  const transition = node.transitions[transitionKey];
  if (!transition) {
    throw new Error(
      `Node ${nodeId} is missing transition key "${transitionKey}"`,
    );
  }
  return transition;
}

describe('featureSyncFlow', () => {
  it('starts at the hidden opener gate', () => {
    expect(featureSyncFlow.startNode).toBe(FEATURE_SYNC_NODES.OPENER);
  });

  it('routes opener statically to analyze', () => {
    const opener = getNodeConfig(FEATURE_SYNC_NODES.OPENER);
    expect(opener.nextNode).toBe(FEATURE_SYNC_NODES.ANALYZE);
    expect(opener.transitions).toBeUndefined();
  });

  it('declares transitions for every action produced by analyze', () => {
    expect(
      getTransition(
        FEATURE_SYNC_NODES.ANALYZE,
        FEATURE_SYNC_ACTIONS.NO_DISCREPANCY,
      ).nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.CODING_PLAN);
    expect(
      getTransition(
        FEATURE_SYNC_NODES.ANALYZE,
        FEATURE_SYNC_ACTIONS.DISCREPANCY,
      ).nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.ITERATE);
    expect(
      getTransition(FEATURE_SYNC_NODES.ANALYZE, 'default').nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.CODING_PLAN);
    expect(
      getTransition(
        FEATURE_SYNC_NODES.ANALYZE,
        FEATURE_SYNC_ACTIONS.READINESS_CLEAR,
      ).nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.CODING_PLAN);
    expect(
      getTransition(
        FEATURE_SYNC_NODES.ANALYZE,
        FEATURE_SYNC_ACTIONS.READINESS_REVIEW_REQUIRED,
      ).nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW);
  });

  it('routes readiness review actions without changing structural reconciliation routes', () => {
    expect(
      getTransition(FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW, 'implementation_readiness_reply').nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.ANALYZE);
    expect(
      getTransition(FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW, 'implementation_readiness_dismiss').nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.CODING_PLAN);
  });

  it('declares transitions for every action produced by iterate', () => {
    expect(
      getTransition(FEATURE_SYNC_NODES.ITERATE, FEATURE_SYNC_ACTIONS.RESOLVED)
        .nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.ANALYZE);
    expect(
      getTransition(FEATURE_SYNC_NODES.ITERATE, FEATURE_SYNC_ACTIONS.REVISED)
        .nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.ITERATE);
  });

  it('declares transitions for every action produced by coding_plan', () => {
    const refineTransition = getTransition(
      FEATURE_SYNC_NODES.CODING_PLAN,
      WorkflowReviewAction.Refine,
    );
    expect(refineTransition.nextNodeId).toBe(FEATURE_SYNC_NODES.CODING_PLAN);
    expect(refineTransition.parkOnUserResponse).not.toBe(true);

    expect(
      getTransition(FEATURE_SYNC_NODES.CODING_PLAN, WorkflowReviewAction.Approved)
        .nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.IMPLEMENT);
  });

  it('keeps DONE parked on implementation without a readiness restart route', () => {
    expect(
      getTransition(FEATURE_SYNC_NODES.IMPLEMENT, FEATURE_SYNC_ACTIONS.DONE)
        .nextNodeId,
    ).toBe(FEATURE_SYNC_NODES.IMPLEMENT);
  });

  it('terminates at end with no outgoing routing', () => {
    const end = getNodeConfig(FEATURE_SYNC_NODES.END);
    expect(end.transitions).toBeUndefined();
    expect(end.nextNode).toBeUndefined();
  });

  describe('initialContextTransform', () => {
    const base = {
      core: { organizationId: 'org-1' },
      flowPath: { pathTaken: [] },
    } as any;

    function makeAppContext(
      session: { entityType?: string; entityId?: string } | Error,
    ) {
      const findOne =
        session instanceof Error
          ? jest.fn().mockRejectedValue(session)
          : jest.fn().mockResolvedValue(session);
      return {
        get: jest.fn().mockReturnValue({ findOne }),
        __findOne: findOne,
      };
    }

    it('hydrates context.taskId from the agent session', async () => {
      if (!featureSyncFlow.initialContextTransform) {
        throw new Error('Expected initialContextTransform');
      }
      const appContext = makeAppContext({
        entityType: 'TASK',
        entityId: 'task-123',
      });
      const result = await featureSyncFlow.initialContextTransform(
        base,
        'session-1',
        'agent-session',
        appContext as any,
      );
      expect(result).toEqual({ ...base, taskId: 'task-123' });
      expect((appContext as any).__findOne).toHaveBeenCalledWith(
        'org-1',
        'session-1',
      );
    });

    it('throws when workflowAboutId is missing', async () => {
      if (!featureSyncFlow.initialContextTransform) {
        throw new Error('Expected initialContextTransform');
      }
      await expect(
        featureSyncFlow.initialContextTransform(
          base,
          undefined,
          'agent-session',
          makeAppContext({
            entityType: 'TASK',
            entityId: 'task-123',
          }) as any,
        ),
      ).rejects.toThrow(/requires workflowAboutId/);
    });

    it('throws when workflowAboutType is not agent-session', async () => {
      if (!featureSyncFlow.initialContextTransform) {
        throw new Error('Expected initialContextTransform');
      }
      await expect(
        featureSyncFlow.initialContextTransform(
          base,
          'session-1',
          'task',
          makeAppContext({
            entityType: 'TASK',
            entityId: 'task-123',
          }) as any,
        ),
      ).rejects.toThrow(/requires workflowAboutType="agent-session"/);
    });

    it('throws when the agent session is not about a TASK entity', async () => {
      if (!featureSyncFlow.initialContextTransform) {
        throw new Error('Expected initialContextTransform');
      }
      await expect(
        featureSyncFlow.initialContextTransform(
          base,
          'session-1',
          'agent-session',
          makeAppContext({}) as any,
        ),
      ).rejects.toThrow(/to be about a TASK entity/);
    });
  });
});
