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
  SubmitExternalAgentCompletionRequestDto,
  SubmitExternalAgentCompletionResponseDto,
} from '../generated';
import { ExternalAgentCompletionService } from '../services/external-agent-completion/external-agent-completion.service';
import type { AuthenticatedMachine } from '../services/machine-pairing/machine-pairing.service';
import { AgentSessionId, OrganizationId, ProjectId } from '../types';

@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId/external-agent-completions',
)
export class ExternalAgentCompletionController {
  public constructor(
    private readonly externalAgentCompletionService: ExternalAgentCompletionService,
  ) {}

  @Post()
  public submit(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @Body() input: SubmitExternalAgentCompletionRequestDto,
    @CurrentMachine() authenticatedMachine: AuthenticatedMachine,
    @Req() request: Request,
  ): Promise<SubmitExternalAgentCompletionResponseDto> {
    return this.externalAgentCompletionService.submit({
      organizationId,
      projectId,
      agentSessionId,
      authenticatedMachine,
      requestPath: request.originalUrl,
      input,
    });
  }
}
