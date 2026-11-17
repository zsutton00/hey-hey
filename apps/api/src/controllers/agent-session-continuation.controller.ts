import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { validate as isUuid } from 'uuid';
import { z } from 'zod';
import {
  AgentSessionContinuationStartupOutcome,
  type AgentSessionContinuationDto,
  type AgentSessionContinuationStartupReport,
  type AgentSessionContinuationStartupReportResponseDto,
  type AgentSessionContinuationStatusDto,
  type CommitAgentSessionContinuationRequestDto,
  type InspectAgentSessionContinuationRequestDto,
} from '@hey-hey/contracts/api/models';
import { CurrentMachine } from '../auth/decorators/current-machine.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MachineCredentialGuard } from '../auth/guards/machine-credential.guard';
import type { AuthenticatedMachine } from '../services/machine-pairing/machine-pairing.service';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import { AgentSessionContinuationService } from '../services/agent-session-continuation/agent-session-continuation.service';
import { AgentSessionId, OrganizationId, ProjectId, UserId } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Boundary shape checks for fields the services consume directly; the
// authorization object is validated by controller-authorization admission.
function parseInspectRequest(
  body: unknown,
): InspectAgentSessionContinuationRequestDto {
  if (
    !isRecord(body) ||
    typeof body.expectedSourceMachineId !== 'string' ||
    !isUuid(body.expectedSourceMachineId) ||
    typeof body.destinationMachineId !== 'string' ||
    !isUuid(body.destinationMachineId) ||
    !isRecord(body.authorization)
  ) {
    throw new BadRequestException({
      code: 'CONTINUATION_REQUEST_INVALID',
      message: 'The continuation inspection request is malformed.',
    });
  }
  return body as unknown as InspectAgentSessionContinuationRequestDto;
}

function parseCommitRequest(
  body: unknown,
): CommitAgentSessionContinuationRequestDto {
  if (
    !isRecord(body) ||
    typeof body.confirmSavedHistory !== 'boolean' ||
    !isRecord(body.authorization)
  ) {
    throw new BadRequestException({
      code: 'CONTINUATION_REQUEST_INVALID',
      message: 'The continuation commit request is malformed.',
    });
  }
  return body as unknown as CommitAgentSessionContinuationRequestDto;
}

const REASON_REQUIRED: readonly AgentSessionContinuationStartupOutcome[] = [
  AgentSessionContinuationStartupOutcome.NativeResumeRejected,
  AgentSessionContinuationStartupOutcome.Failed,
];

// Mirrors AgentSessionContinuationStartupReport in the OpenAPI spec.
const startupReportSchema = z
  .object({
    deliveryOperationId: z.string().uuid(),
    outcome: z.nativeEnum(AgentSessionContinuationStartupOutcome),
    reasonCode: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    detail: z.string().max(500).optional(),
  })
  .strict()
  .refine(
    (report) =>
      !REASON_REQUIRED.includes(report.outcome) ||
      report.reasonCode !== undefined,
    {
      message: 'reasonCode is required for this outcome',
      path: ['reasonCode'],
    },
  );

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class AgentSessionContinuationController {
  constructor(
    private readonly continuations: AgentSessionContinuationService,
  ) {}

  @Get('continuation')
  getStatus(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<AgentSessionContinuationStatusDto> {
    return this.continuations.getStatus({
      organizationId,
      projectId,
      userId,
      agentSessionId,
    });
  }

  @Post('continuations/:continuationId/inspection')
  @HttpCode(200)
  @UseGuards(ControllerBindingOriginGuard)
  inspect(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @Param('continuationId', ParseUUIDPipe) continuationId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ): Promise<AgentSessionContinuationDto> {
    return this.continuations.inspect({
      organizationId,
      projectId,
      userId,
      agentSessionId,
      continuationId,
      request: parseInspectRequest(body),
      controllerBindingSecret: readControllerBindingSecret(httpRequest),
    });
  }

  @Post('continuations/:continuationId/commit')
  @HttpCode(200)
  @UseGuards(ControllerBindingOriginGuard)
  commit(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @Param('continuationId', ParseUUIDPipe) continuationId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ): Promise<AgentSessionContinuationDto> {
    return this.continuations.commit({
      organizationId,
      projectId,
      userId,
      agentSessionId,
      continuationId,
      request: parseCommitRequest(body),
      controllerBindingSecret: readControllerBindingSecret(httpRequest),
    });
  }

  @Post('continuations/:continuationId/cancel')
  @HttpCode(200)
  cancel(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @Param('continuationId', ParseUUIDPipe) continuationId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<AgentSessionContinuationDto> {
    return this.continuations.cancel({
      organizationId,
      projectId,
      userId,
      agentSessionId,
      continuationId,
    });
  }
}

/** The destination computer reports provider startup under its own machine credential. */
@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId/continuations/:continuationId/startup',
)
export class MachineAgentSessionContinuationController {
  constructor(
    private readonly continuations: AgentSessionContinuationService,
  ) {}

  @Post()
  @HttpCode(200)
  async reportStartup(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @Param('continuationId', ParseUUIDPipe) continuationId: string,
    @CurrentMachine() machine: AuthenticatedMachine,
    @Body() body: unknown,
  ): Promise<AgentSessionContinuationStartupReportResponseDto> {
    const parsed = startupReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'CONTINUATION_STARTUP_REPORT_INVALID',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
    }
    return this.continuations.recordStartup({
      organizationId,
      projectId,
      agentSessionId,
      continuationId,
      machine,
      report: parsed.data satisfies AgentSessionContinuationStartupReport,
    });
  }
}
