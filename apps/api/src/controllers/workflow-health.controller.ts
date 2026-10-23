/**
 * Workflow Health Monitoring Controller
 *
 * Provides API endpoints for accessing Phase 3 workflow health monitoring,
 * metrics collection, and system observability features.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { WorkflowHealthChecker } from '../workflows/monitoring/workflow-health-checker';
import { WorkflowMetricsCollector } from '../workflows/monitoring/workflow-metrics-collector';
import {
  WorkflowHealthMetrics,
  WorkflowAlert,
  WorkflowMetrics,
  StepMetrics,
  WorkflowTrace,
  SystemHealthStatus,
  AlertStatus,
  MetricsQuery,
} from '../workflows/monitoring/workflow-metrics.types';
import { OrganizationId, WorkflowId } from '../types';

@ApiTags('workflow-health')
@Controller('workflow-health')
export class WorkflowHealthController {
  constructor(
    private readonly healthChecker: WorkflowHealthChecker,
    private readonly metricsCollector: WorkflowMetricsCollector,
  ) {}

  @Get('system/status')
  @ApiOperation({
    summary: 'Get current system health status',
    description: 'Returns the current overall system health status',
  })
  @ApiResponse({
    status: 200,
    description: 'Current system health status',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: Object.values(SystemHealthStatus),
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  getCurrentSystemStatus() {
    const status = this.healthChecker.getCurrentSystemStatus();
    return {
      status,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('system/health')
  @ApiOperation({
    summary: 'Perform comprehensive health check',
    description:
      'Executes a full system health check and returns detailed metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Comprehensive system health metrics',
    type: Object, // WorkflowHealthMetrics would be ideal here
  })
  async performHealthCheck(): Promise<WorkflowHealthMetrics> {
    try {
      return await this.healthChecker.performHealthCheck();
    } catch (error) {
      throw new HttpException(
        `Failed to perform health check: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('system/alerts')
  @ApiOperation({
    summary: 'Get all active alerts',
    description: 'Returns all currently active system alerts',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: AlertStatus,
    description: 'Filter alerts by status',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active alerts',
    type: [Object], // WorkflowAlert[] would be ideal
  })
  getActiveAlerts(@Query('status') status?: AlertStatus): WorkflowAlert[] {
    const alerts = this.healthChecker.getActiveAlerts();

    if (status) {
      return alerts.filter((alert) => alert.status === status);
    }

    return alerts;
  }

  @Post('alerts/:alertId/acknowledge')
  @ApiOperation({
    summary: 'Acknowledge an alert',
    description: 'Mark an alert as acknowledged by a specific user',
  })
  @ApiParam({
    name: 'alertId',
    description: 'The ID of the alert to acknowledge',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        acknowledgedBy: {
          type: 'string',
          description: 'User ID acknowledging the alert',
        },
      },
      required: ['acknowledgedBy'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Alert acknowledgment status',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        alertId: { type: 'string' },
        acknowledgedBy: { type: 'string' },
        acknowledgedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  acknowledgeAlert(
    @Param('alertId') alertId: string,
    @Body('acknowledgedBy') acknowledgedBy: string,
  ) {
    if (!acknowledgedBy) {
      throw new HttpException(
        'acknowledgedBy is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const success = this.healthChecker.acknowledgeAlert(
      alertId,
      acknowledgedBy,
    );

    if (!success) {
      throw new HttpException(
        `Alert with ID ${alertId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      success,
      alertId,
      acknowledgedBy,
      acknowledgedAt: new Date().toISOString(),
    };
  }

  @Get('system/history')
  @ApiOperation({
    summary: 'Get system health history',
    description: 'Returns historical health metrics for trend analysis',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of history entries to return (default: 100)',
  })
  @ApiResponse({
    status: 200,
    description: 'Historical health metrics',
    type: [Object], // WorkflowHealthMetrics[] would be ideal
  })
  getHealthHistory(@Query('limit') limit?: number): WorkflowHealthMetrics[] {
    const parsedLimit = limit ? parseInt(limit.toString(), 10) : 100;

    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      throw new HttpException(
        'Limit must be a positive number',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.healthChecker.getHealthHistory(parsedLimit);
  }

  @Get('workflows/:workflowId/metrics')
  @ApiOperation({
    summary: 'Get workflow metrics',
    description: 'Returns comprehensive metrics for a specific workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to get metrics for',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow metrics',
    type: Object, // WorkflowMetrics would be ideal
  })
  getWorkflowMetrics(
    @Param('workflowId') workflowId: WorkflowId,
  ): WorkflowMetrics | null {
    const metrics = this.metricsCollector.getWorkflowMetrics(workflowId);

    if (!metrics) {
      throw new HttpException(
        `Metrics not found for workflow ${workflowId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return metrics;
  }

  @Get('workflows/:workflowId/steps')
  @ApiOperation({
    summary: 'Get workflow step metrics',
    description: 'Returns step-by-step execution metrics for a workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to get step metrics for',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow step metrics',
    type: [Object], // StepMetrics[] would be ideal
  })
  getWorkflowStepMetrics(
    @Param('workflowId') workflowId: WorkflowId,
  ): StepMetrics[] {
    const stepMetrics = this.metricsCollector.getStepMetrics(workflowId);

    if (stepMetrics.length === 0) {
      throw new HttpException(
        `No step metrics found for workflow ${workflowId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return stepMetrics;
  }

  @Get('workflows/:workflowId/traces')
  @ApiOperation({
    summary: 'Get workflow execution traces',
    description: 'Returns distributed tracing information for a workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to get traces for',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow execution traces',
    type: [Object], // WorkflowTrace[] would be ideal
  })
  getWorkflowTraces(
    @Param('workflowId') workflowId: WorkflowId,
  ): WorkflowTrace[] {
    const traces = this.metricsCollector.getWorkflowTraces(workflowId);

    if (traces.length === 0) {
      throw new HttpException(
        `No traces found for workflow ${workflowId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return traces;
  }

  @Get('workflows/:workflowId/export')
  @ApiOperation({
    summary: 'Export all workflow metrics',
    description:
      'Exports comprehensive metrics, steps, and traces for a workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to export metrics for',
  })
  @ApiResponse({
    status: 200,
    description: 'Complete workflow metrics export',
    schema: {
      type: 'object',
      properties: {
        metrics: { type: 'object' },
        stepMetrics: { type: 'array', items: { type: 'object' } },
        traces: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  exportWorkflowMetrics(@Param('workflowId') workflowId: WorkflowId) {
    const exportData = this.metricsCollector.exportMetrics(workflowId);

    if (!exportData) {
      throw new HttpException(
        `No metrics found for workflow ${workflowId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return exportData;
  }

  @Get('organizations/:organizationId/summary')
  @ApiOperation({
    summary: 'Get organization health summary',
    description: 'Returns aggregated health metrics for an organization',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'The ID of the organization to get summary for',
  })
  @ApiQuery({
    name: 'timeRange',
    required: false,
    enum: ['1h', '6h', '24h', '7d', '30d'],
    description: 'Time range for the summary (default: 24h)',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization health summary',
    schema: {
      type: 'object',
      properties: {
        organizationId: { type: 'string' },
        timeRange: { type: 'string' },
        summary: {
          type: 'object',
          properties: {
            totalWorkflows: { type: 'number' },
            activeWorkflows: { type: 'number' },
            completedWorkflows: { type: 'number' },
            failedWorkflows: { type: 'number' },
            averageExecutionTime: { type: 'number' },
            totalAlerts: { type: 'number' },
            activeAlerts: { type: 'number' },
          },
        },
      },
    },
  })
  getOrganizationSummary(
    @Param('organizationId') organizationId: OrganizationId,
    @Query('timeRange') timeRange: string = '24h',
  ) {
    // This would need implementation to aggregate metrics by organization
    // For now, returning a basic structure
    return {
      organizationId,
      timeRange,
      summary: {
        totalWorkflows: 0,
        activeWorkflows: 0,
        completedWorkflows: 0,
        failedWorkflows: 0,
        averageExecutionTime: 0,
        totalAlerts: 0,
        activeAlerts: this.healthChecker.getActiveAlerts().length,
      },
    };
  }

  @Post('metrics/query')
  @ApiOperation({
    summary: 'Query metrics with filters',
    description: 'Execute a complex metrics query with time range and filters',
  })
  @ApiBody({
    description: 'Metrics query parameters',
    schema: {
      type: 'object',
      properties: {
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time' },
        workflowIds: { type: 'array', items: { type: 'string' } },
        organizationIds: { type: 'array', items: { type: 'string' } },
        statuses: { type: 'array', items: { type: 'string' } },
        groupBy: { type: 'array', items: { type: 'string' } },
        aggregations: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['startTime', 'endTime'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Query results',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'object' },
        results: { type: 'array', items: { type: 'object' } },
        totalCount: { type: 'number' },
        executionTime: { type: 'number' },
      },
    },
  })
  queryMetrics(@Body() query: Partial<MetricsQuery>) {
    if (!query.startTime || !query.endTime) {
      throw new HttpException(
        'startTime and endTime are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // This would need implementation for complex querying
    // For now, returning a basic structure
    return {
      query,
      results: [] as any[],
      totalCount: 0,
      executionTime: 0,
    };
  }
}
