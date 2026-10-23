import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AgentSessionOutputAttentionBatchItemDto,
  AgentSessionOutputAttentionBatchRequestDto,
  AgentSessionOutputAttentionBatchResponseDto,
  AgentSessionOutputAttentionSetReadyRequestDto,
  AgentSessionOutputAttentionState,
} from 'src/generated';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { validate as isUuid } from 'uuid';
import { AgentSessionOutputAttentionService } from 'src/services/agent-session-output-attention.service';

@ApiTags('AgentSessions')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class AgentSessionOutputAttentionController {
  constructor(
    private readonly outputAttentionService: AgentSessionOutputAttentionService,
  ) {}

  @Post('output-attention\\:batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read output attention for Agent Sessions' })
  async batchRead(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() request: AgentSessionOutputAttentionBatchRequestDto,
  ): Promise<AgentSessionOutputAttentionBatchResponseDto> {
    const agentSessionIds = Array.isArray(request?.agentSessionIds)
      ? request.agentSessionIds
      : request?.agentSessionIds instanceof Set
        ? Array.from(request.agentSessionIds)
        : [];
    const uniqueIds = new Set(agentSessionIds);
    if (
      agentSessionIds.length < 1 ||
      agentSessionIds.length > 100 ||
      uniqueIds.size !== agentSessionIds.length ||
      agentSessionIds.some((agentSessionId) => !isUuid(agentSessionId))
    ) {
      throw new BadRequestException(
        'agentSessionIds must contain 1 to 100 unique UUID values',
      );
    }
    const items = await this.outputAttentionService.readAuthorized(
      organizationId,
      projectId,
      userId,
      agentSessionIds,
    );
    return { items } satisfies AgentSessionOutputAttentionBatchResponseDto;
  }

  @Post(':agentSessionId/output-attention\\:ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark committed Agent Session output ready' })
  async setReady(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() request: AgentSessionOutputAttentionSetReadyRequestDto,
  ): Promise<AgentSessionOutputAttentionBatchItemDto> {
    if (request?.state !== AgentSessionOutputAttentionState.MessageReady) {
      throw new BadRequestException('state must be MESSAGE_READY');
    }
    return this.outputAttentionService.setReady(
      organizationId,
      projectId,
      userId,
      agentSessionId,
    );
  }

  @Post(':agentSessionId/output-attention\\:acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge opening an Agent Session' })
  async acknowledge(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<AgentSessionOutputAttentionBatchItemDto> {
    return this.outputAttentionService.acknowledge(
      organizationId,
      projectId,
      userId,
      agentSessionId,
    );
  }
}
