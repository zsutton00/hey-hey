import { Injectable, Logger } from '@nestjs/common';
import { LLMPromptResponseStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  OrganizationId,
  ProjectId,
  ConversationId,
  WorkflowId,
  UserId,
} from 'src/types';

export interface RecordPromptResponseData {
  requestId?: string;
  organizationId: OrganizationId;
  projectId?: ProjectId;
  conversationId?: ConversationId;
  workflowId?: WorkflowId;
  flowId?: string;
  userId?: UserId;
  nodeId?: string;
  nodeType?: string;
  provider: string;
  model: string;
  taskType?: string;
  toolName?: string;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  prompt: string;
  responseContent: string;
  responseSchema?: object;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  inputCost?: number;
  outputCost?: number;
  totalCost?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
  errorType?: string;
  metadata?: object;
  status?: LLMPromptResponseStatus;
}

export interface RecordPromptStartData {
  requestId?: string;
  organizationId: OrganizationId;
  projectId?: ProjectId;
  conversationId?: ConversationId;
  workflowId?: WorkflowId;
  flowId?: string;
  userId?: UserId;
  nodeId?: string;
  nodeType?: string;
  provider: string;
  model: string;
  taskType?: string;
  toolName?: string;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  prompt: string;
  responseSchema?: object;
  metadata?: object;
}

export interface FinalizePromptResponseData {
  requestId?: string;
  responseContent?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  inputCost?: number;
  outputCost?: number;
  totalCost?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
  errorType?: string;
  metadata?: object;
}

export interface LLMCostSummary {
  organizationId: OrganizationId;
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  breakdown: {
    model: string;
    calls: number;
    tokens: number;
    cost: number;
  }[];
  timeRange: {
    start: Date;
    end: Date;
  };
}

export interface ProjectCostSummary {
  projectId: ProjectId;
  projectName: string;
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  timeRange: {
    start: Date;
    end: Date;
  };
}

/**
 * Service for tracking LLM prompt/response pairs in the database
 *
 * Used for debugging, monitoring, and future evaluation workflows
 */
