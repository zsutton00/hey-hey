import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentMachine } from '../auth/decorators/current-machine.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MachineCredentialGuard } from '../auth/guards/machine-credential.guard';
import { Public } from '../auth/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ServerSigningKeyService } from '../core/server-signing/server-signing-key.service';
import { MachinePresenceService } from '../core/websockets/machine-presence.service';
import { WebsocketGateway } from '../core/websockets/websocket.gateway';
import {
  AuthenticatedMachine,
  MachinePairingService,
  normalizeEnrollmentSourceAddress,
} from '../services/machine-pairing/machine-pairing.service';
import { MachineExecutionReadinessService } from '../services/machine-pairing/machine-execution-readiness.service';
import { CurrentControllerMachineEligibilityService } from '../services/machine-pairing/current-controller-machine-eligibility.service';
import { ControllerBrowserBindingService } from '../services/controller-authorization/controller-browser-binding.service';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import { MachineSecurityEventService } from '../services/machine-security-events/machine-security-event.service';
import { MachineId } from '../types';
import {
  IssuePairingCodeResponseDto,
  MachineListResponseDto,
  MachinePingResponseDto,
  MachineSecurityEventListResponseDto,
  MachineSecurityEventType,
  CreateMachineEnrollmentRequestDto,
  CreateMachineEnrollmentResponseDto,
  PairingCodeStatusResponseDto,
  RegisterMachineRequestDto as GeneratedRegisterMachineRequestDto,
  RegisterMachineResponseDto,
  ReportMachineSecurityEventEntryDto as GeneratedReportMachineSecurityEventEntryDto,
  ReportMachineSecurityEventsRequestDto as GeneratedReportMachineSecurityEventsRequestDto,
  RotateMachineKeyRequestDto as GeneratedRotateMachineKeyRequestDto,
  RotateMachineKeyResponseDto,
} from '../generated';

export class RegisterMachineRequestDto
  implements GeneratedRegisterMachineRequestDto
{
  @IsString()
  @IsNotEmpty()
  publicKey!: string;

  @IsUUID()
  machineId!: string;

  @IsString()
  @IsNotEmpty()
  pairingCode!: string;
}

export class RotateMachineKeyRequestDto
  implements GeneratedRotateMachineKeyRequestDto
{
  @IsString()
  @IsNotEmpty()
  newPublicKey!: string;
}

const MACHINE_SECURITY_EVENT_TYPES = Object.values(MachineSecurityEventType);

export class ReportMachineSecurityEventEntryDto
  implements GeneratedReportMachineSecurityEventEntryDto
{
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsIn(MACHINE_SECURITY_EVENT_TYPES)
  eventType!: MachineSecurityEventType;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  detail?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: { [key: string]: unknown } | null;
}

export class ReportMachineSecurityEventsRequestDto
  implements GeneratedReportMachineSecurityEventsRequestDto
{
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReportMachineSecurityEventEntryDto)
  events!: ReportMachineSecurityEventEntryDto[];
}

