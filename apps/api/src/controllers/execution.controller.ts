import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentOrganization } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { WorkflowExecutionDto } from '../generated';
import {
  ExecutionResultDto,
  WorkflowExecutionService,
} from '../services/workflows/workflow-execution.service';
import { OrganizationId } from '../types';

class ExecutionResultResponseDto {
  executionId!: string;
  status!: 'STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  version!: number;
  ready!: boolean;
  completedAt?: string | null;
  result?: Record<string, unknown>;
  error?: {
    code?: string | null;
    message?: string | null;
  };
}

@ApiTags('Executions')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/executions')
export class ExecutionController {
  constructor(
    private readonly workflowExecutionService: WorkflowExecutionService,
  ) {}

  @Get(':executionId')
  @ApiOperation({ summary: 'Get execution status by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'executionId', description: 'Execution ID' })
  @ApiResponse({
    status: 200,
    description: 'Execution status retrieved successfully',
  })
  async getExecution(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('executionId') executionId: string,
  ): Promise<WorkflowExecutionDto> {
    return this.workflowExecutionService.getExecutionById(
      organizationId,
      executionId,
    );
  }

  @Get(':executionId/result')
  @ApiOperation({ summary: 'Get execution result by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'executionId', description: 'Execution ID' })
  @ApiResponse({
    status: 200,
    description: 'Execution result retrieved successfully',
    type: ExecutionResultResponseDto,
  })
  async getExecutionResult(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('executionId') executionId: string,
  ): Promise<ExecutionResultDto> {
    return this.workflowExecutionService.getExecutionResultById(
      organizationId,
      executionId,
    );
  }

  @Get(':executionId/wait')
  @ApiOperation({ summary: 'Wait for execution state/version changes' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'executionId', description: 'Execution ID' })
  @ApiQuery({
    name: 'timeoutMs',
    required: false,
    type: Number,
    description:
      'Maximum wait duration in milliseconds (0 returns immediately)',
  })
  @ApiQuery({
    name: 'sinceVersion',
    required: false,
    type: Number,
    description:
      'Only return when execution version exceeds this value, unless terminal',
  })
  @ApiResponse({
    status: 200,
    description: 'Execution status returned after change or timeout',
  })
  async waitForExecution(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('executionId') executionId: string,
    @Query('timeoutMs') timeoutMs?: string,
    @Query('sinceVersion') sinceVersion?: string,
  ): Promise<WorkflowExecutionDto> {
    const parsedTimeoutMs = this.parseOptionalNonNegativeInteger(
      timeoutMs,
      'timeoutMs',
    );
    const parsedSinceVersion = this.parseOptionalNonNegativeInteger(
      sinceVersion,
      'sinceVersion',
    );

    return this.workflowExecutionService.waitForExecutionUpdate(
      organizationId,
      executionId,
      {
        ...(parsedTimeoutMs !== undefined
          ? { timeoutMs: parsedTimeoutMs }
          : {}),
        ...(parsedSinceVersion !== undefined
          ? { sinceVersion: parsedSinceVersion }
          : {}),
      },
    );
  }

  private parseOptionalNonNegativeInteger(
    value: string | undefined,
    fieldName: string,
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        `${fieldName} must be a non-negative integer`,
      );
    }

    return parsed;
  }
}
