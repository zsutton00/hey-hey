import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentMachine } from '../auth/decorators/current-machine.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { MachineCredentialGuard } from '../auth/guards/machine-credential.guard';
import {
  MessageExecutionStatus,
  InputCancellationRequest,
  InputExecutionProjection,
} from '../generated';
import { InputExecutionProjectionService } from '../services/agent-operation/input-execution-projection.service';
import type { AuthenticatedMachine } from '../services/machine-pairing/machine-pairing.service';
import type { OrganizationId, ProjectId, UserId } from '../types';

const cancellationSchema = z
  .object({ agentSessionId: z.string().uuid(), messageId: z.string().uuid() })
  .strict();
const projectionSchema = z
  .object({
    operationId: z.string().uuid(),
    operationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    messageId: z.string().uuid(),
    admissionId: z.string().uuid(),
    revision: z.number().int().min(1),
    executionStatus: z.nativeEnum(MessageExecutionStatus),
    turnId: z.string().uuid().optional(),
  })
  .strict();

@UseGuards(OrganizationGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId')
export class InputExecutionController {
  constructor(private readonly inputs: InputExecutionProjectionService) {}
  @Post('agent-operations/:operationId/input-cancellation')
  @HttpCode(200)
  cancel(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ) {
    const parsed = cancellationSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Invalid input cancellation request.');
    return this.inputs.cancel(
      organizationId,
      projectId,
      userId,
      operationId,
      parsed.data as InputCancellationRequest,
    );
  }
  @Get('conversations/:conversationId/queued-inputs')
  queued(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser('userId') userId: UserId,
  ) {
    return this.inputs.queued(
      organizationId,
      projectId,
      userId,
      conversationId,
    );
  }
}

@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions/:agentSessionId/input-execution',
)
export class MachineInputExecutionController {
  constructor(private readonly inputs: InputExecutionProjectionService) {}
  @Post()
  @HttpCode(200)
  project(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @CurrentMachine() machine: AuthenticatedMachine,
    @Body() body: unknown,
  ) {
    const parsed = projectionSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Invalid input execution projection.');
    return this.inputs.project(
      organizationId,
      projectId,
      agentSessionId,
      machine,
      parsed.data as InputExecutionProjection,
    );
  }
}
