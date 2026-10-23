import { TestingModule } from '@nestjs/testing';
import { AdrRefinementAgentAnalysisNode } from '../agent_refiner.node';
import { createServiceTestingModule } from '../../../../../test/setup/testing-module.factory';
import * as TestUtils from '../../../../utils/testUtils';
import { DesignDocService } from '../../../../services/design-doc/design-doc.service';
import { InitiativeService } from '../../../../services/initiatives/initiative.service';
import { TaskService } from '../../../../services/tasks/task.service';
import { AdrRefinementFlowContext } from '../../../../types/flow-internal.types';
import { AdrStatus } from '../../../../generated';
import { MastraAgentResponse } from '../../../../services/agents/mastra-client.service';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { AdrAgentResponse } from '../adr-agent.schemas';

describe('AdrRefinementAgentAnalysisNode', () => {
  let module: TestingModule;
  let node: AdrRefinementAgentAnalysisNode;
  let designDocService: ReturnType<typeof TestUtils.createMockDesignDocService>;
  let initiativeService: ReturnType<
    typeof TestUtils.createMockInitiativeService
  >;
  let taskService: ReturnType<typeof TestUtils.createMockTaskService>;
  let context: AdrRefinementFlowContext;

  beforeEach(async () => {
    designDocService = TestUtils.createMockDesignDocService();
    initiativeService = TestUtils.createMockInitiativeService();
    taskService = TestUtils.createMockTaskService();

    const setup = await createServiceTestingModule({
      providers: [AdrRefinementAgentAnalysisNode],
      overrides: [
        [DesignDocService, designDocService],
        [InitiativeService, initiativeService],
        [TaskService, taskService],
      ],
    });

    module = setup.module;
    node = module.get(AdrRefinementAgentAnalysisNode);

    context = {
      ...(TestUtils.createMockFlowContext() as AdrRefinementFlowContext),
      designDocId: TestUtils.testIds.designDoc,
    };
  });

  afterEach(async () => {
    await module?.close();
  });

  function createAgentResponse(): MastraAgentResponse<AdrAgentResponse> {
    return {
      executionId: 'exec',
      status: 'completed',
      executionTime: 1000,
      result: {
        agentId: 'adr-refiner',
        confidence: 1,
        data: {
          response: 'Here are the updates.',
          ops: [],
          relatedEntities: [],
        },
      },
    };
  }

  it('promotes generating decision status to final decision after agent response', async () => {
    designDocService.findOneForAdapter.mockResolvedValue({
      status: AdrStatus.AdrGeneratingDecision,
    } as any);

    const tracker =
      createMutableContextHandle<AdrRefinementFlowContext>(context);

    await node.processAgentResponse(createAgentResponse(), tracker);

    expect(designDocService.update).toHaveBeenCalledWith(
      TestUtils.testIds.designDoc,
      { status: AdrStatus.AdrDecision },
      context.core.organizationId,
    );
  });

  it('leaves status unchanged when not in generating state', async () => {
    designDocService.findOneForAdapter.mockResolvedValue({
      status: AdrStatus.AdrDecision,
    } as any);

    const tracker =
      createMutableContextHandle<AdrRefinementFlowContext>(context);

    await node.processAgentResponse(createAgentResponse(), tracker);

    expect(designDocService.update).not.toHaveBeenCalled();
  });
});
