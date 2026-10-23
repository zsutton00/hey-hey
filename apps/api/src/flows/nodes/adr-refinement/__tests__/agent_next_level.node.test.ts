import { TestingModule } from '@nestjs/testing';
import * as TestUtils from '../../../../utils/testUtils';
import { AdrRefinementAgentNextLevelNode } from '../agent_next_level.node';
import { DesignDocService } from '../../../../services/design-doc/design-doc.service';
import { AdrRefinementFlowContext } from '../../../../types/flow-internal.types';
import { AdrStatus } from '../../../../generated';
import { MastraAgentResponse } from '../../../../services/agents/mastra-client.service';
import { createServiceTestingModule } from '../../../../../test/setup/testing-module.factory';
import { ADR_REFINEMENT_NODES } from '../../../constants/node-ids';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { AdrAgentResponse } from '../adr-agent.schemas';

describe('AdrRefinementAgentNextLevelNode', () => {
  let module: TestingModule;
  let node: AdrRefinementAgentNextLevelNode;
  let designDocService: ReturnType<typeof TestUtils.createMockDesignDocService>;
  let context: AdrRefinementFlowContext;

  beforeEach(async () => {
    designDocService = TestUtils.createMockDesignDocService();

    const setup = await createServiceTestingModule({
      providers: [AdrRefinementAgentNextLevelNode],
      overrides: [[DesignDocService, designDocService]],
    });

    module = setup.module;
    node = module.get(AdrRefinementAgentNextLevelNode);

    context = {
      ...(TestUtils.createMockFlowContext() as AdrRefinementFlowContext),
      designDocId: TestUtils.testIds.designDoc,
    };
  });

  afterEach(async () => {
    await module?.close();
  });

  function createResponse(): MastraAgentResponse<AdrAgentResponse> {
    return {
      executionId: 'exec',
      status: 'completed',
      executionTime: 1000,
      result: {
        agentId: 'adr-refiner',
        confidence: 1,
        data: {
          ops: [
            {
              type: 'replace',
              target: 'decision',
              text: 'Generated decision content.',
            },
          ],
          relatedEntities: [],
        },
      },
    };
  }

  it('applies generated content and advances status', async () => {
    designDocService.findOneForAdapter.mockResolvedValue({
      id: TestUtils.testIds.designDoc,
      status: AdrStatus.AdrGeneratingDecision,
      name: 'ADR',
      sections: [],
    } as any);

    const tracker =
      createMutableContextHandle<AdrRefinementFlowContext>(context);
    const result = await node.processAgentResponse(createResponse(), tracker);

    expect(designDocService.applySectionUpdates).toHaveBeenCalledWith(
      TestUtils.testIds.designDoc,
      context.core.organizationId,
      [{ key: 'decision', content: 'Generated decision content.' }],
    );
    expect(designDocService.update).toHaveBeenCalledWith(
      TestUtils.testIds.designDoc,
      { status: AdrStatus.AdrDecision },
      context.core.organizationId,
    );
    expect(result.nextNodeId).toBe(ADR_REFINEMENT_NODES.AGENT_ANALYSIS);
  });

  it('retries when no ops are returned', async () => {
    designDocService.findOneForAdapter.mockResolvedValue({
      id: TestUtils.testIds.designDoc,
      status: AdrStatus.AdrGeneratingDecision,
      name: 'ADR',
      sections: [],
    } as any);

    const response = createResponse();
    response.result!.data!.ops = [];

    const tracker =
      createMutableContextHandle<AdrRefinementFlowContext>(context);
    const result = await node.processAgentResponse(response, tracker);

    expect(result.nextNodeId).toBe(ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL);
    expect(designDocService.applySectionUpdates).not.toHaveBeenCalled();
  });
});
