import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentMachine } from '../auth/decorators/current-machine.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { MachineCredentialGuard } from '../auth/guards/machine-credential.guard';
import {
  SubmitSessionMonitorDecisionRequestDto,
  SubmitSessionMonitorDecisionResponseDto,
} from '../generated';
import type { AuthenticatedMachine } from '../services/machine-pairing/machine-pairing.service';
import { SessionMonitorDecisionService } from '../services/session-monitor-decision/session-monitor-decision.service';
import { AgentSessionId, OrganizationId, ProjectId } from '../types';

@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId/session-monitor-decisions',
)
export class SessionMonitorDecisionController {
  constructor(
    private readonly sessionMonitorDecisionService: SessionMonitorDecisionService,
  ) {}

  @Post()
  submit(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @Body() input: SubmitSessionMonitorDecisionRequestDto,
    @CurrentMachine() authenticatedMachine: AuthenticatedMachine,
    @Req() request: Request,
  ): Promise<SubmitSessionMonitorDecisionResponseDto> {
    return this.sessionMonitorDecisionService.submit({
      organizationId,
      projectId,
      monitorSessionId: agentSessionId,
      authenticatedMachine,
      requestPath: request.originalUrl,
      input,
    });
  }
}
