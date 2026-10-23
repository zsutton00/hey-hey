import { BadRequestException } from '@nestjs/common';
import {
  TaskArtifactService,
  TaskOriginalData,
} from '../task-artifact.service';
import { ArtifactService } from '../../artifacts/artifact.service';
import { ArtifactResponseDto, ArtifactType } from '../../../generated';
import { OrganizationId, ProjectId, TaskId } from '../../../types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

// Mock the event context decorator
jest.mock('../../../core/events/observable-event.context', () => ({
  WithEventContext:
    () => (target: any, propertyName: string, descriptor: PropertyDescriptor) =>
      descriptor,
  WithWorkflowContext:
    () => (target: any, propertyName: string, descriptor: PropertyDescriptor) =>
      descriptor,
  EventContextManager: {
    getInstance: () => ({
      getCurrentContext: () => ({
        correlationId: 'test-correlation-id',
      }),
    }),
  },
}));

describe('TaskArtifactService', () => {
  let service: TaskArtifactService;
  let mockArtifactService: jest.Mocked<ArtifactService>;

  const testOrgId = 'test-org-123' as OrganizationId;
  const testProjectId = 'test-project-456' as ProjectId;
  const testTaskId = 'test-task-789' as TaskId;

  const mockTaskOriginalData: TaskOriginalData = {
    type: ArtifactType.TaskOriginal,
    taskType: 'STANDARD',
    name: 'Test Task',
    description: 'Test description',
    acceptanceCriteria: 'Test criteria',
    priority: 'high',
    estimatedEffort: 'medium',
    tags: ['test', 'task'],
    reasoning: 'Test reasoning',
  };

  const mockArtifactResponse: ArtifactResponseDto = {
    id: 'artifact-123',
    projectId: testProjectId,
    type: 'TASK_ORIGINAL',
    title: 'Original Task: Test Task',
    data: {
      type: ArtifactType.TaskOriginal,
      taskType: mockTaskOriginalData.taskType,
      name: mockTaskOriginalData.name,
      description: mockTaskOriginalData.description,
      acceptanceCriteria: mockTaskOriginalData.acceptanceCriteria,
      priority: mockTaskOriginalData.priority,
      estimatedEffort: mockTaskOriginalData.estimatedEffort,
      tags: mockTaskOriginalData.tags,
      reasoning: mockTaskOriginalData.reasoning,
    } as TaskOriginalData,
    hasEmbedding: false,
    tags: [`task-${testTaskId}`, 'original-generation', 'task-artifact'],
    category: 'task-generation',
    priority: 'MEDIUM',
    status: 'ACTIVE',
    isPublic: false,
    sourceType: 'TASK',
    sourceId: testTaskId,
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockArtifactService = {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      bulkUpdate: jest.fn(),
    } as unknown as jest.Mocked<ArtifactService>;

    const setup = await createServiceTestingModule({
      providers: [TaskArtifactService, ArtifactService],
      overrides: [[ArtifactService, mockArtifactService]],
    });

    service = setup.module.get<TaskArtifactService>(TaskArtifactService);
  });

  describe('storeOriginalGeneration', () => {
    it('should store original task data successfully', async () => {
      // Arrange
      const tasks = [mockTaskOriginalData];
      const realTasks = [{ id: testTaskId }];
      const generationContext = {
        sourceId: 'source-123',
        generationModel: 'test-model',
        generationPrompt: 'task-generation',
        originalRequestContext: { test: 'context' },
      };

      mockArtifactService.create.mockResolvedValue(mockArtifactResponse);

      // Act
      const result = await service.storeOriginalGeneration(
        tasks,
        realTasks,
        testOrgId,
        testProjectId,
        generationContext,
      );

      // Assert
      expect(result).toEqual([mockArtifactResponse]);
      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: testProjectId,
          organizationId: testOrgId,
          type: 'TASK_ORIGINAL',
          title: 'Original Task: Test Task',
          tags: [`task-${testTaskId}`, 'original-generation', 'task-artifact'],
          category: 'task-generation',
          priority: 'MEDIUM',
          data: expect.objectContaining({
            type: 'TASK_ORIGINAL',
            name: 'Test Task',
            description: 'Test description',
          }),
          status: 'ACTIVE',
          isPublic: false,
          generateEmbedding: false,
          sourceType: 'TASK',
          sourceId: testTaskId,
        }),
        { nodeId: 'N/A' },
      );
    });

    it('should throw when projectId is missing', async () => {
      // Arrange
      const tasks = [mockTaskOriginalData];
      const realTasks = [{ id: testTaskId }];

      // Act & Assert
      await expect(
        service.storeOriginalGeneration(tasks, realTasks, testOrgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error for empty tasks array', async () => {
      // Act & Assert
      await expect(
        service.storeOriginalGeneration([], [{ id: testTaskId }], testOrgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error for empty real tasks array', async () => {
      // Act & Assert
      await expect(
        service.storeOriginalGeneration([mockTaskOriginalData], [], testOrgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error for missing organization ID', async () => {
      // Act & Assert
      await expect(
        service.storeOriginalGeneration(
          [mockTaskOriginalData],
          [{ id: testTaskId }],
          '' as OrganizationId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error for mismatched array lengths', async () => {
      // Arrange
      const tasks = [
        mockTaskOriginalData,
        { ...mockTaskOriginalData, name: 'Task 2' },
      ];
      const realTasks = [{ id: testTaskId }];

      // Act & Assert
      await expect(
        service.storeOriginalGeneration(tasks, realTasks, testOrgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle artifact creation failure', async () => {
      // Arrange
      const tasks = [mockTaskOriginalData];
      const realTasks = [{ id: testTaskId }];

      mockArtifactService.create.mockRejectedValue(
        new Error('Artifact creation failed'),
      );

      // Act & Assert
      await expect(
        service.storeOriginalGeneration(
          tasks,
          realTasks,
          testOrgId,
          testProjectId,
        ),
      ).rejects.toThrow('Artifact creation failed');
    });

    it('should store multiple tasks successfully', async () => {
      // Arrange
      const tasks = [
        mockTaskOriginalData,
        { ...mockTaskOriginalData, name: 'Task 2' },
      ];
      const realTasks = [{ id: testTaskId }, { id: 'task-2' as TaskId }];
      const artifacts = [
        mockArtifactResponse,
        { ...mockArtifactResponse, id: 'artifact-456' },
      ];
      const [firstArtifact, secondArtifact] = artifacts;
      if (!firstArtifact || !secondArtifact) {
        throw new Error('Expected artifact responses');
      }

      mockArtifactService.create
        .mockResolvedValueOnce(firstArtifact)
        .mockResolvedValueOnce(secondArtifact);

      // Act
      const result = await service.storeOriginalGeneration(
        tasks,
        realTasks,
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(result).toEqual(artifacts);
      expect(mockArtifactService.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('getOriginalArtifactForTask', () => {
    it('should retrieve original artifact for task', async () => {
      // Arrange
      mockArtifactService.findMany.mockResolvedValue({
        data: [mockArtifactResponse],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });

      // Act
      const result = await service.getOriginalArtifactForTask(
        testTaskId,
        testOrgId,
      );

      // Assert
      expect(result).toEqual(mockArtifactResponse);
      expect(mockArtifactService.findMany).toHaveBeenCalledWith(
        {
          type: 'TASK_ORIGINAL',
          status: 'ACTIVE',
          sourceType: 'TASK',
          category: 'task-generation',
          tags: `task-${testTaskId}`,
          orderBy: 'createdAt',
          orderDirection: 'desc',
          limit: 1,
        },
        testOrgId,
      );
    });

    it('should return null when no artifact found', async () => {
      // Arrange
      mockArtifactService.findMany.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      });

      // Act
      const result = await service.getOriginalArtifactForTask(
        testTaskId,
        testOrgId,
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('error handling and logging', () => {
    it('should log debug messages during artifact retrieval', async () => {
      // Arrange
      const loggerSpy = jest.spyOn((service as any).logger, 'debug');
      mockArtifactService.findMany.mockResolvedValue({
        data: [mockArtifactResponse],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });

      // Act
      await service.getOriginalArtifactForTask(testTaskId, testOrgId);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        '[getOriginalArtifactForTask] Retrieving original artifact',
        {
          taskId: testTaskId,
          organizationId: testOrgId,
        },
      );
    });

    it('should log errors during artifact storage', async () => {
      // Arrange
      const loggerSpy = jest.spyOn((service as any).logger, 'error');
      const tasks = [mockTaskOriginalData];
      const realTasks = [{ id: testTaskId }];

      mockArtifactService.create.mockRejectedValue(new Error('Storage failed'));

      // Act & Assert
      await expect(
        service.storeOriginalGeneration(
          tasks,
          realTasks,
          testOrgId,
          testProjectId,
        ),
      ).rejects.toThrow('Storage failed');

      expect(loggerSpy).toHaveBeenCalledWith(
        '[storeOriginalGeneration] Failed to create artifact for task',
        expect.objectContaining({
          error: 'Storage failed',
          taskIndex: 0,
          taskId: testTaskId,
        }),
      );
    });

    it('should log successful operations', async () => {
      // Arrange
      const loggerSpy = jest.spyOn((service as any).logger, 'log');
      const tasks = [mockTaskOriginalData];
      const realTasks = [{ id: testTaskId }];

      mockArtifactService.create.mockResolvedValue(mockArtifactResponse);

      // Act
      await service.storeOriginalGeneration(
        tasks,
        realTasks,
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        '[storeOriginalGeneration] Successfully stored task artifacts',
        expect.objectContaining({
          artifactCount: 1,
          organizationId: testOrgId,
        }),
      );
    });
  });
});
