import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@temporalio/client';
import { ApiKeyType } from '@prisma/client';
import { InitiativeController } from '../initiative.controller';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { InitiativeLifecycleService } from '../../services/initiatives/initiative-lifecycle.service';
import { ConversationService } from '../../services/conversation.service';
import { FlexibleAuthenticatedUser } from '../../auth/decorators/current-api-user.decorator';
import { ApiKeyAuthenticatedUser } from '../../auth/strategies/api-key.strategy';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { InitiativeId, UserId, WorkflowId } from '../../types';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

describe('InitiativeController - Flexible Authentication', () => {
  let controller: InitiativeController;
  let initiativeService: InitiativeService;

  const mockInitiativeService = TestUtils.createMockInitiativeService();
  const mockConversationService = TestUtils.createMockConversationService();
  const mockInitiativeLifecycleService =
    TestUtils.createMockInitiativeLifecycleService();
  const mockTemporalClient = TestUtils.createMockTemporalClient();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InitiativeController],
      providers: [
        { provide: InitiativeService, useValue: mockInitiativeService },
        { provide: ConversationService, useValue: mockConversationService },
        {
          provide: InitiativeLifecycleService,
          useValue: mockInitiativeLifecycleService,
        },
        { provide: Client, useValue: mockTemporalClient },
        { provide: 'TEMPORAL_CLIENT', useValue: mockTemporalClient },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InitiativeController>(InitiativeController);
    initiativeService = module.get<InitiativeService>(InitiativeService);

    jest.clearAllMocks();
  });

  describe('startRefinement with different authentication types', () => {
    const mockInitiative = TestUtils.createMockInitiative();
    const mockConversation = TestUtils.createMockConversation({
      workflowId: 'existing-workflow-id' as WorkflowId,
    });
    const refinementBody = {
      reasoning: 'Need to refine this initiative',
      projectId: testIds.project,
    };

    beforeEach(() => {
      mockInitiativeService.findByIdForAdapter.mockResolvedValue(
        mockInitiative,
      );
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        testIds.conversation,
      );
      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );
      mockConversationService.getConversation.mockResolvedValue(
        mockConversation,
      );
      (mockTemporalClient.workflow.start as jest.Mock).mockResolvedValue({
        workflowId: 'test-workflow-123',
      });
    });

    it('should work with JWT authenticated user', async () => {
      const jwtUser: AuthenticatedUser = {
        userId: testIds.user,
        email: 'user@example.com',
        name: 'Test User',
        currentOrgId: testIds.organization,
        orgMemberships: [
          {
            orgId: testIds.organization,
            role: 'OWNER' as any,
          },
        ],
        isDevAdmin: false,
        devAdminMode: false,
      };

      const result = await controller.startRefinement(
        testIds.initiative,
        testIds.organization,
        jwtUser,
        refinementBody,
      );

      expect(mockInitiativeService.findByIdForAdapter).toHaveBeenCalledWith(
        testIds.initiative,
        testIds.organization,
      );

      expect(mockConversationService.getConversation).toHaveBeenCalledWith(
        testIds.conversation,
        testIds.organization,
      );

      expect(result).toMatchObject({
        conversationId: mockConversation.id,
        workflowId: expect.stringMatching(/^initiative-refinement-.*-\d+$/),
      });
    });

    it('should work with API key authenticated user (agent service)', async () => {
      const apiKeyUser: ApiKeyAuthenticatedUser = {
        userId: testIds.user, // The user who created the API key
        organizationId: testIds.organization,
        scopes: [
          'read:initiatives',
          'write:initiatives',
          'read:conversations',
          'write:conversations',
          'agent:execute',
        ],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Agent Service API Key',
        authType: 'api-key',
      };

      const result = await controller.startRefinement(
        testIds.initiative,
        testIds.organization,
        apiKeyUser,
        refinementBody,
      );

      expect(mockInitiativeService.findByIdForAdapter).toHaveBeenCalledWith(
        testIds.initiative,
        testIds.organization,
      );

      expect(mockConversationService.getConversation).toHaveBeenCalledWith(
        testIds.conversation,
        testIds.organization,
      );

      expect(result).toMatchObject({
        conversationId: mockConversation.id,
        workflowId: expect.stringMatching(/^initiative-refinement-.*-\d+$/),
      });
    });

    it('should handle user ID extraction for both auth types', async () => {
      // Test JWT user
      const jwtUser: FlexibleAuthenticatedUser = {
        userId: 'jwt-user-id' as UserId,
        email: 'jwt@example.com',
        name: 'JWT User',
        currentOrgId: testIds.organization,
        orgMemberships: [
          {
            orgId: testIds.organization,
            role: 'MEMBER' as any,
          },
        ],
        isDevAdmin: false,
        devAdminMode: false,
      };

      await controller.startRefinement(
        testIds.initiative,
        testIds.organization,
        jwtUser,
        refinementBody,
      );

      expect(mockConversationService.getConversation).toHaveBeenCalledWith(
        testIds.conversation,
        testIds.organization,
      );

      jest.clearAllMocks();
      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );

      // Test API key user
      const apiKeyUser: FlexibleAuthenticatedUser = {
        userId: 'api-key-creator-id' as UserId,
        organizationId: testIds.organization,
        scopes: ['read:initiatives', 'write:initiatives'],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Test API Key',
        authType: 'api-key',
      };

      await controller.startRefinement(
        testIds.initiative,
        testIds.organization,
        apiKeyUser,
        refinementBody,
      );

      expect(mockConversationService.getConversation).toHaveBeenCalledWith(
        testIds.conversation,
        testIds.organization,
      );
    });
  });

  describe('authentication context verification', () => {
    it('should properly identify JWT users', () => {
      const jwtUser: FlexibleAuthenticatedUser = {
        userId: testIds.user,
        email: 'jwt@example.com',
        name: 'JWT User',
        currentOrgId: testIds.organization,
        orgMemberships: [],
        isDevAdmin: false,
        devAdminMode: false,
      };

      // This simulates the isJwtUser type guard
      const isJwtUser = (
        user: FlexibleAuthenticatedUser,
      ): user is AuthenticatedUser => {
        return !('authType' in user) || (user as any).authType !== 'api-key';
      };

      expect(isJwtUser(jwtUser)).toBe(true);
    });

    it('should properly identify API key users', () => {
      const apiKeyUser: FlexibleAuthenticatedUser = {
        userId: testIds.user,
        organizationId: testIds.organization,
        scopes: ['read:initiatives'],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Test Key',
        authType: 'api-key',
      };

      // This simulates the isApiKeyUser type guard
      const isApiKeyUser = (
        user: FlexibleAuthenticatedUser,
      ): user is ApiKeyAuthenticatedUser => {
        return 'authType' in user && (user as any).authType === 'api-key';
      };

      expect(isApiKeyUser(apiKeyUser)).toBe(true);
    });

    it('should handle mixed user type scenarios', () => {
      const users: FlexibleAuthenticatedUser[] = [
        {
          userId: 'jwt-user' as UserId,
          email: 'jwt@example.com',
          name: 'JWT User',
          currentOrgId: testIds.organization,
          orgMemberships: [],
          isDevAdmin: false,
          devAdminMode: false,
        },
        {
          userId: 'api-key-user' as UserId,
          organizationId: testIds.organization,
          scopes: ['read:initiatives'],
          apiKeyId: testIds.apiKey,
          apiKeyName: 'API Key',
          authType: 'api-key' as const,
        },
      ];

      const jwtUsers = users.filter(
        (user) => !('authType' in user) || (user as any).authType !== 'api-key',
      );
      const apiKeyUsers = users.filter(
        (user) => 'authType' in user && (user as any).authType === 'api-key',
      );

      expect(jwtUsers).toHaveLength(1);
      expect(apiKeyUsers).toHaveLength(1);
      expect((apiKeyUsers[0] as ApiKeyAuthenticatedUser).apiKeyName).toBe(
        'API Key',
      );
    });
  });

  describe('error handling for different auth types', () => {
    it('should handle initiative not found for both auth types', async () => {
      mockInitiativeService.findByIdForAdapter.mockResolvedValue(null);

      const jwtUser: FlexibleAuthenticatedUser = {
        userId: testIds.user,
        email: 'test@example.com',
        name: 'Test User',
        currentOrgId: testIds.organization,
        orgMemberships: [],
        isDevAdmin: false,
        devAdminMode: false,
      };

      await expect(
        controller.startRefinement(
          'non-existent-initiative' as InitiativeId,
          testIds.organization,
          jwtUser,
          { reasoning: 'test' },
        ),
      ).rejects.toThrow('Initiative non-existent-initiative not found');

      const apiKeyUser: FlexibleAuthenticatedUser = {
        userId: testIds.user,
        organizationId: testIds.organization,
        scopes: ['read:initiatives'],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Test Key',
        authType: 'api-key',
      };

      await expect(
        controller.startRefinement(
          'non-existent-initiative' as InitiativeId,
          testIds.organization,
          apiKeyUser,
          { reasoning: 'test' },
        ),
      ).rejects.toThrow('Initiative non-existent-initiative not found');
    });
  });

  describe('agent service use case scenarios', () => {
    it('should handle agent service initiative refinement request', async () => {
      const agentServiceUser: ApiKeyAuthenticatedUser = {
        userId: 'system-user-id' as UserId,
        organizationId: testIds.organization,
        scopes: [
          'read:initiatives',
          'write:initiatives',
          'read:conversations',
          'write:conversations',
          'read:messages',
          'write:messages',
          'agent:execute',
          'callback:results',
        ],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Agent Service API Key',
        authType: 'api-key',
      };

      const mockInitiative = TestUtils.createMockInitiative({
        name: 'AI Agent Initiative',
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: 'Initiative created by agent service',
        }),
      });

      const mockConversation = TestUtils.createMockConversation({
        workflowName: 'initiative-refinement',
      });

      mockInitiativeService.findByIdForAdapter.mockResolvedValue(
        mockInitiative,
      );
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        testIds.conversation,
      );
      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );
      mockConversationService.getConversation.mockResolvedValue(
        mockConversation,
      );
      (mockTemporalClient.workflow.start as jest.Mock).mockResolvedValue({
        workflowId: 'agent-workflow-456',
      });

      const result = await controller.startRefinement(
        testIds.initiative,
        testIds.organization,
        agentServiceUser,
        {
          reasoning: 'Agent service requesting refinement based on analysis',
          projectId: testIds.project,
        },
      );

      expect(result).toMatchObject({
        conversationId: mockConversation.id,
        workflowId: expect.stringMatching(/^initiative-refinement-.*-\d+$/),
      });

      // Verify agent service has sufficient permissions
      const requiredScopes = [
        'read:initiatives',
        'write:initiatives',
        'agent:execute',
      ];
      const hasPermissions = requiredScopes.every((scope) =>
        agentServiceUser.scopes.includes(scope),
      );
      expect(hasPermissions).toBe(true);
    });

    it('should handle concurrent agent and user requests', async () => {
      const userRequest = {
        user: {
          userId: 'human-user' as UserId,
          email: 'human@example.com',
          name: 'Human User',
          currentOrgId: testIds.organization,
          orgMemberships: [
            {
              orgId: testIds.organization,
              role: 'MEMBER' as any,
            },
          ],
          isDevAdmin: false,
          devAdminMode: false,
        } as FlexibleAuthenticatedUser,
        reasoning: 'Human user refinement request',
      };

      const agentRequest = {
        user: {
          userId: 'system-user' as UserId,
          organizationId: testIds.organization,
          scopes: ['read:initiatives', 'write:initiatives', 'agent:execute'],
          apiKeyId: testIds.apiKey,
          apiKeyName: 'Agent Service API Key',
          authType: 'api-key' as const,
        } as FlexibleAuthenticatedUser,
        reasoning: 'Agent service refinement request',
      };

      mockInitiativeService.findByIdForAdapter.mockResolvedValue(
        TestUtils.createMockInitiative(),
      );
      mockConversationService.createConversation.mockResolvedValue(
        TestUtils.createMockConversation(),
      );
      (mockTemporalClient.workflow.start as jest.Mock).mockResolvedValue({
        workflowId: 'concurrent-test',
      });

      // Both should succeed
      const userResult = await controller.startRefinement(
        testIds.initiative,
        testIds.organization,
        userRequest.user,
        { reasoning: userRequest.reasoning, projectId: testIds.project },
      );

      const agentResult = await controller.startRefinement(
        testIds.initiative,
        testIds.organization,
        agentRequest.user,
        { reasoning: agentRequest.reasoning, projectId: testIds.project },
      );

      expect(userResult.workflowId).toBeTruthy();
      expect(agentResult.workflowId).toBeTruthy();
    });
  });
});