@Injectable()
export class LLMTrackingService {
  private readonly logger = new Logger(LLMTrackingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Record a prompt/response pair to the database
   *
   * @param data - The prompt/response data to record
   * @returns The ID of the created record
   */
  async recordPromptResponse(data: RecordPromptResponseData): Promise<string> {
    const mappedData = this.buildCreateData(data);

    try {
      const record = await this.prisma.db.lLMPromptResponse.create({
        data: mappedData,
      });
      return record.id;
    } catch (error) {
      // If the conversation is synthetic/missing, drop it and retry so we still track the call
      if (
        data.conversationId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003' &&
        error.meta?.constraint === 'llm_prompt_responses_conversation_id_fkey'
      ) {
        this.logger.warn(
          'Retrying LLM prompt/response tracking without conversationId (conversation not found)',
          {
            conversationId: data.conversationId,
            requestId: data.requestId,
          },
        );

        const record = await this.prisma.db.lLMPromptResponse.create({
          data: this.buildCreateData({ ...data, conversationId: undefined }),
        });
        return record.id;
      }

      if (this.isRequestIdUniqueConstraintError(error) && data.requestId) {
        const existing = await this.prisma.db.lLMPromptResponse.findUnique({
          where: { requestId: data.requestId },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.db.lLMPromptResponse.update({
            where: { id: existing.id },
            data: this.buildResponseUpdateData(data),
          });
          this.logger.warn(
            'Updated existing LLM prompt/response tracking row for duplicate requestId',
            {
              requestId: data.requestId,
              trackingRecordId: existing.id,
            },
          );
          return existing.id;
        }
      }

      throw error;
    }
  }

  async recordPromptStart(data: RecordPromptStartData): Promise<string> {
    const createData = this.buildStartCreateData(data);

    try {
      const record = await this.prisma.db.lLMPromptResponse.create({
        data: createData,
      });
      return record.id;
    } catch (error) {
      // If the conversation is synthetic/missing, drop it and retry so we still track the call
      if (
        data.conversationId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003' &&
        error.meta?.constraint === 'llm_prompt_responses_conversation_id_fkey'
      ) {
        this.logger.warn(
          'Retrying LLM prompt start tracking without conversationId (conversation not found)',
          {
            conversationId: data.conversationId,
            requestId: data.requestId,
          },
        );

        const record = await this.prisma.db.lLMPromptResponse.create({
          data: this.buildStartCreateData({
            ...data,
            conversationId: undefined,
          }),
        });
        return record.id;
      }

      if (this.isRequestIdUniqueConstraintError(error) && data.requestId) {
        const existing = await this.prisma.db.lLMPromptResponse.findUnique({
          where: { requestId: data.requestId },
          select: { id: true },
        });
        if (existing) {
          this.logger.warn(
            'Reusing existing LLM prompt start tracking row for duplicate requestId',
            {
              requestId: data.requestId,
              trackingRecordId: existing.id,
            },
          );
          return existing.id;
        }
      }

      throw error;
    }
  }

  async finalizePromptResponse(
    trackingId: string,
    data: FinalizePromptResponseData,
  ): Promise<void> {
    const updateData = this.buildFinalizeUpdateData(data);
    await this.prisma.db.lLMPromptResponse.update({
      where: { id: trackingId },
      data: updateData,
    });
  }

  private buildCreateData(
    data: RecordPromptResponseData,
  ): Prisma.LLMPromptResponseUncheckedCreateInput {
    const createData: Prisma.LLMPromptResponseUncheckedCreateInput = {
      organizationId: data.organizationId,
      provider: data.provider,
      model: data.model,
      stream: data.stream,
      prompt: data.prompt,
      responseContent: data.responseContent,
      success: data.success,
      status:
        data.status ??
        (data.success
          ? LLMPromptResponseStatus.SUCCEEDED
          : LLMPromptResponseStatus.FAILED),
    };

    if (data.requestId !== undefined) {
      createData.requestId = data.requestId;
    }
    if (data.projectId !== undefined) {
      createData.projectId = data.projectId;
    }
    if (data.conversationId !== undefined) {
      createData.conversationId = data.conversationId;
    }
    if (data.workflowId !== undefined) {
      createData.workflowId = data.workflowId;
    }
    if (data.flowId !== undefined) {
      createData.flowId = data.flowId;
    }
    if (data.userId !== undefined) {
      createData.userId = data.userId;
    }
    if (data.nodeId !== undefined) {
      createData.nodeId = data.nodeId;
    }
    if (data.nodeType !== undefined) {
      createData.nodeType = data.nodeType;
    }
    if (data.taskType !== undefined) {
      createData.taskType = data.taskType;
    }
    if (data.toolName !== undefined) {
      createData.toolName = data.toolName;
    }
    if (data.temperature !== undefined) {
      createData.temperature = data.temperature;
    }
    if (data.maxTokens !== undefined) {
      createData.maxTokens = data.maxTokens;
    }
    if (data.responseSchema !== undefined) {
      createData.responseSchema = data.responseSchema as Prisma.InputJsonValue;
    }
    if (data.promptTokens !== undefined) {
      createData.promptTokens = data.promptTokens;
    }
    if (data.completionTokens !== undefined) {
      createData.completionTokens = data.completionTokens;
    }
    if (data.totalTokens !== undefined) {
      createData.totalTokens = data.totalTokens;
    }
    if (data.inputCost !== undefined) {
      createData.inputCost = data.inputCost;
    }
    if (data.outputCost !== undefined) {
      createData.outputCost = data.outputCost;
    }
    if (data.totalCost !== undefined) {
      createData.totalCost = data.totalCost;
    }
    if (data.durationMs !== undefined) {
      createData.durationMs = data.durationMs;
    }
    if (data.errorMessage !== undefined) {
      createData.errorMessage = data.errorMessage;
    }
    if (data.errorType !== undefined) {
      createData.errorType = data.errorType;
    }
    if (data.metadata !== undefined) {
      createData.metadata = data.metadata as Prisma.InputJsonValue;
    }

    return createData;
  }

  private buildStartCreateData(
    data: RecordPromptStartData,
  ): Prisma.LLMPromptResponseUncheckedCreateInput {
    const createData: Prisma.LLMPromptResponseUncheckedCreateInput = {
      organizationId: data.organizationId,
      provider: data.provider,
      model: data.model,
      stream: data.stream,
      prompt: data.prompt,
      success: true,
      status: LLMPromptResponseStatus.STARTED,
    };

    if (data.requestId !== undefined) {
      createData.requestId = data.requestId;
    }
    if (data.projectId !== undefined) {
      createData.projectId = data.projectId;
    }
    if (data.conversationId !== undefined) {
      createData.conversationId = data.conversationId;
    }
    if (data.workflowId !== undefined) {
      createData.workflowId = data.workflowId;
    }
    if (data.flowId !== undefined) {
      createData.flowId = data.flowId;
    }
    if (data.userId !== undefined) {
      createData.userId = data.userId;
    }
    if (data.nodeId !== undefined) {
      createData.nodeId = data.nodeId;
    }
    if (data.nodeType !== undefined) {
      createData.nodeType = data.nodeType;
    }
    if (data.taskType !== undefined) {
      createData.taskType = data.taskType;
    }
    if (data.toolName !== undefined) {
      createData.toolName = data.toolName;
    }
    if (data.temperature !== undefined) {
      createData.temperature = data.temperature;
    }
    if (data.maxTokens !== undefined) {
      createData.maxTokens = data.maxTokens;
    }
    if (data.responseSchema !== undefined) {
      createData.responseSchema = data.responseSchema as Prisma.InputJsonValue;
    }
    if (data.metadata !== undefined) {
      createData.metadata = data.metadata as Prisma.InputJsonValue;
    }

    return createData;
  }

  private buildFinalizeUpdateData(
    data: FinalizePromptResponseData,
  ): Prisma.LLMPromptResponseUncheckedUpdateInput {
    const updateData: Prisma.LLMPromptResponseUncheckedUpdateInput = {
      success: data.success,
      status: data.success
        ? LLMPromptResponseStatus.SUCCEEDED
        : LLMPromptResponseStatus.FAILED,
    };

    if (data.requestId !== undefined) {
      updateData.requestId = data.requestId;
    }
    if (data.responseContent !== undefined) {
      updateData.responseContent = data.responseContent;
    }
    if (data.promptTokens !== undefined) {
      updateData.promptTokens = data.promptTokens;
    }
    if (data.completionTokens !== undefined) {
      updateData.completionTokens = data.completionTokens;
    }
    if (data.totalTokens !== undefined) {
      updateData.totalTokens = data.totalTokens;
    }
    if (data.inputCost !== undefined) {
      updateData.inputCost = data.inputCost;
    }
    if (data.outputCost !== undefined) {
      updateData.outputCost = data.outputCost;
    }
    if (data.totalCost !== undefined) {
      updateData.totalCost = data.totalCost;
    }
    if (data.durationMs !== undefined) {
      updateData.durationMs = data.durationMs;
    }
    if (data.errorMessage !== undefined) {
      updateData.errorMessage = data.errorMessage;
    }
    if (data.errorType !== undefined) {
      updateData.errorType = data.errorType;
    }
    if (data.metadata !== undefined) {
      updateData.metadata = data.metadata as Prisma.InputJsonValue;
    }

    return updateData;
  }

  private buildResponseUpdateData(
    data: RecordPromptResponseData,
  ): Prisma.LLMPromptResponseUncheckedUpdateInput {
    const updateData: Prisma.LLMPromptResponseUncheckedUpdateInput = {
      provider: data.provider,
      model: data.model,
      stream: data.stream,
      prompt: data.prompt,
      success: data.success,
      status:
        data.status ??
        (data.success
          ? LLMPromptResponseStatus.SUCCEEDED
          : LLMPromptResponseStatus.FAILED),
    };

    if (data.requestId !== undefined) {
      updateData.requestId = data.requestId;
    }
    if (data.taskType !== undefined) {
      updateData.taskType = data.taskType;
    }
    if (data.toolName !== undefined) {
      updateData.toolName = data.toolName;
    }
    if (data.temperature !== undefined) {
      updateData.temperature = data.temperature;
    }
    if (data.maxTokens !== undefined) {
      updateData.maxTokens = data.maxTokens;
    }
    if (data.responseContent !== undefined) {
      updateData.responseContent = data.responseContent;
    }
    if (data.responseSchema !== undefined) {
      updateData.responseSchema = data.responseSchema as Prisma.InputJsonValue;
    }
    if (data.promptTokens !== undefined) {
      updateData.promptTokens = data.promptTokens;
    }
    if (data.completionTokens !== undefined) {
      updateData.completionTokens = data.completionTokens;
    }
    if (data.totalTokens !== undefined) {
      updateData.totalTokens = data.totalTokens;
    }
    if (data.inputCost !== undefined) {
      updateData.inputCost = data.inputCost;
    }
    if (data.outputCost !== undefined) {
      updateData.outputCost = data.outputCost;
    }
    if (data.totalCost !== undefined) {
      updateData.totalCost = data.totalCost;
    }
    if (data.durationMs !== undefined) {
      updateData.durationMs = data.durationMs;
    }
    if (data.errorMessage !== undefined) {
      updateData.errorMessage = data.errorMessage;
    }
    if (data.errorType !== undefined) {
      updateData.errorType = data.errorType;
    }
    if (data.metadata !== undefined) {
      updateData.metadata = data.metadata as Prisma.InputJsonValue;
    }

    return updateData;
  }

  private isRequestIdUniqueConstraintError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.some(
        (value) => value === 'request_id' || value === 'requestId',
      );
    }
    if (typeof target === 'string') {
      return target.includes('request_id') || target.includes('requestId');
    }
    return false;
  }

