import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { FlowExecutionStatus } from '@prisma/client';
import {
  WorkflowAnalyticsDto,
  WorkflowExecutionDto,
  WorkflowExecutionListDto,
  WorkflowTemplateMetricsDto,
  AvailableSkipNode,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';
import {
  FlowContext,
  FlowTemplate,
  SkipToNodeConfig,
  SkipValidationResult,
} from '../../types/flow-internal.types';
import { ConversationId, OrganizationId } from '../../types';
import { isSerializableWorkflowState } from '../../workflows/conversation-workflow-state';
import { InitiativeService } from '../initiatives/initiative.service';
import { TaskService } from '../tasks/task.service';

interface MetricsOptions {
  organizationId?: string;
  startDate?: Date;
  endDate?: Date;
}

interface AnalyticsOptions extends MetricsOptions {
  templateIds?: string[];
}

interface ExecutionListOptions extends MetricsOptions {
  templateId?: string;
  projectId?: string;
  userId?: string;
  status?: FlowExecutionStatus;
  limit: number;
  offset: number;
  sortBy: 'startedAt' | 'completedAt' | 'executionTimeMs';
  sortOrder: 'asc' | 'desc';
}

interface WaitForExecutionOptions {
  sinceVersion?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type ExecutionResultDto = {
  executionId: string;
  status: WorkflowExecutionDto['status'];
  version: number;
  ready: boolean;
  completedAt?: string | null;
  result?: Record<string, unknown>;
  error?: {
    code?: string | null;
    message?: string | null;
  };
};

type ExecutionRecord = {
  id: string;
  flowId: string;
  userId: string;
  organizationId: string;
  projectId: string;
  status: WorkflowExecutionDto['status'];
  startedAt: Date;
  completedAt: Date | null;
  currentNode: string | null;
  totalNodes: number | null;
  completedNodes: number;
  executionTimeMs: number | null;
  errorMessage: string | null;
  errorCode: string | null;
  version: number;
  metadata: unknown;
  flowState: unknown;
};

@Injectable()
export class WorkflowExecutionService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    WorkflowExecutionService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly initiativeService: InitiativeService,
    private readonly taskService: TaskService,
  ) {}

  async getTemplateMetrics(
    templateId: string,
    options: MetricsOptions,
  ): Promise<WorkflowTemplateMetricsDto> {
    const whereClause = {
      flowId: templateId,
      ...(options.organizationId && { organizationId: options.organizationId }),
      ...(options.startDate && { startedAt: { gte: options.startDate } }),
      ...(options.endDate && { startedAt: { lte: options.endDate } }),
    };

    // Get total executions and status breakdown
    const executions = await this.prisma.db.flowExecution.findMany({
      where: whereClause,
      select: {
        status: true,
        executionTimeMs: true,
        startedAt: true,
        errorCode: true,
        errorMessage: true,
      },
    });

    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(
      (e) => e.status === 'COMPLETED',
    ).length;
    const failedExecutions = executions.filter(
      (e) => e.status === 'FAILED',
    ).length;
    const successRate =
      totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    // Calculate execution time statistics
    type ExecutionRecord = (typeof executions)[number];
    type ExecutionWithTime = ExecutionRecord & { executionTimeMs: number };
    type ExecutionWithErrorCode = ExecutionRecord & { errorCode: string };

    const completedExecutions = executions.filter(
      (e): e is ExecutionWithTime => e.executionTimeMs != null,
    );
    const executionTimes = completedExecutions
      .map((e) => e.executionTimeMs)
      .sort((a, b) => a - b);

    const averageExecutionTime =
      executionTimes.length > 0
        ? Math.round(
            executionTimes.reduce((sum, time) => sum + time, 0) /
              executionTimes.length,
          )
        : 0;

    const medianExecutionTime =
      executionTimes.length > 0
        ? executionTimes[Math.floor(executionTimes.length / 2)]
        : 0;

    const p95ExecutionTime =
      executionTimes.length > 0
        ? executionTimes[Math.floor(executionTimes.length * 0.95)]
        : 0;

    // Status breakdown
    const executionsByStatus = executions.reduce(
      (acc, execution) => {
        acc[execution.status] = (acc[execution.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Daily execution counts
    const executionsByDay = this.groupExecutionsByDay(executions);

    // Most common errors
    const errorExecutions = executions.filter(
      (e): e is ExecutionWithErrorCode =>
        e.status === 'FAILED' && !!e.errorCode,
    );
    const errorCounts = errorExecutions.reduce(
      (acc, execution) => {
        const key = execution.errorCode; // Safe after filter
        if (!acc[key]) {
          acc[key] = {
            errorCode: key,
            errorMessage: execution.errorMessage || '',
            count: 0,
          };
        }
        acc[key].count++;
        return acc;
      },
      {} as Record<
        string,
        { errorCode: string; errorMessage: string; count: number }
      >,
    );

    const mostCommonErrors = Object.values(errorCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get template name (from template cache or default)
    const templateName = `Template ${templateId}`; // TODO: Get from WorkflowTemplateService

    return {
      templateId,
      templateName,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate: Math.round(successRate * 100) / 100,
      averageExecutionTime,
      medianExecutionTime,
      p95ExecutionTime,
      executionsByStatus,
      executionsByDay,
      mostCommonErrors,
      period: {
        startDate: (
          options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        ).toISOString(),
        endDate: (options.endDate || new Date()).toISOString(),
      },
    };
  }

  async getWorkflowAnalytics(
    options: AnalyticsOptions,
  ): Promise<WorkflowAnalyticsDto> {
    const whereClause = {
      ...(options.organizationId && { organizationId: options.organizationId }),
      ...(options.templateIds && { flowId: { in: options.templateIds } }),
      ...(options.startDate && { startedAt: { gte: options.startDate } }),
      ...(options.endDate && { startedAt: { lte: options.endDate } }),
    };

    // Get all executions for analysis
    const executions = await this.prisma.db.flowExecution.findMany({
      where: whereClause,
      select: {
        flowId: true,
        status: true,
        executionTimeMs: true,
        startedAt: true,
        userId: true,
      },
    });

    // Summary statistics
    const totalTemplates = new Set(executions.map((e) => e.flowId)).size;
    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(
      (e) => e.status === 'COMPLETED',
    ).length;
    const overallSuccessRate =
      totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;
    const activeUsers = new Set(executions.map((e) => e.userId)).size;

    type ExecutionRecord = (typeof executions)[number];
    type ExecutionWithTime = ExecutionRecord & { executionTimeMs: number };

    const completedExecutions = executions.filter(
      (e): e is ExecutionWithTime => e.executionTimeMs != null,
    );
    const averageExecutionTime =
      completedExecutions.length > 0
        ? Math.round(
            completedExecutions.reduce((sum, e) => sum + e.executionTimeMs, 0) /
              completedExecutions.length,
          )
        : 0;

    // Top templates by execution count
    const templateCounts = executions.reduce(
      (acc, execution) => {
        const template =
          acc[execution.flowId] ??
          (acc[execution.flowId] = {
            templateId: execution.flowId,
            templateName: `Template ${execution.flowId}`, // TODO: Get from WorkflowTemplateService
            executionCount: 0,
            successCount: 0,
            executionTimes: [],
          });
        template.executionCount++;
        if (execution.status === 'COMPLETED') {
          template.successCount++;
        }
        if (execution.executionTimeMs) {
          template.executionTimes.push(execution.executionTimeMs);
        }
        return acc;
      },
      {} as Record<
        string,
        {
          templateId: string;
          templateName: string;
          executionCount: number;
          successCount: number;
          executionTimes: number[];
        }
      >,
    );

    const topTemplates = Object.values(templateCounts)
      .map((template) => ({
        templateId: template.templateId,
        templateName: template.templateName,
        executionCount: template.executionCount,
        successRate:
          template.executionCount > 0
            ? Math.round(
                (template.successCount / template.executionCount) * 10000,
              ) / 100
            : 0,
        averageExecutionTime:
          template.executionTimes.length > 0
            ? Math.round(
                template.executionTimes.reduce(
                  (sum: number, time: number) => sum + time,
                  0,
                ) / template.executionTimes.length,
              )
            : undefined,
      }))
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, 10);

    // Trends over time
    const trendsOverTime = this.calculateTrendsOverTime(executions);

    return {
      summary: {
        totalTemplates,
        totalExecutions,
        overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
        averageExecutionTime,
        activeUsers,
      },
      topTemplates,
      trendsOverTime,
      period: {
        startDate: (
          options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        ).toISOString(),
        endDate: (options.endDate || new Date()).toISOString(),
      },
    };
  }

  async getWorkflowExecutions(
    options: ExecutionListOptions,
  ): Promise<WorkflowExecutionListDto> {
    const whereClause = {
      ...(options.organizationId && { organizationId: options.organizationId }),
      ...(options.templateId && { flowId: options.templateId }),
      ...(options.projectId && { projectId: options.projectId }),
      ...(options.userId && { userId: options.userId }),
      ...(options.status && { status: options.status }),
      ...(options.startDate && { startedAt: { gte: options.startDate } }),
      ...(options.endDate && { startedAt: { lte: options.endDate } }),
    };

    // Get total count for pagination
    const totalCount = await this.prisma.db.flowExecution.count({
      where: whereClause,
    });

    // Get executions with pagination and sorting
    const orderBy = { [options.sortBy]: options.sortOrder };

    const executions = await this.prisma.db.flowExecution.findMany({
      where: whereClause,
      orderBy,
      skip: options.offset,
      take: options.limit,
    });

    const executionDtos: WorkflowExecutionDto[] = executions.map((execution) =>
      this.toWorkflowExecutionDto(execution),
    );

    return {
      executions: executionDtos,
      totalCount,
      hasMore: options.offset + options.limit < totalCount,
      filters: {
        organizationId: options.organizationId,
        templateId: options.templateId,
        projectId: options.projectId,
        userId: options.userId,
        status: options.status,
        startDate: options.startDate?.toISOString(),
        endDate: options.endDate?.toISOString(),
      },
    };
  }

  async getExecutionById(
    organizationId: OrganizationId,
    executionId: string,
  ): Promise<WorkflowExecutionDto> {
    const execution = await this.findExecutionRecord(
      organizationId,
      executionId,
    );
    return this.toWorkflowExecutionDto(execution);
  }

  async waitForExecutionUpdate(
    organizationId: OrganizationId,
    executionId: string,
    options: WaitForExecutionOptions = {},
  ): Promise<WorkflowExecutionDto> {
    const timeoutMs = options.timeoutMs ?? 25_000;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const sinceVersion = options.sinceVersion;

    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new BadRequestException('timeoutMs must be a non-negative number');
    }

    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new BadRequestException('pollIntervalMs must be a positive number');
    }

    if (
      sinceVersion !== undefined &&
      (!Number.isInteger(sinceVersion) || sinceVersion < 0)
    ) {
      throw new BadRequestException(
        'sinceVersion must be a non-negative integer',
      );
    }

    const deadline = Date.now() + timeoutMs;

    while (true) {
      const execution = await this.findExecutionRecord(
        organizationId,
        executionId,
      );
      const dto = this.toWorkflowExecutionDto(execution);
      const isTerminal = this.isTerminalStatus(dto.status);

      if (
        sinceVersion === undefined ||
        (dto.version ?? 0) > sinceVersion ||
        isTerminal
      ) {
        return dto;
      }

      const timeRemainingMs = deadline - Date.now();
      if (timeRemainingMs <= 0) {
        return dto;
      }

      await this.sleep(Math.min(pollIntervalMs, timeRemainingMs));
    }
  }

  async getExecutionResultById(
    organizationId: OrganizationId,
    executionId: string,
  ): Promise<ExecutionResultDto> {
    const execution = await this.findExecutionRecord(
      organizationId,
      executionId,
    );
    const status = execution.status;
    const terminal = this.isTerminalStatus(status);
    const flowStateResult = this.extractResultFromFlowState(
      execution.flowState,
    );
    const metadata = this.normalizeMetadata(execution.metadata) as
      | Record<string, unknown>
      | null
      | undefined;
    const metadataResult = this.asResultRecord(metadata?.result);
    const result = flowStateResult ?? metadataResult;

    return {
      executionId: execution.id,
      status,
      version: execution.version,
      ready: terminal,
      completedAt: execution.completedAt?.toISOString() ?? null,
      ...(result ? { result } : {}),
      ...(status === 'FAILED' || status === 'CANCELLED'
        ? {
            error: {
              code: execution.errorCode,
              message: execution.errorMessage,
            },
          }
        : {}),
    };
  }

  private groupExecutionsByDay(
    executions: Array<{ startedAt: Date; status: string }>,
  ): Array<{
    date: string;
    count: number;
    successCount: number;
    failureCount: number;
  }> {
    const grouped = executions.reduce(
      (acc, execution) => {
        const [date] = execution.startedAt.toISOString().split('T');
        if (!date) {
          return acc;
        }
        const day =
          acc[date] ??
          (acc[date] = {
            date,
            count: 0,
            successCount: 0,
            failureCount: 0,
          });
        day.count++;
        if (execution.status === 'COMPLETED') {
          day.successCount++;
        } else if (execution.status === 'FAILED') {
          day.failureCount++;
        }
        return acc;
      },
      {} as Record<
        string,
        {
          date: string;
          count: number;
          successCount: number;
          failureCount: number;
        }
      >,
    );

    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }

  private async findExecutionRecord(
    organizationId: OrganizationId,
    executionId: string,
  ): Promise<ExecutionRecord> {
    const execution = await this.prisma.db.flowExecution.findFirst({
      where: {
        id: executionId,
        organizationId,
      },
    });

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    return execution;
  }

  private toWorkflowExecutionDto(
    execution: ExecutionRecord,
  ): WorkflowExecutionDto {
    return {
      id: execution.id,
      flowId: execution.flowId,
      userId: execution.userId,
      organizationId: execution.organizationId,
      projectId: execution.projectId,
      status: execution.status,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt?.toISOString() ?? null,
      currentNode: execution.currentNode,
      totalNodes: execution.totalNodes,
      completedNodes: execution.completedNodes,
      executionTimeMs: execution.executionTimeMs,
      errorMessage: execution.errorMessage,
      errorCode: execution.errorCode,
      version: execution.version,
      metadata: this.normalizeMetadata(execution.metadata),
    };
  }

  private isTerminalStatus(status: WorkflowExecutionDto['status']): boolean {
    return (
      status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED'
    );
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }

  private normalizeMetadata(
    metadata: unknown,
  ): WorkflowExecutionDto['metadata'] {
    if (metadata === null || metadata === undefined) {
      return metadata;
    }

    if (typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as Record<string, unknown>;
    }

    return undefined;
  }

  private extractResultFromFlowState(
    flowState: unknown,
  ): Record<string, unknown> | undefined {
    const context = this.extractFlowContext(flowState);
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      return undefined;
    }

    const research = (context as Record<string, unknown>).research;
    if (!research || typeof research !== 'object' || Array.isArray(research)) {
      return undefined;
    }

    return this.asResultRecord((research as Record<string, unknown>).result);
  }

  private extractFlowContext(flowState: unknown): FlowContext | undefined {
    if (isSerializableWorkflowState(flowState)) {
      return flowState.context;
    }

    if (
      flowState &&
      typeof flowState === 'object' &&
      !Array.isArray(flowState)
    ) {
      const candidate = flowState as Record<string, unknown>;
      if ('core' in candidate && typeof candidate.core === 'object') {
        return candidate as unknown as FlowContext;
      }
    }

    return undefined;
  }

  private asResultRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private calculateTrendsOverTime(
    executions: Array<{
      startedAt: Date;
      status: string;
      executionTimeMs: number | null;
    }>,
  ): Array<{
    date: string;
    totalExecutions: number;
    successRate: number;
    averageExecutionTime?: number;
  }> {
    const grouped = executions.reduce(
      (acc, execution) => {
        const [date] = execution.startedAt.toISOString().split('T');
        if (!date) {
          return acc;
        }
        const day =
          acc[date] ??
          (acc[date] = {
            date,
            totalExecutions: 0,
            successfulExecutions: 0,
            executionTimes: [],
          });
        day.totalExecutions++;
        if (execution.status === 'COMPLETED') {
          day.successfulExecutions++;
        }
        if (execution.executionTimeMs) {
          day.executionTimes.push(execution.executionTimeMs);
        }
        return acc;
      },
      {} as Record<
        string,
        {
          date: string;
          totalExecutions: number;
          successfulExecutions: number;
          executionTimes: number[];
        }
      >,
    );

    return Object.values(grouped)
      .map((day) => ({
        date: day.date,
        totalExecutions: day.totalExecutions,
        successRate:
          day.totalExecutions > 0
            ? Math.round(
                (day.successfulExecutions / day.totalExecutions) * 10000,
              ) / 100
            : 0,
        averageExecutionTime:
          day.executionTimes.length > 0
            ? Math.round(
                day.executionTimes.reduce(
                  (sum: number, time: number) => sum + time,
                  0,
                ) / day.executionTimes.length,
              )
            : undefined,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Validate if a skip to target node is allowed
   */
  async validateSkipToNode(
    flowTemplate: FlowTemplate,
    currentNode: string,
    targetNode: string,
    context: FlowContext,
    organizationId: OrganizationId,
  ): Promise<SkipValidationResult> {
    // Get the target node configuration
    const nodeConfig = flowTemplate.nodes[targetNode];

    if (!nodeConfig) {
      return {
        canSkip: false,
        reason: `Target node '${targetNode}' does not exist in flow`,
      };
    }

    const skipConfig = nodeConfig.skipToNode;

    if (!skipConfig || !skipConfig.allowed) {
      return {
        canSkip: false,
        reason: `Node '${targetNode}' is not configured as skip-to-able`,
      };
    }

    // Check validPreviousNodes
    if (skipConfig.validPreviousNodes !== '*') {
      if (!skipConfig.validPreviousNodes.includes(currentNode)) {
        return {
          canSkip: false,
          reason: `Cannot skip to '${targetNode}' from '${currentNode}'. Valid previous nodes: ${skipConfig.validPreviousNodes.join(', ')}`,
        };
      }
    }

    // Run validateState if defined
    if (skipConfig.validateState) {
      const services = {
        initiativeService: this.initiativeService,
        taskService: this.taskService,
      };

      const stateValidation = await skipConfig.validateState(context, services);

      if (!stateValidation.canSkip) {
        return stateValidation;
      }
    }

    return { canSkip: true };
  }

  /**
   * Get all available skip-to-able nodes for a workflow
   */
  async getAvailableSkipNodes(
    flowTemplate: FlowTemplate,
    currentNode: string,
    context: FlowContext,
    organizationId: OrganizationId,
  ): Promise<AvailableSkipNode[]> {
    const skipNodes: AvailableSkipNode[] = [];

    for (const [nodeId, nodeConfig] of Object.entries(flowTemplate.nodes)) {
      const skipConfig = nodeConfig.skipToNode;

      if (!skipConfig || !skipConfig.allowed) {
        continue;
      }

      // Validate this node
      const validation = await this.validateSkipToNode(
        flowTemplate,
        currentNode,
        nodeId,
        context,
        organizationId,
      );

      skipNodes.push({
        nodeId,
        label: this.getNodeLabel(nodeId),
        canSkip: validation.canSkip,
        reason: validation.reason,
      });
    }

    return skipNodes;
  }

  /**
   * Get a human-readable label for a node
   */
  private getNodeLabel(nodeId: string): string {
    // Convert node_id to Node Id format
    return nodeId
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
