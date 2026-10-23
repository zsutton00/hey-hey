import { taskGenerationFlow } from '../task-generation.flow';
import { TaskService } from '../../../services/tasks/task.service';
import { DesignDocService } from '../../../services/design-doc/design-doc.service';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowId,
} from '../../../types';
import { FlowContext } from '../../../types/flow-internal.types';

describe('taskGenerationFlow.initialContextTransform', () => {
  const designDocId = 'design-doc-123' as DesignDocId;
  const organizationId = 'org-123' as OrganizationId;
  const taskId = 'task-123' as TaskId;
  const initiativeId = 'initiative-123' as InitiativeId;

  let baseContext: FlowContext;
  let mockTaskService: jest.Mocked<TaskService>;
  let mockDesignDocService: jest.Mocked<DesignDocService>;
  let mockAppContext: { get: jest.Mock };

  beforeEach(() => {
    baseContext = {
      core: {
        workflowId: 'workflow-123' as WorkflowId,
        projectId: 'project-123' as ProjectId,
        organizationId,
        conversationId: 'conversation-123' as ConversationId,
        workflowAboutId: designDocId,
        workflowAboutType: 'design-doc',
        user: { id: 'user-123' as UserId, role: 'member' },
        session: { startTime: new Date(), interactionCount: 0 },
      },
      flowId: 'task-generation',
      flowPath: { pathTaken: [] },
    } as FlowContext;

    mockTaskService = {
      findOneForAdapter: jest.fn(),
    } as unknown as jest.Mocked<TaskService>;

    mockDesignDocService = {
      getLinks: jest.fn(),
    } as unknown as jest.Mocked<DesignDocService>;

    mockAppContext = {
      get: jest.fn((service) => {
        if (service === TaskService) {
          return mockTaskService;
        }
        if (service === DesignDocService) {
          return mockDesignDocService;
        }
        throw new Error(`Unexpected service requested: ${String(service)}`);
      }),
    };
  });

  it('derives initiative from linked tasks when no direct initiative link exists', async () => {
    const linkTimestamp = new Date('2024-01-01T00:00:00Z');

    mockDesignDocService.getLinks.mockResolvedValue([
      {
        id: 'link-1' as any,
        designDocId,
        organizationId,
        entityType: 'task',
        entityId: taskId,
        linkType: null,
        createdAt: linkTimestamp.toISOString(),
        updatedAt: linkTimestamp.toISOString(),
      },
    ]);

    mockTaskService.findOneForAdapter.mockResolvedValue({
      id: taskId,
      initiativeId,
    } as any);

    if (!taskGenerationFlow.initialContextTransform) {
      throw new Error('Expected initialContextTransform');
    }
    const result = await taskGenerationFlow.initialContextTransform(
      baseContext,
      designDocId,
      'design-doc',
      mockAppContext as any,
    );

    expect(result.initiativeId).toBe(initiativeId);
    expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
      taskId,
      organizationId,
    );
  });

  it('uses the first linked task when multiple tasks are present', async () => {
    mockDesignDocService.getLinks.mockResolvedValue([
      {
        id: 'link-1' as any,
        designDocId,
        organizationId,
        entityType: 'task',
        entityId: taskId,
        linkType: null,
        createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
        updatedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
      },
      {
        id: 'link-2' as any,
        designDocId,
        organizationId,
        entityType: 'task',
        entityId: 'task-456' as TaskId,
        linkType: null,
        createdAt: new Date('2024-01-02T00:00:00Z').toISOString(),
        updatedAt: new Date('2024-01-02T00:00:00Z').toISOString(),
      },
    ]);

    mockTaskService.findOneForAdapter
      .mockResolvedValueOnce({
        id: taskId,
        initiativeId,
      } as any)
      .mockResolvedValueOnce({
        id: 'task-456',
        initiativeId: 'initiative-456' as InitiativeId,
      } as any);

    if (!taskGenerationFlow.initialContextTransform) {
      throw new Error('Expected initialContextTransform');
    }
    const result = await taskGenerationFlow.initialContextTransform(
      baseContext,
      designDocId,
      'design-doc',
      mockAppContext as any,
    );

    expect(result.initiativeId).toBe(initiativeId);
  });
});
