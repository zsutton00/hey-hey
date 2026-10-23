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
  AgentSessionCurrentStateBatchRequestDto,
  AgentSessionCurrentStateBatchResponseDto,
} from 'src/generated';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { CurrentOrganization } from 'src/auth/decorators/current-user.decorator';
import { OrganizationId, ProjectId } from 'src/types';
import { validate as isUuid } from 'uuid';
import { AgentSessionCurrentStateReadService } from 'src/services/agent-session-current-state-read.service';

@ApiTags('AgentSessions')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class AgentSessionCurrentStateController {
  constructor(
    private readonly currentStateReadService: AgentSessionCurrentStateReadService,
  ) {}

  @Post('current-state\\:batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read current state for authorized Agent Sessions' })
  async batchReadCurrentState(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() request: AgentSessionCurrentStateBatchRequestDto,
  ): Promise<AgentSessionCurrentStateBatchResponseDto> {
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

    const items = await this.currentStateReadService.readAuthorized(
      organizationId,
      projectId,
      agentSessionIds,
    );
    return { items } satisfies AgentSessionCurrentStateBatchResponseDto;
  }
}
