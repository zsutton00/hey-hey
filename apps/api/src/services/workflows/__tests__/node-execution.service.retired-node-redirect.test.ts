import { NodeExecutionService } from '../node-execution.service';
import { NodeRegistry } from 'src/flows/nodes/node-registry.service';
import { PLAN_SHAPING_NODES } from 'src/flows/constants/node-ids';
import { planFromDesignDocFlow } from 'src/flows/templates/plan-from-design-doc.flow';
import {
  FlowContext,
  FlowTemplate,
  INode,
} from 'src/types/flow-internal.types';

describe('NodeExecutionService - retired plan-shaping node redirect', () => {
  const visualPreviewNode = {
    id: PLAN_SHAPING_NODES.VISUAL_PREVIEW,
  } as unknown as INode;

  const makeService = () => {
    const registry = {
      get: jest.fn((nodeId: string) =>
        nodeId === PLAN_SHAPING_NODES.VISUAL_PREVIEW
          ? visualPreviewNode
          : undefined,
      ),
      has: jest.fn(
        (nodeId: string) => nodeId === PLAN_SHAPING_NODES.VISUAL_PREVIEW,
      ),
    } as unknown as NodeRegistry;
    const service = new NodeExecutionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
      {} as never,
      {} as never,
    );
    service.registerFlow(planFromDesignDocFlow as unknown as FlowTemplate);
    return service;
  };

  it('resumes a conversation parked at the removed fidelity-choice gate at visual preview', () => {
    const service = makeService();

    const resolved = service.getNode(
      planFromDesignDocFlow.id,
      'plan-shaping-fidelity-choice',
    );

    expect(resolved?.node).toBe(visualPreviewNode);
    expect(resolved?.routing).toBe(
      planFromDesignDocFlow.nodes[PLAN_SHAPING_NODES.VISUAL_PREVIEW],
    );
  });

  it.each([
    'plan-shaping-proposed-steps-granular',
    'plan-shaping-proposed-steps-theme',
    'plan-shaping-proposed-steps-feedback',
    'plan-shaping-journey-map',
    'plan-shaping-journey-map-feedback',
  ])('resumes a conversation parked at %s at visual preview', (nodeId) => {
    const service = makeService();

    expect(service.getNode(planFromDesignDocFlow.id, nodeId)?.node).toBe(
      visualPreviewNode,
    );
  });

  it('resolves a retired previous node to visual preview', () => {
    const service = makeService();
    const context = {
      flowPath: { previousNode: 'plan-shaping-fidelity-choice' },
    } as unknown as FlowContext;

    expect(service.getPreviousNode(context, planFromDesignDocFlow.id)).toBe(
      visualPreviewNode,
    );
  });

  it('leaves live node ids untouched', () => {
    const service = makeService();

    expect(
      service.resolveNodeId(
        planFromDesignDocFlow.id,
        PLAN_SHAPING_NODES.PROPOSED_STAGES,
      ),
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
  });
});
