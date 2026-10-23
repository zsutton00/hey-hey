import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { QueueName } from 'src/core/events/types/event.types';
import { OrganizationId } from 'src/types';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  IJobEnqueuer,
  ArtifactGenerationJobData,
} from '../services/interfaces/job-enqueuer.interface';
import { JOB_ENQUEUER_TOKEN } from '../services/job.tokens';
import { ExecutionContext } from 'src/types/execution-context';

@ApiTags('Queue Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('organizations/:organizationId/queues')
export class QueueController {
  constructor(@Inject(JOB_ENQUEUER_TOKEN) private jobEnqueuer: IJobEnqueuer) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get queue statistics for organization' })
  @ApiResponse({ status: 200, description: 'Queue statistics' })
  async getQueueStats(@CurrentOrganization() organizationId: OrganizationId) {
    return this.jobEnqueuer.getQueueStats(organizationId);
  }

  @Post('artifacts/generate')
  @ApiOperation({ summary: 'Queue an artifact generation job' })
  @ApiResponse({ status: 201, description: 'Job queued successfully' })
  async queueArtifactGeneration(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: ArtifactGenerationJobData,
  ) {
    const context: ExecutionContext = {
      organizationId,
      userId: user.userId,
      projectId: data.projectId,
    };

    return this.jobEnqueuer.queueArtifactGeneration(data, context);
  }

  @Post(':queueName/jobs/:jobId/retry')
  @ApiOperation({ summary: 'Retry a failed job' })
  @ApiResponse({ status: 200, description: 'Job retry initiated' })
  async retryJob(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: string,
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    if (!['artifacts', 'llm'].includes(queueName)) {
      throw new BadRequestException(
        'Invalid queue name. Must be "artifacts" or "llm"',
      );
    }

    await this.jobEnqueuer.retryJob(
      queueName as QueueName,
      jobId,
      organizationId,
      userId,
    );
    return { message: 'Job retry initiated', jobId, queueName };
  }
}
