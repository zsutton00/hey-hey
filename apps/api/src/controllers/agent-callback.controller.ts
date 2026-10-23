import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ApiKeyGuard, RequireScopes } from '../auth/guards/api-key.guard';
import { CurrentApiKeyUser } from '../auth/decorators/current-api-user.decorator';
import { ApiKeyAuthenticatedUser } from '../auth/strategies/api-key.strategy';

// Agent callback data interfaces
export interface AgentCallbackPayload {
  executionId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'timeout';
  result?: unknown;
  error?: {
    code: string;
    message: string;
    type: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED' | 'TIMEOUT';
  };
  executionTime: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCallbackResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

@ApiTags('agent-callbacks')
@Controller('api/callbacks/agents')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth('api-key')
export class AgentCallbackController {
  private readonly logger = new Logger(AgentCallbackController.name);

  @Post()
  @RequireScopes(['callback:results'])
  @ApiOperation({
    summary: 'Receive agent execution results',
    description:
      'Endpoint for agent service to post execution results and status updates',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Callback processed successfully',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid or missing API key',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions - callback:results scope required',
  })
  async handleAgentCallback(
    @Body() payload: AgentCallbackPayload,
    @CurrentApiKeyUser() apiUser: ApiKeyAuthenticatedUser,
    @Req() request: Request,
  ): Promise<AgentCallbackResponse> {
    const startTime = Date.now();

    this.logger.log(
      `Received agent callback from ${apiUser.apiKeyName} (org: ${apiUser.organizationId})`,
      {
        executionId: payload.executionId,
        agentId: payload.agentId,
        status: payload.status,
        organizationId: apiUser.organizationId,
        apiKeyId: apiUser.apiKeyId,
        clientIp: request.ip,
      },
    );

    try {
      // STUB: Log the callback data for now
      this.logger.debug('Agent callback payload:', {
        executionId: payload.executionId,
        agentId: payload.agentId,
        status: payload.status,
        hasResult: !!payload.result,
        hasError: !!payload.error,
        executionTime: payload.executionTime,
        timestamp: payload.timestamp,
        organizationId: apiUser.organizationId,
      });

      // STUB: Validate required fields
      if (!payload.executionId || !payload.agentId || !payload.status) {
        throw new Error(
          'Missing required fields: executionId, agentId, or status',
        );
      }

      // STUB: Process based on status
      switch (payload.status) {
        case 'completed':
          this.logger.log(
            `Agent ${payload.agentId} completed successfully (execution: ${payload.executionId})`,
            { organizationId: apiUser.organizationId },
          );
          // TODO: Process successful result
          // - Update workflow state
          // - Store results in database
          // - Trigger next workflow steps
          // - Send notifications if needed
          break;

        case 'failed':
          this.logger.error(
            `Agent ${payload.agentId} failed (execution: ${payload.executionId})`,
            {
              error: payload.error,
              organizationId: apiUser.organizationId,
            },
          );
          // TODO: Handle failure
          // - Log error details
          // - Update workflow state to failed
          // - Determine if retry is appropriate
          // - Send error notifications
          break;

        case 'timeout':
          this.logger.warn(
            `Agent ${payload.agentId} timed out (execution: ${payload.executionId})`,
            { organizationId: apiUser.organizationId },
          );
          // TODO: Handle timeout
          // - Mark execution as timed out
          // - Decide on retry strategy
          // - Clean up resources if needed
          break;

        default:
          throw new Error(`Unknown status: ${payload.status}`);
      }

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `Successfully processed agent callback in ${processingTime}ms`,
        {
          executionId: payload.executionId,
          organizationId: apiUser.organizationId,
        },
      );

      return {
        success: true,
        message: 'Agent callback processed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to process agent callback after ${processingTime}ms: ${errorMessage}`,
        {
          executionId: payload.executionId,
          organizationId: apiUser.organizationId,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        },
      );

      // Return error response but don't throw - we want to return 200 with error details
      // This prevents the agent service from retrying non-retryable errors
      return {
        success: false,
        message: `Callback processing failed: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
