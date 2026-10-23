import { NodeExecutionService } from '../node-execution.service';
import { NodeRegistry } from 'src/flows/nodes/node-registry.service';
import { FlowSecurityService } from '../flow-security.service';
import { IntentDetectorService } from 'src/services/intent-detector.service';
import { MessageService } from 'src/services/message.service';
import { IJobEnqueuer } from 'src/services/interfaces/job-enqueuer.interface';
import { INestApplicationContext } from '@nestjs/common';
import { FlowContext, NodeType } from 'src/types/flow-internal.types';
import { testIds } from 'src/utils/testUtils';

describe('NodeExecutionService - startNonInteractiveFlowNode', () => {
  const mockNode = {
    id: 'test-node',
    type: NodeType.ANALYZE,
    promptConfig: {
      systemPromptTemplate: 'system',
      responseSchema: {},
    },
  };

  const baseContext: FlowContext = {
    core: {
      workflowId: testIds.workflow,
      projectId: testIds.project,
      organizationId: testIds.organization,
      conversationId: testIds.conversation,
      workflowAboutId: 'about-1',
      workflowAboutType: 'project',
      user: { id: testIds.user, role: 'system' },
      session: { startTime: new Date(), interactionCount: 0 },
    },
    flowId: 'flow-1',
    flowPath: { pathTaken: [] },
  };

  let service: NodeExecutionService;
  let jobEnqueuer: jest.Mocked<IJobEnqueuer>;
  let nodeRegistry: jest.Mocked<NodeRegistry>;

  beforeEach(() => {
    jobEnqueuer = {
      queueNonInteractiveFlowNodeExecution: jest.fn().mockResolvedValue({
        id: 'job-123',
      } as any),
    } as unknown as jest.Mocked<IJobEnqueuer>;

    nodeRegistry = {
      get: jest.fn().mockReturnValue(mockNode as any),
      has: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<NodeRegistry>;

    service = new NodeExecutionService(
      {} as unknown as IntentDetectorService,
      {} as unknown as FlowSecurityService,
      {} as unknown as MessageService,
      jobEnqueuer,
      {} as unknown as INestApplicationContext,
      nodeRegistry,
      {} as any,
      {} as any,
    );

    service.registerFlow({
      id: 'flow-1',
      version: 1,
      nodes: {
        'test-node': { transitions: {} },
      },
    } as any);
  });

  it('enqueues non-interactive job without creating messages', async () => {
    const result = await service.startNonInteractiveFlowNode({
      flowId: 'flow-1',
      nodeId: 'test-node',
      context: baseContext,
      organizationId: testIds.organization,
      projectId: testIds.project,
      workflowId: testIds.workflow,
      requestId: testIds.request,
      conversationId: testIds.conversation,
      userId: testIds.user,
    });

    expect(
      jobEnqueuer.queueNonInteractiveFlowNodeExecution,
    ).toHaveBeenCalledWith(
      {
        flowId: 'flow-1',
        nodeId: 'test-node',
        context: baseContext,
      },
      expect.objectContaining({
        organizationId: testIds.organization,
        projectId: testIds.project,
        workflowId: testIds.workflow,
        requestId: testIds.request,
        conversationId: testIds.conversation,
        userId: testIds.user,
      }),
    );

    expect(result.job.id).toBe('job-123');
  });
});