@ApiTags('Machines')
@Controller('api/v1/machines')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MachineController {
  constructor(
    private readonly machinePairingService: MachinePairingService,
    private readonly machineExecutionReadinessService: MachineExecutionReadinessService,
    private readonly currentControllerMachineEligibilityService: CurrentControllerMachineEligibilityService,
    private readonly controllerBrowserBindingService: ControllerBrowserBindingService,
    private readonly serverSigningKeyService: ServerSigningKeyService,
    private readonly machineSecurityEventService: MachineSecurityEventService,
    private readonly machinePresenceService: MachinePresenceService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  /**
   * Timeout for the acknowledged reachability probe. Matches the start-run
   * ack timeout so a machine that would clear ping is the same one that would
   * clear the subsequent start-run dispatch.
   */
  private static readonly PING_TIMEOUT_MS = 4000;

  @Public()
  @Post('enrollments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a machine enrollment' })
  @ApiResponse({ status: 201, type: Object })
  async createMachineEnrollment(
    @Body() body: CreateMachineEnrollmentRequestDto,
    @Req() request: Request,
  ): Promise<CreateMachineEnrollmentResponseDto> {
    return this.machinePairingService.createMachineEnrollment(
      body,
      normalizeEnrollmentSourceAddress(request.ip),
    );
  }

  @Post('pairing-codes')
  @ApiOperation({ summary: 'Issue a machine pairing code' })
  @ApiResponse({ status: 200, type: Object })
  async issuePairingCode(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IssuePairingCodeResponseDto> {
    const { id, code, expiresAt } =
      await this.machinePairingService.issuePairingCode(user.userId);
    return {
      id,
      code,
      expiresAt: expiresAt.toISOString(),
    };
  }

  @Get('pairing-codes/:id')
  @ApiOperation({ summary: 'Read pairing code claim status' })
  @ApiResponse({ status: 200, type: Object })
  async getPairingCodeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PairingCodeStatusResponseDto> {
    const status = await this.machinePairingService.getPairingCodeStatus(
      user.userId,
      id,
    );

    return {
      state: status.state,
      machineId: status.machineId,
      label: status.label,
    };
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a paired machine' })
  @ApiResponse({ status: 200, type: Object })
  async registerMachine(
    @Body(ValidationPipe) body: RegisterMachineRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RegisterMachineResponseDto> {
    const { machineId, token } =
      await this.machinePairingService.registerMachine({
        pairingCode: body.pairingCode,
        publicKey: body.publicKey,
        machineId: body.machineId as MachineId,
        userId: user.userId,
      });

    return {
      machineId,
      token,
      serverSigningPublicKey: this.serverSigningKeyService.getPublicKeyBase64(),
    };
  }

  @Get()
  @ApiOperation({ summary: 'List paired machines' })
  @ApiResponse({ status: 200, type: Object })
  async listMachines(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<MachineListResponseDto> {
    const machines = await this.machinePairingService.listMachines(user.userId);

    const presenceResults = await Promise.all(
      machines.map((m) => this.machinePresenceService.isPresent(m.machineId)),
    );

    const bindingsResults = await Promise.all(
      machines.map((m, i) =>
        presenceResults[i]
          ? this.machinePresenceService.getBindings(m.machineId)
          : Promise.resolve(null),
      ),
    );

    const readinessResults = await Promise.all(
      machines.map((machine) =>
        this.machineExecutionReadinessService.resolve({
          machineId: machine.machineId,
          userId: user.userId,
        }),
      ),
    );

    const controllerBinding =
      await this.controllerBrowserBindingService.resolveForSelection({
        secret: readControllerBindingSecret(request),
        userId: user.userId,
      });
    const controllerEligibilityByMachine = controllerBinding
      ? await this.currentControllerMachineEligibilityService.resolveMany({
          machineIds: machines.map((machine) => machine.machineId),
          userId: user.userId,
          controllerInstallationId: controllerBinding.controllerInstallationId,
        })
      : null;
    const selectableCredentialByMachine =
      await this.currentControllerMachineEligibilityService.resolveSelectableCredentialIds(
        {
          machineIds: machines.map((machine) => machine.machineId),
          userId: user.userId,
          ...(controllerBinding
            ? {
                boundControllerCredentialId:
                  controllerBinding.controllerCredentialId,
              }
            : {}),
        },
      );

    return {
      machines: machines.map((m, i) => ({
        machineId: m.machineId,
        name: m.name,
        pairedAt: m.pairedAt.toISOString(),
        lastSeen: m.lastSeen?.toISOString() ?? null,
        revokedAt: m.revokedAt?.toISOString() ?? null,
        active: presenceResults[i]!,
        authorizationProtocolVersion: m.authorizationProtocolVersion,
        executionReadiness: readinessResults[i]!.executionReadiness,
        currentControllerEligibility:
          controllerEligibilityByMachine === null
            ? null
            : controllerEligibilityByMachine.get(m.machineId)!,
        currentControllerCredentialId:
          selectableCredentialByMachine.get(m.machineId) ?? null,
        bindings: bindingsResults[i]?.bindings ?? null,
      })),
    };
  }

  @Delete(':machineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a paired machine' })
  @ApiResponse({ status: 204 })
  async revokeMachine(
    @Param('machineId', new ParseUUIDPipe()) machineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.machinePairingService.revokeMachine(
      user.userId,
      machineId as MachineId,
    );
  }

  @Post(':machineId/ping')
  @ApiOperation({ summary: 'Probe a paired machine for live reachability' })
  @ApiResponse({ status: 200, type: Object })
  async pingMachine(
    @Param('machineId', new ParseUUIDPipe()) machineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MachinePingResponseDto> {
    // Ownership/revocation gate first: a 404 here is indistinguishable from a
    // machine that belongs to another user, so we never leak its existence.
    await this.machinePairingService.assertOwnedMachine(
      user.userId,
      machineId as MachineId,
    );

    const { acknowledged } = await this.websocketGateway.pingMachine(
      machineId,
      MachineController.PING_TIMEOUT_MS,
    );

    return { acknowledged };
  }

  // Authorized by the machine credential, NOT the user JWT — @Public() makes
  // the class-level JwtAuthGuard skip the route so MachineCredentialGuard is
  // the sole authenticator.
  @Public()
  @UseGuards(MachineCredentialGuard)
  @Post(':machineId/key-rotations')
  @ApiOperation({ summary: "Rotate a paired machine's public key" })
  @ApiResponse({ status: 200, type: Object })
  async rotateMachineKey(
    @Param('machineId', new ParseUUIDPipe()) machineId: string,
    @Body(ValidationPipe) body: RotateMachineKeyRequestDto,
    @CurrentMachine() machine: AuthenticatedMachine,
  ): Promise<RotateMachineKeyResponseDto> {
    // The credential proves which machine is calling; it may only rotate its
    // own key. A credential/path mismatch is a 401, indistinguishable from an
    // invalid credential.
    if (machine.machineId !== machineId) {
      throw new UnauthorizedException('Machine credential does not match path');
    }

    const { rotatedAt } = await this.machinePairingService.rotateMachineKey(
      machineId as MachineId,
      body.newPublicKey,
    );

    return {
      machineId,
      rotatedAt: rotatedAt.toISOString(),
    };
  }

  // Authorized by the machine credential, NOT the user JWT — same pattern as
  // key rotation. A credential whose machine does not match the path is a 401,
  // indistinguishable from an invalid credential.
  @Public()
  @UseGuards(MachineCredentialGuard)
  @Post(':machineId/security-events')
  @ApiOperation({ summary: 'Report machine security audit events' })
  @ApiResponse({ status: 200, type: Object })
  async reportMachineSecurityEvents(
    @Param('machineId', new ParseUUIDPipe()) machineId: string,
    @Body(ValidationPipe) body: ReportMachineSecurityEventsRequestDto,
    @CurrentMachine() machine: AuthenticatedMachine,
  ): Promise<MachineSecurityEventListResponseDto> {
    if (machine.machineId !== machineId) {
      throw new UnauthorizedException('Machine credential does not match path');
    }

    const events = await this.machineSecurityEventService.recordEvents({
      machineId: machineId as MachineId,
      userId: machine.userId,
      events: body.events.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        occurredAt: entry.occurredAt,
        detail: entry.detail ?? null,
        metadata: entry.metadata ?? null,
      })),
    });

    return { events };
  }

  @Get(':machineId/security-events')
  @ApiOperation({ summary: "Read a machine's security event feed" })
  @ApiResponse({ status: 200, type: Object })
  async listMachineSecurityEvents(
    @Param('machineId', new ParseUUIDPipe()) machineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MachineSecurityEventListResponseDto> {
    const events = await this.machineSecurityEventService.listEvents({
      machineId: machineId as MachineId,
      userId: user.userId,
    });

    return { events };
  }
}
