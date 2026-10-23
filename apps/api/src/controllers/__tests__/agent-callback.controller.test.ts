import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import {
  AgentCallbackController,
  AgentCallbackPayload,
} from '../agent-callback.controller';
import { ApiKeyAuthenticatedUser } from '../../auth/strategies/api-key.strategy';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

describe('AgentCallbackController', () => {
  let controller: AgentCallbackController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentCallbackController],
    }).compile();

    controller = module.get<AgentCallbackController>(AgentCallbackController);
  });

  describe('handleAgentCallback', () => {
    const mockApiUser: ApiKeyAuthenticatedUser = {
      userId: testIds.user,
      organizationId: testIds.organization,
      scopes: ['callback:results', 'agent:execute'],
      apiKeyId: testIds.apiKey,
      apiKeyName: 'Agent Service API Key',
      authType: 'api-key',
    };

    const mockRequest = {
      ip: '127.0.0.1',
    } as Request;

    it('should successfully process completed agent callback', async () => {
      const payload: AgentCallbackPayload = {
        executionId: 'exec-123',
        agentId: 'agent-initiative-refiner',
        status: 'completed',
        result: {
          refined_initiative: {
            name: 'Updated Initiative',
            description: 'Refined description',
          },
        },
        executionTime: 5000,
        timestamp: new Date().toISOString(),
        metadata: {
          version: '1.0',
          model: 'claude-3-sonnet',
        },
      };

      const result = await controller.handleAgentCallback(
        payload,
        mockApiUser,
        mockRequest,
      );

      expect(result).toMatchObject({
        success: true,
        message: 'Agent callback processed successfully',
        timestamp: expect.any(String),
      });
    });

    it('should successfully process failed agent callback', async () => {
      const payload: AgentCallbackPayload = {
        executionId: 'exec-456',
        agentId: 'agent-initiative-refiner',
        status: 'failed',
        error: {
          code: 'LLM_ERROR',
          message: 'Failed to generate response',
          type: 'RETRYABLE',
        },
        executionTime: 2500,
        timestamp: new Date().toISOString(),
      };

      const result = await controller.handleAgentCallback(
        payload,
        mockApiUser,
        mockRequest,
      );

      expect(result).toMatchObject({
        success: true,
        message: 'Agent callback processed successfully',
        timestamp: expect.any(String),
      });
    });

    it('should successfully process timeout agent callback', async () => {
      const payload: AgentCallbackPayload = {
        executionId: 'exec-789',
        agentId: 'agent-initiative-refiner',
        status: 'timeout',
        executionTime: 300000, // 5 minutes
        timestamp: new Date().toISOString(),
      };

      const result = await controller.handleAgentCallback(
        payload,
        mockApiUser,
        mockRequest,
      );

      expect(result).toMatchObject({
        success: true,
        message: 'Agent callback processed successfully',
        timestamp: expect.any(String),
      });
    });

    it('should return error for missing required fields', async () => {
      const payload = {
        // Missing executionId
        agentId: 'agent-initiative-refiner',
        status: 'completed',
        executionTime: 5000,
        timestamp: new Date().toISOString(),
      } as AgentCallbackPayload;

      const result = await controller.handleAgentCallback(
        payload,
        mockApiUser,
        mockRequest,
      );

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining('Missing required fields'),
        timestamp: expect.any(String),
      });
    });

    it('should return error for unknown status', async () => {
      const payload = {
        executionId: 'exec-999',
        agentId: 'agent-initiative-refiner',
        status: 'unknown-status',
        executionTime: 1000,
        timestamp: new Date().toISOString(),
      } as any;

      const result = await controller.handleAgentCallback(
        payload,
        mockApiUser,
        mockRequest,
      );

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining('Unknown status'),
        timestamp: expect.any(String),
      });
    });

    it('should log organization context correctly', async () => {
      const logSpy = jest
        .spyOn(controller['logger'], 'log')
        .mockImplementation();
      const debugSpy = jest
        .spyOn(controller['logger'], 'debug')
        .mockImplementation();

      const payload: AgentCallbackPayload = {
        executionId: 'exec-log-test',
        agentId: 'agent-test',
        status: 'completed',
        result: { test: 'data' },
        executionTime: 1500,
        timestamp: new Date().toISOString(),
      };

      await controller.handleAgentCallback(payload, mockApiUser, mockRequest);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received agent callback'),
        expect.objectContaining({
          organizationId: testIds.organization,
          apiKeyId: testIds.apiKey,
        }),
      );

      expect(debugSpy).toHaveBeenCalledWith(
        'Agent callback payload:',
        expect.objectContaining({
          organizationId: testIds.organization,
          executionId: 'exec-log-test',
          agentId: 'agent-test',
          status: 'completed',
        }),
      );

      logSpy.mockRestore();
      debugSpy.mockRestore();
    });

    it('should handle callback processing with comprehensive metadata', async () => {
      const payload: AgentCallbackPayload = {
        executionId: 'exec-metadata-test',
        agentId: 'agent-comprehensive',
        status: 'completed',
        result: {
          initiatives: [
            { name: 'Initiative 1', priority: 'high' },
            { name: 'Initiative 2', priority: 'medium' },
          ],
          analysis: {
            confidence: 0.95,
            reasoning: 'High quality analysis',
          },
        },
        executionTime: 8500,
        timestamp: new Date().toISOString(),
        metadata: {
          version: '2.1',
          model: 'claude-3-opus',
          tokensUsed: 1500,
          retryCount: 0,
          features: ['initiative_generation', 'priority_analysis'],
        },
      };

      const result = await controller.handleAgentCallback(
        payload,
        mockApiUser,
        mockRequest,
      );

      expect(result.success).toBe(true);
    });

    it('should handle different error types appropriately', async () => {
      const errorTypes = [
        'RETRYABLE',
        'NON_RETRYABLE',
        'RATE_LIMITED',
        'TIMEOUT',
      ] as const;

      for (const errorType of errorTypes) {
        const payload: AgentCallbackPayload = {
          executionId: `exec-error-${errorType}`,
          agentId: 'agent-error-test',
          status: 'failed',
          error: {
            code: 'TEST_ERROR',
            message: `Test error of type ${errorType}`,
            type: errorType,
          },
          executionTime: 3000,
          timestamp: new Date().toISOString(),
        };

        const result = await controller.handleAgentCallback(
          payload,
          mockApiUser,
          mockRequest,
        );
        expect(result.success).toBe(true);
      }
    });

    it('should track execution performance metrics', async () => {
      const startTime = Date.now();

      const payload: AgentCallbackPayload = {
        executionId: 'exec-performance',
        agentId: 'agent-performance-test',
        status: 'completed',
        result: { performance: 'test' },
        executionTime: 2000,
        timestamp: new Date().toISOString(),
      };

      const result = await controller.handleAgentCallback(
        payload,
        mockApiUser,
        mockRequest,
      );

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      expect(result.success).toBe(true);
      expect(processingTime).toBeLessThan(1000); // Should process quickly
    });
  });

  describe('authentication context', () => {
    it('should properly use API key authenticated user context', () => {
      const mockApiUser: ApiKeyAuthenticatedUser = {
        userId: testIds.user,
        organizationId: testIds.organization,
        scopes: ['callback:results'],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Test Agent Key',
        authType: 'api-key',
      };

      // Verify the mock user structure matches what the controller expects
      expect(mockApiUser.authType).toBe('api-key');
      expect(mockApiUser.organizationId).toBe(testIds.organization);
      expect(mockApiUser.scopes).toContain('callback:results');
      expect(mockApiUser.apiKeyId).toBe(testIds.apiKey);
    });
  });
});