  /**
   * Find many prompt/response records with filtering and pagination
   *
   * @param args - Prisma find many arguments
   * @returns Array of prompt/response records
   */
  async findMany(
    args: Prisma.Args<typeof this.prisma.db.lLMPromptResponse, 'findMany'>,
  ) {
    return this.prisma.db.lLMPromptResponse.findMany(args);
  }

  /**
   * Find a single prompt/response record by ID
   *
   * @param id - The record ID
   * @returns The prompt/response record or null
   */
  async findById(id: string) {
    return this.prisma.db.lLMPromptResponse.findUnique({ where: { id } });
  }

  /**
   * Get aggregate statistics for an organization
   *
   * @param organizationId - The organization ID
   * @returns Statistics about LLM usage
   */
  async getStats(
    organizationId: OrganizationId,
    accessibleProjectIds: string[],
  ) {
    const scope: Prisma.LLMPromptResponseWhereInput = {
      organizationId,
      OR: [{ projectId: null }, { projectId: { in: accessibleProjectIds } }],
    };
    const [total, successful, failed, avgTokens] = await Promise.all([
      this.prisma.db.lLMPromptResponse.count({
        where: scope,
      }),
      this.prisma.db.lLMPromptResponse.count({
        where: {
          ...scope,
          status: LLMPromptResponseStatus.SUCCEEDED,
        },
      }),
      this.prisma.db.lLMPromptResponse.count({
        where: {
          ...scope,
          status: LLMPromptResponseStatus.FAILED,
        },
      }),
      this.prisma.db.lLMPromptResponse.aggregate({
        where: scope,
        _avg: { totalTokens: true },
      }),
    ]);

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgTokens: avgTokens._avg.totalTokens || 0,
    };
  }

  /**
   * Get LLM cost summary for an organization over a time period
   */
  async getOrganizationCostSummary(
    organizationId: OrganizationId,
    startDate: Date,
    endDate: Date,
  ): Promise<LLMCostSummary> {
    const costRecords = await this.prisma.db.lLMPromptResponse.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        totalCost: { not: null },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    let totalCalls = 0;
    let totalTokens = 0;
    let totalCost = 0;
    const modelBreakdown = new Map<
      string,
      { calls: number; tokens: number; cost: number }
    >();

    for (const record of costRecords) {
      const recordCost = record.totalCost?.toNumber() ?? 0;
      const recordTokens = record.totalTokens ?? 0;

      totalCalls++;
      totalTokens += recordTokens;
      totalCost += recordCost;

      const existing = modelBreakdown.get(record.model) || {
        calls: 0,
        tokens: 0,
        cost: 0,
      };
      modelBreakdown.set(record.model, {
        calls: existing.calls + 1,
        tokens: existing.tokens + recordTokens,
        cost: existing.cost + recordCost,
      });
    }

    return {
      organizationId,
      totalCalls,
      totalTokens,
      totalCost,
      breakdown: Array.from(modelBreakdown.entries()).map(([model, data]) => ({
        model,
        calls: data.calls,
        tokens: data.tokens,
        cost: data.cost,
      })),
      timeRange: {
        start: startDate,
        end: endDate,
      },
    };
  }

  /**
   * Get LLM cost summary for projects in an organization
   */
  async getProjectCostSummaries(
    organizationId: OrganizationId,
    startDate: Date,
    endDate: Date,
  ): Promise<ProjectCostSummary[]> {
    const costRecords = await this.prisma.db.lLMPromptResponse.findMany({
      where: {
        organizationId,
        projectId: { not: null },
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        totalCost: { not: null },
      },
      include: {
        project: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const projectCosts = new Map<
      string,
      { name: string; calls: number; tokens: number; cost: number }
    >();

    for (const record of costRecords) {
      if (!record.projectId) {
        continue;
      }

      const recordCost = record.totalCost?.toNumber() ?? 0;
      const recordTokens = record.totalTokens ?? 0;
      const existing = projectCosts.get(record.projectId) || {
        name: record.project?.name || 'Unknown Project',
        calls: 0,
        tokens: 0,
        cost: 0,
      };
      projectCosts.set(record.projectId, {
        name: existing.name,
        calls: existing.calls + 1,
        tokens: existing.tokens + recordTokens,
        cost: existing.cost + recordCost,
      });
    }

    const projectSummaries: ProjectCostSummary[] = [];

    for (const [projectId, costs] of projectCosts.entries()) {
      projectSummaries.push({
        projectId: projectId as ProjectId,
        projectName: costs.name,
        totalCalls: costs.calls,
        totalTokens: costs.tokens,
        totalCost: costs.cost,
        timeRange: {
          start: startDate,
          end: endDate,
        },
      });
    }

    return projectSummaries.sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Get current month cost summary for an organization
   */
  async getCurrentMonthCosts(
    organizationId: OrganizationId,
  ): Promise<LLMCostSummary> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    return this.getOrganizationCostSummary(
      organizationId,
      startOfMonth,
      endOfMonth,
    );
  }

  /**
   * Get cost trends over the last N days
   */
  async getCostTrends(
    organizationId: OrganizationId,
    days: number = 30,
  ): Promise<{ date: string; calls: number; cost: number }[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const costRecords = await this.prisma.db.lLMPromptResponse.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        totalCost: { not: null },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const dailyCosts = new Map<string, { calls: number; cost: number }>();
    const toDateKey = (date: Date): string => {
      const [dateKey] = date.toISOString().split('T');
      if (!dateKey) {
        throw new Error('Failed to derive date key from timestamp');
      }
      return dateKey;
    };

    for (const record of costRecords) {
      const dateKey = toDateKey(record.createdAt);
      const recordCost = record.totalCost?.toNumber() ?? 0;
      const existing = dailyCosts.get(dateKey) || { calls: 0, cost: 0 };
      dailyCosts.set(dateKey, {
        calls: existing.calls + 1,
        cost: existing.cost + recordCost,
      });
    }

    const trends: { date: string; calls: number; cost: number }[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateKey = toDateKey(currentDate);
      const data = dailyCosts.get(dateKey) || { calls: 0, cost: 0 };
      trends.push({
        date: dateKey,
        calls: data.calls,
        cost: data.cost,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return trends;
  }
}
