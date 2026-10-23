import { UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  WorkflowTimelineService,
  TimelineResult,
} from '../services/workflow-timeline.service';

@ApiTags('workflows')
@UseGuards(AdminGuard)
@Controller('api/v1/workflows')
export class WorkflowTimelineController {
  private readonly logger = new Logger(WorkflowTimelineController.name);

  constructor(private readonly timelineService: WorkflowTimelineService) {}

  @Get(':workflowId/timeline')
  @ApiOperation({
    summary: 'Get workflow execution timeline',
    description:
      'Retrieves a structured timeline of workflow execution from Elasticsearch logs, showing all nodes, steps, and events.',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The workflow ID to retrieve the timeline for',
    example: '74982eb5-de4b-46e5-94e0-9316946e12ff',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Start date for log filtering (ISO 8601)',
    example: '2025-10-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'End date for log filtering (ISO 8601)',
    example: '2025-10-01T23:59:59Z',
  })
  @ApiQuery({
    name: 'index',
    required: false,
    description: 'Elasticsearch index pattern to search',
    example: 'logstash-*',
  })
  @ApiQuery({
    name: 'maxResults',
    required: false,
    description: 'Maximum number of log entries to retrieve',
    example: 10000,
  })
  @ApiQuery({
    name: 'saveToFile',
    required: false,
    description: 'Save raw logs to file for debugging',
    example: false,
  })
  @ApiOkResponse({
    description: 'Workflow timeline retrieved successfully',
    schema: {
      $ref: '#/components/schemas/WorkflowTimelineDto',
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve workflow timeline',
  })
  async getWorkflowTimeline(
    @Param('workflowId') workflowId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('index') index?: string,
    @Query('maxResults') maxResults?: string,
    @Query('saveToFile') saveToFile?: string,
  ): Promise<TimelineResult> {
    this.logger.log(`Retrieving timeline for workflow ${workflowId}`);

    const options = {
      ...(from ? { from: new Date(from) } : {}),
      ...(to ? { to: new Date(to) } : {}),
      ...(index ? { index } : {}),
      ...(maxResults ? { maxResults: parseInt(maxResults, 10) } : {}),
      ...(saveToFile === 'true' ? { saveToFile: true } : {}),
    };

    const timeline = await this.timelineService.buildTimelineForWorkflow(
      workflowId,
      options,
    );

    this.logger.log(
      `Retrieved timeline for workflow ${workflowId}: ` +
        `${timeline.stats.totalEntries} entries, ${timeline.nodes.length} nodes`,
    );

    return timeline;
  }
}
