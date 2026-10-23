import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import { CurrentMachine } from '../auth/decorators/current-machine.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { MachineCredentialGuard } from '../auth/guards/machine-credential.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserId } from '../types';
import type {
  AgentInteractionAdmissionRequest,
  AgentInteractionSettledTurn,
} from '../generated';
import type { AuthenticatedMachine } from '../services/machine-pairing/machine-pairing.service';
import { AgentInteractionAdmissionService } from '../services/agent-interaction/agent-interaction-admission.service';
import {
  parseAgentInteractionAdmission,
  parseAgentInteractionSettlement,
  parseTurnAdmissionClaim,
  parseTurnAdmissionSettlement,
  parseSubagentInteractionAdmission,
  parseSubagentDispatchHeartbeat,
  parseSubagentSettledAttempt,
  parseSubagentCancellation,
  parseSessionMessageInteractionAdmission,
} from '../services/agent-interaction/agent-interaction-boundary.schema';

@UseGuards(OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-interactions',
)
export class AgentInteractionReadController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Get(':interactionId')
  public get(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('interactionId', ParseUUIDPipe) interactionId: string,
    @CurrentUser('userId') userId: UserId,
  ) {
    return this.admission.getOwnedInteraction({
      organizationId,
      projectId,
      interactionId,
      userId,
    });
  }

  @Post(':interactionId/cancel')
  public async cancel(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('interactionId', ParseUUIDPipe) interactionId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<{ accepted: boolean }> {
    const { expectedRevision } = parseSubagentCancellation(body);
    return {
      accepted: await this.admission.cancelOwnedSubagent({
        organizationId,
        projectId,
        interactionId,
        userId,
        expectedRevision,
      }),
    };
  }
}

@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/subagent-dispatches',
)
export class SubagentDispatchController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Post('claim')
  public async claim(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentMachine() machine: AuthenticatedMachine,
  ) {
    const dispatch = await this.admission.claimSubagentDispatch({
      organizationId,
      projectId,
      machine,
    });
    const foregroundWaits = await this.admission.listMachineForegroundWaits({
      organizationId,
      projectId,
      machine,
    });
    return dispatch
      ? { claimed: true, dispatch, foregroundWaits }
      : { claimed: false, foregroundWaits };
  }

  @Post(':effectId/heartbeat')
  public async heartbeat(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('effectId', ParseUUIDPipe) effectId: string,
    @CurrentMachine() machine: AuthenticatedMachine,
    @Body() body: unknown,
  ): Promise<{ accepted: boolean }> {
    const { leaseToken } = parseSubagentDispatchHeartbeat(body);
    return {
      accepted: await this.admission.heartbeatSubagentDispatch({
        organizationId,
        projectId,
        effectId,
        machine,
        leaseToken,
      }),
    };
  }

  @Post(':effectId/settlement')
  public async settle(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('effectId', ParseUUIDPipe) effectId: string,
    @CurrentMachine() machine: AuthenticatedMachine,
    @Body() body: unknown,
  ): Promise<{ accepted: boolean }> {
    return {
      accepted: await this.admission.settleSubagentDispatch({
        organizationId,
        projectId,
        effectId,
        machine,
        evidence: parseSubagentSettledAttempt(body),
      }),
    };
  }
}

@Public()
@UseGuards(MachineCredentialGuard)
@Controller('api/v1/subagent-dispatches')
export class SubagentDispatchScopesController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Get('scopes')
  public async list(@CurrentMachine() machine: AuthenticatedMachine) {
    return { scopes: await this.admission.listMachineDispatchScopes(machine) };
  }
}

@UseGuards(OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId/subagent-interactions',
)
export class SubagentInteractionController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Post()
  @UseGuards(ControllerBindingOriginGuard)
  public request(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('agentSessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
    @Req() httpRequest?: Request,
  ) {
    return this.admission.requestSubagent({
      organizationId,
      projectId,
      sessionId,
      userId,
      controllerBindingSecret: readControllerBindingSecret(httpRequest),
      request: parseSubagentInteractionAdmission(body),
    });
  }
}

@UseGuards(OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId/session-message-interactions',
)
export class SessionMessageInteractionController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Post()
  public request(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('agentSessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ) {
    return this.admission.requestSessionMessage({
      organizationId,
      projectId,
      sessionId,
      userId,
      request: parseSessionMessageInteractionAdmission(body),
    });
  }
}

@Public()
@UseGuards(MachineCredentialGuard)
@Controller('api/v1/session-message-targets')
export class SessionMessageTargetController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Get()
  public async list(@CurrentMachine() machine: AuthenticatedMachine) {
    return { targets: await this.admission.listSessionMessageTargets(machine) };
  }
}

@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-interactions',
)
export class AgentInteractionController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Post()
  public admit(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
    @CurrentMachine() machine: AuthenticatedMachine,
  ) {
    const request: AgentInteractionAdmissionRequest =
      parseAgentInteractionAdmission(body);
    return this.admission.admitInteraction({
      organizationId,
      projectId,
      machine,
      request,
    });
  }

  @Post(':interactionId/settled-turns')
  public async settle(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('interactionId', ParseUUIDPipe) interactionId: string,
    @Body() body: unknown,
    @CurrentMachine() machine: AuthenticatedMachine,
  ): Promise<{ accepted: boolean }> {
    const evidence: AgentInteractionSettledTurn =
      parseAgentInteractionSettlement(body);
    if (evidence.interactionId !== interactionId) return { accepted: false };
    return {
      accepted: await this.admission.settleTurn({
        organizationId,
        projectId,
        machine,
        evidence,
      }),
    };
  }
}

@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId/turn-admissions',
)
export class AgentSessionTurnAdmissionController {
  public constructor(
    private readonly admission: AgentInteractionAdmissionService,
  ) {}

  @Post('head:claim')
  public async claimHead(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('agentSessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: unknown,
    @CurrentMachine() machine: AuthenticatedMachine,
  ) {
    const { turnId, admissionId } = parseTurnAdmissionClaim(body);
    const claimed = await this.admission.occupyHead({
      organizationId,
      projectId,
      sessionId,
      turnId,
      admissionId,
      machine,
    });
    return claimed ? { claimed: true, admission: claimed } : { claimed: false };
  }

  @Post(':admissionId/settled-turns')
  public async settle(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('agentSessionId', ParseUUIDPipe) sessionId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() body: unknown,
    @CurrentMachine() machine: AuthenticatedMachine,
  ): Promise<{ accepted: boolean }> {
    const evidence = parseTurnAdmissionSettlement(body);
    if (
      evidence.admissionId !== admissionId ||
      evidence.agentSessionId !== sessionId
    ) {
      return { accepted: false };
    }
    return {
      accepted: await this.admission.settleOrdinaryTurn({
        organizationId,
        projectId,
        machine,
        evidence,
      }),
    };
  }
}
