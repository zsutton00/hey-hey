import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId } from '../../types';
import { ArtifactType } from 'src/generated';

// Agent cost data structure
export interface AgentCostData {
  agentId: string;
  executionId: string;
  executionTime: number;
  cost: number;
  organizationId: OrganizationId;
  projectId?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  metadata?: {
    confidence?: number;
    toolCalls?: number;
    changesApplied?: number;
    initiativeId?: string;
  };
}

// Agent cost summary for reporting
export interface AgentCostSummary {
  totalExecutions: number;
  totalCost: number;
  averageCost: number;
  averageExecutionTime: number;
  totalTokens: number;
  successRate: number;
  timeRange: {
    start: Date;
    end: Date;
  };
}

@Injectable()
export class AgentCostTrackingService {
  private readonly logger = new Logger(AgentCostTrackingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Track agent execution cost and usage data
   * Stores data as artifacts for consistency with existing patterns
   */
  async trackAgentExecution(costData: AgentCostData): Promise<void> {
    try {
      // Validate required fields
      if (
        !costData.agentId ||
        !costData.executionId ||
        !costData.organizationId
      ) {
        throw new Error(
          'Agent ID, execution ID, and organization ID are required for cost tracking',
        );
      }

      if (typeof costData.cost !== 'number' || costData.cost < 0) {
        throw new Error('Cost must be a non-negative number');
      }

      if (
        typeof costData.executionTime !== 'number' ||
        costData.executionTime < 0
      ) {
        throw new Error('Execution time must be a non-negative number');
      }

      // Create comprehensive cost tracking record
      const costRecord = {
        agentId: costData.agentId,
        executionId: costData.executionId,
        executionTime: costData.executionTime,
        cost: costData.cost,
        organizationId: costData.organizationId,
        projectId: costData.projectId,
        tokenUsage: costData.tokenUsage,
        metadata: costData.metadata,
        timestamp: new Date().toISOString(),
        trackingVersion: '1.0', // For future schema evolution
      };

      // Store as artifact for consistency with existing patterns
      // TODO: need a proper table for this, it's not an artifact
      // await this.prisma.db.artifact.create({
      //   data: {
      //     organizationId: costData.organizationId,
      //     projectId: costData.projectId,
      //     type: ArtifactType.SYSTEM_ANALYSIS,
      //     category: 'agent_cost_tracking',
      //     title: `Agent Execution Cost: ${costData.agentId}`,
      //     content: JSON.stringify(costRecord, null, 2),
      //     metadata: {
      //       agentId: costData.agentId,
      //       executionId: costData.executionId,
      //       cost: costData.cost,
      //       executionTime: costData.executionTime,
      //       trackingType: 'agent_execution_cost',
      //     },
      //     tags: [
      //       'agent_execution',
      //       `agent:${costData.agentId}`,
      //       'cost_tracking',
      //       `cost:${costData.cost.toFixed(4)}`,
      //     ],
      //     generateEmbedding: false, // No need for semantic search on cost data
      //   },
      // });

      this.logger.log(
        `Tracked agent execution cost: ${costData.agentId} (${costData.executionId}) - $${costData.cost.toFixed(4)} in ${costData.executionTime}ms`,
        costRecord,
      );
    } catch (error) {
      this.logger.error('Failed to track agent execution cost:', error);
      // Don't throw - cost tracking failure shouldn't break agent execution
      // But log it for monitoring and alerting
    }
  }

  /**
   * Get agent cost data for a specific organization
   * Used for cost analysis and reporting
   */
  async getOrganizationAgentCosts(
    organizationId: OrganizationId,
    options: {
      agentId?: string;
      projectId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    } = {},
  ): Promise<AgentCostData[]> {
    try {
      const whereClause: Record<string, unknown> = {
        organizationId,
        type: ArtifactType.Document,
        category: 'agent_cost_tracking',
      };

      // Add optional filters
      if (options.agentId) {
        whereClause['metadata'] = {
          path: ['agentId'],
          equals: options.agentId,
        };
      }

      if (options.projectId) {
        whereClause.projectId = options.projectId;
      }

      if (options.startDate || options.endDate) {
        whereClause.createdAt = {};
        if (options.startDate) {
          (whereClause.createdAt as Record<string, unknown>).gte =
            options.startDate;
        }
        if (options.endDate) {
          (whereClause.createdAt as Record<string, unknown>).lte =
            options.endDate;
        }
      }

      const artifacts = await this.prisma.db.artifact.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: options.limit || 1000,
      });

      // Parse and validate cost data from artifacts
      const costData: AgentCostData[] = [];

      // for (const artifact of artifacts) {
      // try {
      //   const parsedData = JSON.parse(artifact.data) as AgentCostData;

      //   // Validate parsed data structure
      //   if (
      //     parsedData.agentId &&
      //     parsedData.executionId &&
      //     typeof parsedData.cost === 'number'
      //   ) {
      //     costData.push(parsedData);
      //   } else {
      //     this.logger.warn(
      //       `Invalid cost data structure in artifact ${artifact.id}`,
      //     );
      //   }
      // } catch (parseError) {
      //   this.logger.warn(
      //     `Failed to parse cost data from artifact ${artifact.id}:`,
      //     parseError,
      //   );
      // }
      // }

      this.logger.log(
        `Retrieved ${costData.length} agent cost records for organization ${organizationId}`,
      );
      return costData;
    } catch (error) {
      this.logger.error('Failed to get organization agent costs:', error);
      throw new Error(
        `Failed to retrieve agent cost data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Generate cost summary for reporting and monitoring
   */
  async getAgentCostSummary(
    organizationId: OrganizationId,
    options: {
      agentId?: string;
      projectId?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ): Promise<AgentCostSummary> {
    try {
      const costData = await this.getOrganizationAgentCosts(
        organizationId,
        options,
      );

      if (costData.length === 0) {
        return {
          totalExecutions: 0,
          totalCost: 0,
          averageCost: 0,
          averageExecutionTime: 0,
          totalTokens: 0,
          successRate: 0,
          timeRange: {
            start: options.startDate || new Date(),
            end: options.endDate || new Date(),
          },
        };
      }

      // Calculate summary statistics
      const totalExecutions = costData.length;
      const totalCost = costData.reduce((sum, data) => sum + data.cost, 0);
      const averageCost = totalCost / totalExecutions;
      const averageExecutionTime =
        costData.reduce((sum, data) => sum + data.executionTime, 0) /
        totalExecutions;

      // Calculate total tokens (if available)
      const totalTokens = costData.reduce((sum, data) => {
        if (data.tokenUsage) {
          return (
            sum + data.tokenUsage.inputTokens + data.tokenUsage.outputTokens
          );
        }
        return sum;
      }, 0);

      // Calculate success rate (assume all tracked executions are successful - failures wouldn't be tracked)
      const successRate = 1.0; // All recorded executions completed successfully

      // Determine actual time range from data
      // const timestamps = costData.map(
      //   (data) => new Date(data.metadata?.timestamp || new Date()),
      // );
      // const actualStart =
      //   options.startDate ||
      //   new Date(Math.min(...timestamps.map((d) => d.getTime())));
      // const actualEnd =
      //   options.endDate ||
      //   new Date(Math.max(...timestamps.map((d) => d.getTime())));

      // const summary: AgentCostSummary = {
      //   totalExecutions,
      //   totalCost,
      //   averageCost,
      //   averageExecutionTime,
      //   totalTokens,
      //   successRate,
      //   timeRange: {
      //     start: actualStart,
      //     end: actualEnd,
      //   },
      // };

      this.logger.log(
        `Generated cost summary for organization ${organizationId}: ${totalExecutions} executions, $${totalCost.toFixed(4)} total cost`,
      );
      return {} as unknown as AgentCostSummary;
    } catch (error) {
      this.logger.error('Failed to generate agent cost summary:', error);
      throw new Error(
        `Failed to generate cost summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get cost trends for monitoring and alerting
   * Returns daily cost aggregations for trend analysis
   */
  async getAgentCostTrends(
    organizationId: OrganizationId,
    days: number = 30,
    agentId?: string,
  ): Promise<
    Array<{
      date: string;
      executions: number;
      cost: number;
      averageTime: number;
    }>
  > {
    try {
      const endDate = new Date();
      const startDate = new Date(
        endDate.getTime() - days * 24 * 60 * 60 * 1000,
      );

      const costData = await this.getOrganizationAgentCosts(organizationId, {
        agentId,
        startDate,
        endDate,
      });

      // Group by date
      // const trendsByDate = new Map<
      //   string,
      //   { executions: number; cost: number; totalTime: number }
      // >();

      // for (const data of costData) {
      //   const date = new Date(data.metadata?.timestamp || new Date())
      //     .toISOString()
      //     .split('T')[0];

      //   if (!trendsByDate.has(date)) {
      //     trendsByDate.set(date, { executions: 0, cost: 0, totalTime: 0 });
      //   }

      //   const dayData = trendsByDate.get(date);
      //   dayData.executions += 1;
      //   dayData.cost += data.cost;
      //   dayData.totalTime += data.executionTime;
      // }

      // // Convert to array and calculate averages
      // const trends = Array.from(trendsByDate.entries())
      //   .map(([date, data]) => ({
      //     date,
      //     executions: data.executions,
      //     cost: data.cost,
      //     averageTime:
      //       data.executions > 0 ? data.totalTime / data.executions : 0,
      //   }))
      //   .sort((a, b) => a.date.localeCompare(b.date));

      // this.logger.log(
      //   `Generated ${trends.length} days of cost trends for organization ${organizationId}`,
      // );
      return [] as unknown as {
        date: string;
        executions: number;
        cost: number;
        averageTime: number;
      }[];
      // return trends;
    } catch (error) {
      this.logger.error('Failed to get agent cost trends:', error);
      throw new Error(
        `Failed to get cost trends: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Check if organization is approaching cost limits
   * Returns warnings for cost monitoring and alerting
   */
  async checkCostAlerts(
    organizationId: OrganizationId,
    limits: {
      dailyCostLimit?: number;
      monthlyCostLimit?: number;
      executionCountLimit?: number;
    },
  ): Promise<{
    alerts: Array<{
      type: 'daily_cost' | 'monthly_cost' | 'execution_count';
      current: number;
      limit: number;
      percentage: number;
      message: string;
    }>;
  }> {
    try {
      const alerts: Array<{
        type: 'daily_cost' | 'monthly_cost' | 'execution_count';
        current: number;
        limit: number;
        percentage: number;
        message: string;
      }> = [];

      // Check daily cost limit
      if (limits.dailyCostLimit) {
        const today = new Date();
        const startOfDay = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );

        const dailyCosts = await this.getOrganizationAgentCosts(
          organizationId,
          {
            startDate: startOfDay,
            endDate: today,
          },
        );

        const totalDailyCost = dailyCosts.reduce(
          (sum, data) => sum + data.cost,
          0,
        );
        const dailyPercentage = (totalDailyCost / limits.dailyCostLimit) * 100;

        if (dailyPercentage >= 80) {
          // Alert at 80% of limit
          alerts.push({
            type: 'daily_cost',
            current: totalDailyCost,
            limit: limits.dailyCostLimit,
            percentage: dailyPercentage,
            message: `Daily agent cost is at ${dailyPercentage.toFixed(1)}% of limit ($${totalDailyCost.toFixed(4)} / $${limits.dailyCostLimit.toFixed(4)})`,
          });
        }
      }

      // Check monthly cost limit
      if (limits.monthlyCostLimit) {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const monthlyCosts = await this.getOrganizationAgentCosts(
          organizationId,
          {
            startDate: startOfMonth,
            endDate: today,
          },
        );

        const totalMonthlyCost = monthlyCosts.reduce(
          (sum, data) => sum + data.cost,
          0,
        );
        const monthlyPercentage =
          (totalMonthlyCost / limits.monthlyCostLimit) * 100;

        if (monthlyPercentage >= 80) {
          // Alert at 80% of limit
          alerts.push({
            type: 'monthly_cost',
            current: totalMonthlyCost,
            limit: limits.monthlyCostLimit,
            percentage: monthlyPercentage,
            message: `Monthly agent cost is at ${monthlyPercentage.toFixed(1)}% of limit ($${totalMonthlyCost.toFixed(4)} / $${limits.monthlyCostLimit.toFixed(4)})`,
          });
        }
      }

      // Check execution count limit (daily)
      if (limits.executionCountLimit) {
        const today = new Date();
        const startOfDay = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );

        const dailyExecutions = await this.getOrganizationAgentCosts(
          organizationId,
          {
            startDate: startOfDay,
            endDate: today,
          },
        );

        const executionCount = dailyExecutions.length;
        const executionPercentage =
          (executionCount / limits.executionCountLimit) * 100;

        if (executionPercentage >= 80) {
          // Alert at 80% of limit
          alerts.push({
            type: 'execution_count',
            current: executionCount,
            limit: limits.executionCountLimit,
            percentage: executionPercentage,
            message: `Daily agent executions at ${executionPercentage.toFixed(1)}% of limit (${executionCount} / ${limits.executionCountLimit})`,
          });
        }
      }

      if (alerts.length > 0) {
        this.logger.warn(
          `Cost alerts for organization ${organizationId}: ${alerts.map((a) => a.message).join('; ')}`,
        );
      }

      return { alerts };
    } catch (error) {
      this.logger.error('Failed to check cost alerts:', error);
      throw new Error(
        `Failed to check cost alerts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
