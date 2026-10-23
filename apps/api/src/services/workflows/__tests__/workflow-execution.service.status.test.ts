import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FlowExecutionStatus } from '@prisma/client';
import { WorkflowExecutionService } from '../workflow-execution.service';
import { createMockPrismaService } from '../../../utils/testUtils';

describe('WorkflowExecutionService - execution status', () => {
  const startedAt = new Date('2026-02-13T00:00:00.000Z');
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: WorkflowExecutionService;
  let flowExecutionModel: { findFirst: jest.Mock };

  const buildExecutionRecord = (
    overrides: Partial<Record<string, unknown>> = {},
  ) => ({
    id: 'exec-1',
    userId: 'user-1',
    flowId: 'coding-prompt-research',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversationId: null,
    entityType: 'task',
    entityId: 'task-1',
    status: FlowExecutionStatus.STARTED,
    startedAt,
    completedAt: null,
    metadata: null,
    flowState: null,
    resumable: true,
    errorMessage: null,
    errorCode: null,
    currentNode: null,
    totalNodes: null,
    completedNodes: 0,
    executionTimeMs: null,
    version: 1,
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    flowExecutionModel = {
      findFirst: jest.fn(),
    };
    (prisma.db as any).flowExecution = flowExecutionModel;
    service = new WorkflowExecutionService(prisma as any, {} as any, {} as any);
  });

  it('returns execution by id', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(
      buildExecutionRecord({
        status: FlowExecutionStatus.IN_PROGRESS,
        version: 3,
      }),
    );

    const result = await service.getExecutionById('org-1' as any, 'exec-1');

    expect(flowExecutionModel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'exec-1',
        organizationId: 'org-1',
      },
    });
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.version).toBe(3);
  });

  it('throws NotFound for missing execution', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(null);

    await expect(
      service.getExecutionById('org-1' as any, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('waits until version advances', async () => {
    flowExecutionModel.findFirst
      .mockResolvedValueOnce(buildExecutionRecord({ version: 1 }))
      .mockResolvedValueOnce(
        buildExecutionRecord({
          version: 2,
          status: FlowExecutionStatus.IN_PROGRESS,
        }),
      );

    const result = await service.waitForExecutionUpdate(
      'org-1' as any,
      'exec-1',
      {
        sinceVersion: 1,
        timeoutMs: 50,
        pollIntervalMs: 1,
      },
    );

    expect(result.version).toBe(2);
    expect(result.status).toBe('IN_PROGRESS');
    expect(flowExecutionModel.findFirst).toHaveBeenCalledTimes(2);
  });

  it('returns terminal status even without version change', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(
      buildExecutionRecord({
        status: FlowExecutionStatus.COMPLETED,
        completedAt: new Date('2026-02-13T00:00:10.000Z'),
        version: 1,
      }),
    );

    const result = await service.waitForExecutionUpdate(
      'org-1' as any,
      'exec-1',
      {
        sinceVersion: 1,
        timeoutMs: 50,
        pollIntervalMs: 1,
      },
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.version).toBe(1);
  });

  it('returns immediately when timeout is zero', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(
      buildExecutionRecord({ version: 1 }),
    );

    const result = await service.waitForExecutionUpdate(
      'org-1' as any,
      'exec-1',
      {
        sinceVersion: 1,
        timeoutMs: 0,
        pollIntervalMs: 1,
      },
    );

    expect(result.version).toBe(1);
    expect(flowExecutionModel.findFirst).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid sinceVersion', async () => {
    await expect(
      service.waitForExecutionUpdate('org-1' as any, 'exec-1', {
        sinceVersion: -1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns non-ready result while execution is still running', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(
      buildExecutionRecord({
        status: FlowExecutionStatus.IN_PROGRESS,
        version: 2,
      }),
    );

    const result = await service.getExecutionResultById(
      'org-1' as any,
      'exec-1',
    );

    expect(result).toEqual({
      executionId: 'exec-1',
      status: 'IN_PROGRESS',
      version: 2,
      ready: false,
      completedAt: null,
    });
  });

  it('returns completed result extracted from flow state context', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(
      buildExecutionRecord({
        status: FlowExecutionStatus.COMPLETED,
        version: 3,
        completedAt: new Date('2026-02-13T00:00:10.000Z'),
        flowState: {
          step: 'initializing',
          phase: 'initializing',
          nodeConfig: {
            id: 'coding-prompt-research-end',
            type: 'UNKNOWN',
            supportsPhases: false,
          },
          iterations: 0,
          currentNodeId: 'coding-prompt-research-end',
          lastSystemMessageId: undefined,
          lastUserMessageId: undefined,
          timestamp: '2026-02-13T00:00:10.000Z',
          version: 1,
          context: {
            core: {
              workflowId: 'exec-1',
              projectId: 'project-1',
              organizationId: 'org-1',
              conversationId: 'exec-1',
              workflowAboutType: 'task',
              workflowAboutId: 'task-1',
              user: {
                id: 'user-1',
                role: 'member',
              },
              session: {
                startTime: new Date('2026-02-13T00:00:00.000Z'),
                interactionCount: 0,
              },
            },
            flowId: 'coding-prompt-research',
            flowPath: {
              pathTaken: [],
            },
            research: {
              status: 'COMPLETED',
              result: {
                summary: 'research complete',
              },
            },
          },
        },
      }),
    );

    const result = await service.getExecutionResultById(
      'org-1' as any,
      'exec-1',
    );

    expect(result).toEqual({
      executionId: 'exec-1',
      status: 'COMPLETED',
      version: 3,
      ready: true,
      completedAt: '2026-02-13T00:00:10.000Z',
      result: {
        summary: 'research complete',
      },
    });
  });

  it('falls back to metadata result when flow state does not contain research result', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(
      buildExecutionRecord({
        status: FlowExecutionStatus.COMPLETED,
        version: 3,
        completedAt: new Date('2026-02-13T00:00:10.000Z'),
        metadata: {
          result: {
            summary: 'legacy metadata result',
          },
        },
      }),
    );

    const result = await service.getExecutionResultById(
      'org-1' as any,
      'exec-1',
    );

    expect(result.result).toEqual({
      summary: 'legacy metadata result',
    });
  });

  it('returns failed result with error details', async () => {
    flowExecutionModel.findFirst.mockResolvedValue(
      buildExecutionRecord({
        status: FlowExecutionStatus.FAILED,
        version: 4,
        completedAt: new Date('2026-02-13T00:00:15.000Z'),
        errorCode: 'RESEARCH_EXECUTION_FAILED',
        errorMessage: 'agent failure',
      }),
    );

    const result = await service.getExecutionResultById(
      'org-1' as any,
      'exec-1',
    );

    expect(result).toEqual({
      executionId: 'exec-1',
      status: 'FAILED',
      version: 4,
      ready: true,
      completedAt: '2026-02-13T00:00:15.000Z',
      error: {
        code: 'RESEARCH_EXECUTION_FAILED',
        message: 'agent failure',
      },
    });
  });
});
