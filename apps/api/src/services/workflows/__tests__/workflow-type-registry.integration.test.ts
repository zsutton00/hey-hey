import { WorkflowTypeRegistryService } from '../workflow-type-registry.service';
import { Client } from '@temporalio/client';
import { TEMPORAL_CLIENT } from '../../../prisma/temporal.module';
import { WorkflowName } from '../../../generated';
import { UnsupportedWorkflowTypeError } from '../../../core/exceptions/workflow.exceptions';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

describe('WorkflowTypeRegistryService Integration', () => {
  let service: WorkflowTypeRegistryService;
  let temporalClient: Client;

  beforeEach(async () => {
    const mockTemporalClient = {
      workflow: {
        start: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as jest.Mocked<Client>;

    const setup = await createServiceTestingModule({
      providers: [WorkflowTypeRegistryService],
      overrides: [
        [TEMPORAL_CLIENT, mockTemporalClient],
        [
          WorkflowTypeRegistryService,
          new WorkflowTypeRegistryService(mockTemporalClient as any),
        ],
      ],
    });

    service = setup.module.get<WorkflowTypeRegistryService>(
      WorkflowTypeRegistryService,
    );
    temporalClient = setup.module.get<Client>(TEMPORAL_CLIENT);
  });

  describe('isWorkflowTypeSupported', () => {
    it('should return true for supported workflow types', () => {
      expect(service.isWorkflowTypeSupported(WorkflowName.Onboarding)).toBe(
        true,
      );
      expect(service.isWorkflowTypeSupported(WorkflowName.TaskGeneration)).toBe(
        true,
      );
      expect(
        service.isWorkflowTypeSupported(WorkflowName.InitiativeRefinement),
      ).toBe(true);
      expect(service.isWorkflowTypeSupported(WorkflowName.PlanFromDesignDoc)).toBe(
        true,
      );
    });

    it('should return false for unsupported workflow types', () => {
      expect(service.isWorkflowTypeSupported('invalid-workflow')).toBe(false);
      expect(service.isWorkflowTypeSupported('coding-prompts')).toBe(false);
      expect(service.isWorkflowTypeSupported('')).toBe(false);
      expect(service.isWorkflowTypeSupported(WorkflowName.AgentSession)).toBe(
        false,
      );
      expect(
        service.isWorkflowTypeSupported(WorkflowName.FeatureTreeConversation),
      ).toBe(false);
      expect(service.isWorkflowTypeSupported(WorkflowName.TaskMonitor)).toBe(
        false,
      );
    });
  });

  describe('isNonTemporalBackedWorkflow', () => {
    it('returns true only for known non-Temporal workflows', () => {
      expect(
        service.isNonTemporalBackedWorkflow(WorkflowName.AgentSession),
      ).toBe(true);
      expect(
        service.isNonTemporalBackedWorkflow(WorkflowName.DailySession),
      ).toBe(true);
      expect(
        service.isNonTemporalBackedWorkflow(
          WorkflowName.FeatureTreeConversation,
        ),
      ).toBe(true);
      expect(service.isNonTemporalBackedWorkflow(WorkflowName.Onboarding)).toBe(
        false,
      );
      expect(
        service.isNonTemporalBackedWorkflow(WorkflowName.TaskMonitor),
      ).toBe(true);
      expect(service.isNonTemporalBackedWorkflow('invalid-workflow')).toBe(
        false,
      );
    });
  });

  describe('validateWorkflowType', () => {
    it('should return valid workflow type for supported types', () => {
      expect(service.validateWorkflowName(WorkflowName.TaskGeneration)).toBe(
        WorkflowName.TaskGeneration,
      );
      expect(service.validateWorkflowName(WorkflowName.Onboarding)).toBe(
        WorkflowName.Onboarding,
      );
      expect(
        service.validateWorkflowName(WorkflowName.InitiativeRefinement),
      ).toBe(WorkflowName.InitiativeRefinement);
      expect(service.validateWorkflowName(WorkflowName.PlanFromDesignDoc)).toBe(
        WorkflowName.PlanFromDesignDoc,
      );
      expect(service.validateWorkflowName(WorkflowName.AgentSession)).toBe(
        WorkflowName.AgentSession,
      );
    });

    it('should throw UnsupportedWorkflowTypeError for unsupported types', () => {
      expect(() => service.validateWorkflowName('invalid-workflow')).toThrow(
        UnsupportedWorkflowTypeError,
      );
      expect(() => service.validateWorkflowName('')).toThrow(
        UnsupportedWorkflowTypeError,
      );
    });
  });

  describe('getWorkflowConfig', () => {
    it('should return workflow config for supported types', () => {
      const taskGenConfig = service.getWorkflowConfig(
        WorkflowName.TaskGeneration,
      );

      expect(taskGenConfig).toBeDefined();
      expect(taskGenConfig?.flowId).toBe(WorkflowName.TaskGeneration);
      expect(taskGenConfig?.displayName).toBe('Task Generation');
      expect(taskGenConfig?.isSupported).toBe(true);
    });

    it('should return null for unsupported types', () => {
      expect(
        service.getWorkflowConfig('invalid-workflow' as WorkflowName),
      ).toBeNull();
    });

    it('should return config for known non-Temporal workflow types', () => {
      const agentSessionConfig = service.getWorkflowConfig(
        WorkflowName.AgentSession,
      );

      expect(agentSessionConfig).toBeDefined();
      expect(agentSessionConfig?.flowId).toBe(WorkflowName.AgentSession);
      expect(agentSessionConfig?.isSupported).toBe(false);
      expect(agentSessionConfig?.workflowAboutType).toBe('agent-session');
    });

    it('should return config for FeatureTreeConversation as non-Temporal project workflow', () => {
      const ftcConfig = service.getWorkflowConfig(
        WorkflowName.FeatureTreeConversation,
      );

      expect(ftcConfig).toBeDefined();
      expect(ftcConfig?.flowId).toBe(WorkflowName.FeatureTreeConversation);
      expect(ftcConfig?.isSupported).toBe(false);
      expect(ftcConfig?.workflowAboutType).toBe('project');
    });

    it('should return config for TaskMonitor as a non-Temporal agent-session workflow', () => {
      const taskMonitorConfig = service.getWorkflowConfig(
        WorkflowName.TaskMonitor,
      );

      expect(taskMonitorConfig).toBeDefined();
      expect(taskMonitorConfig?.flowId).toBe(WorkflowName.TaskMonitor);
      expect(taskMonitorConfig?.isSupported).toBe(false);
      expect(taskMonitorConfig?.workflowAboutType).toBe('agent-session');
    });
  });

  describe('getAllSupportedWorkflowTypes', () => {
    it('should return all supported workflow types', () => {
      const supportedTypes = service.getAllSupportedWorkflowTypes();

      expect(supportedTypes).toContain(WorkflowName.Onboarding);
      expect(supportedTypes).toContain(WorkflowName.TaskGeneration);
      expect(supportedTypes).toContain(WorkflowName.InitiativeRefinement);
      expect(supportedTypes).toContain(WorkflowName.PlanFromDesignDoc);
      expect(supportedTypes.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('getSupportedWorkflowConfigs', () => {
    it('should return all supported workflow configs', () => {
      const configs = service.getSupportedWorkflowConfigs();

      expect(configs.length).toBeGreaterThanOrEqual(3);
      expect(configs.every((config) => config.isSupported)).toBe(true);
      expect(configs.map((c) => c.flowId)).toEqual(
        expect.arrayContaining([
          WorkflowName.Onboarding,
          WorkflowName.TaskGeneration,
          WorkflowName.InitiativeRefinement,
          WorkflowName.PlanFromDesignDoc,
        ]),
      );
    });
  });

  describe('startWorkflowByType', () => {
    const mockConversationId = TestUtils.testIds.conversation;
    const mockProjectId = TestUtils.testIds.project;
    const mockOrganizationId = TestUtils.testIds.organization;
    const mockWorkflowId = TestUtils.testIds.workflow;
    const mockInitiativeId = TestUtils.testIds.initiative;
    const mockAgentSessionId = 'agent-session-123';

    beforeEach(() => {
      (temporalClient.workflow.start as jest.Mock).mockResolvedValue(undefined);
    });

    it('should start workflow for supported types', async () => {
      // Test task generation workflow
      const result = await service.startWorkflowByType(
        WorkflowName.TaskGeneration,
        mockConversationId,
        mockProjectId,
        mockOrganizationId,
        undefined,
        undefined,
        'initiative',
        mockInitiativeId,
      );

      expect(result.workflowId).toBeDefined();
      expect(result.conversationId).toBe(mockConversationId);
      expect(result.success).toBe(true);

      expect(temporalClient.workflow.start).toHaveBeenCalledWith(
        'conversationFlowWorkflow',
        {
          args: [
            {
              projectId: mockProjectId,
              workflowId: expect.any(String),
              organizationId: mockOrganizationId,
              flowId: 'task-generation',
              userId: 'system',
              conversationId: mockConversationId,
              initiatedBy: 'SYSTEM',
              triggerEvent: '',
              title: 'Task Generation',
              workflowName: WorkflowName.TaskGeneration,
              workflowAboutType: 'initiative',
              workflowAboutId: mockInitiativeId,
            },
          ],
          taskQueue: 'conversation-queue',
          workflowId: expect.any(String),
        },
      );
    });

    it('passes additionalContext through to workflow input', async () => {
      const additionalContext = {
        stageId: TestUtils.testIds.planStage,
      };

      await service.startWorkflowByType(
        WorkflowName.PlanFromDesignDoc,
        mockConversationId,
        mockProjectId,
        mockOrganizationId,
        undefined,
        undefined,
        'task',
        TestUtils.testIds.plan,
        mockWorkflowId,
        additionalContext,
      );

      expect(temporalClient.workflow.start).toHaveBeenCalledWith(
        'conversationFlowWorkflow',
        expect.objectContaining({
          args: [
            expect.objectContaining({
              additionalContext,
            }),
          ],
        }),
      );
    });

    it('should start different workflows for different types', async () => {
      // Test onboarding workflow
      await service.startWorkflowByType(
        WorkflowName.Onboarding,
        mockConversationId,
        mockProjectId,
        mockOrganizationId,
        undefined,
        undefined,
        'project',
        mockProjectId,
      );

      expect(temporalClient.workflow.start).toHaveBeenCalledWith(
        'conversationFlowWorkflow',
        expect.objectContaining({
          args: [
            expect.objectContaining({
              projectId: mockProjectId,
              organizationId: mockOrganizationId,
              conversationId: mockConversationId,
              flowId: 'onboarding',
              initiatedBy: 'SYSTEM',
              triggerEvent: '',
              title: 'Project Onboarding',
              workflowName: WorkflowName.Onboarding,
              workflowAboutType: 'project',
              workflowAboutId: mockProjectId,
            }),
          ],
        }),
      );

      // Test initiative refinement workflow
      await service.startWorkflowByType(
        WorkflowName.InitiativeRefinement,
        mockConversationId,
        mockProjectId,
        mockOrganizationId,
        undefined,
        undefined,
        'initiative',
        mockInitiativeId,
      );

      expect(temporalClient.workflow.start).toHaveBeenCalledWith(
        'conversationFlowWorkflow',
        expect.objectContaining({
          args: [
            expect.objectContaining({
              projectId: mockProjectId,
              organizationId: mockOrganizationId,
              conversationId: mockConversationId,
              flowId: 'initiative-refinement',
              initiatedBy: 'SYSTEM',
              triggerEvent: '',
              title: 'Initiative Refinement',
              workflowName: WorkflowName.InitiativeRefinement,
              workflowAboutType: 'initiative',
              workflowAboutId: mockInitiativeId,
            }),
          ],
        }),
      );

      await service.startWorkflowByType(
        WorkflowName.PlanFromDesignDoc,
        mockConversationId,
        mockProjectId,
        mockOrganizationId,
        undefined,
        undefined,
        'task',
        TestUtils.testIds.plan,
      );

      expect(temporalClient.workflow.start).toHaveBeenCalledWith(
        'conversationFlowWorkflow',
        expect.objectContaining({
          args: [
            expect.objectContaining({
              flowId: 'plan-from-design-doc',
              title: 'Plan from Design Doc',
              workflowName: WorkflowName.PlanFromDesignDoc,
              workflowAboutType: 'task',
              workflowAboutId: TestUtils.testIds.plan,
            }),
          ],
        }),
      );
    });

    it('should throw UnsupportedWorkflowTypeError for invalid workflow types', async () => {
      await expect(
        service.startWorkflowByType(
          'invalid-workflow' as WorkflowName,
          mockConversationId,
          mockProjectId,
          mockOrganizationId,
          undefined,
          undefined,
          'project',
          mockProjectId,
        ),
      ).rejects.toThrow(UnsupportedWorkflowTypeError);
    });

    it('should throw UnsupportedWorkflowTypeError for known non-Temporal workflows', async () => {
      await expect(
        service.startWorkflowByType(
          WorkflowName.AgentSession,
          mockConversationId,
          mockProjectId,
          mockOrganizationId,
          undefined,
          undefined,
          'agent-session',
          mockAgentSessionId,
        ),
      ).rejects.toThrow(UnsupportedWorkflowTypeError);
    });
  });
});
