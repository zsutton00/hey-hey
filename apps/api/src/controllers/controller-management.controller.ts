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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentMachine } from '../auth/decorators/current-machine.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MachineCredentialGuard } from '../auth/guards/machine-credential.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ControllerInventoryResponseDto,
  ControllerReconciliationResponseDto,
  ControllerRevocationRequestDto,
  ControllerRevocationResponseDto,
  ExistingMachineControllerEnrollmentRequestDto,
  MachineControllerInventoryRequestDto,
  MachineControllerReconciliationRequestDto,
  CreateMachineEnrollmentResponseDto,
} from '../generated';
import { MachineId, UserId } from '../types';
import { ControllerManagementService } from '../services/controller-management/controller-management.service';
import { AuthenticatedMachine } from '../services/machine-pairing/machine-pairing.service';

@ApiTags('Machines')
@Controller('api/v1/machines')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ControllerManagementController {
  constructor(
    private readonly controllerManagementService: ControllerManagementService,
  ) {}

  @Public()
  @UseGuards(MachineCredentialGuard)
  @Post(':machineId/controller-enrollments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open an existing-machine controller enrollment' })
  @ApiResponse({ status: 201, type: Object })
  createExistingMachineControllerEnrollment(
    @Param('machineId', new ParseUUIDPipe()) machineId: MachineId,
    @Body() body: ExistingMachineControllerEnrollmentRequestDto,
    @CurrentMachine() machine: AuthenticatedMachine,
    @Req() request: Request,
  ): Promise<CreateMachineEnrollmentResponseDto> {
    return this.controllerManagementService.createExistingMachineControllerEnrollment(
      {
        machineId,
        machine,
        input: body,
        sourceAddress: request.ip,
      },
    );
  }

  @Get(':machineId/controllers')
  @ApiOperation({ summary: 'List controllers for a paired machine' })
  @ApiResponse({ status: 200, type: Object })
  listMachineControllers(
    @Param('machineId', new ParseUUIDPipe()) machineId: MachineId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<ControllerInventoryResponseDto> {
    return this.controllerManagementService.listMachineControllers(
      userId,
      machineId,
    );
  }

  @Public()
  @UseGuards(MachineCredentialGuard)
  @Post(':machineId/controllers/inspect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inspect controller evidence locally' })
  @ApiResponse({ status: 200, type: Object })
  inspectMachineControllers(
    @Param('machineId', new ParseUUIDPipe()) machineId: MachineId,
    @Body() body: MachineControllerInventoryRequestDto,
    @CurrentMachine() machine: AuthenticatedMachine,
  ): Promise<ControllerInventoryResponseDto> {
    return this.controllerManagementService.inspectMachineControllers({
      machineId,
      machine,
      input: body,
    });
  }

  @Public()
  @UseGuards(MachineCredentialGuard)
  @Post(':machineId/controllers/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconcile controller evidence locally' })
  @ApiResponse({ status: 200, type: Object })
  reconcileMachineControllers(
    @Param('machineId', new ParseUUIDPipe()) machineId: MachineId,
    @Body() body: MachineControllerReconciliationRequestDto,
    @CurrentMachine() machine: AuthenticatedMachine,
  ): Promise<ControllerReconciliationResponseDto> {
    return this.controllerManagementService.reconcileMachineControllers({
      machineId,
      machine,
      input: body,
    });
  }

  @Delete(':machineId/controllers/:controllerCredentialId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a controller from an account session' })
  @ApiResponse({ status: 200, type: Object })
  revokeMachineController(
    @Param('machineId', new ParseUUIDPipe()) machineId: MachineId,
    @Param('controllerCredentialId') controllerCredentialId: string,
    @CurrentUser('userId') userId: UserId,
  ): Promise<ControllerRevocationResponseDto> {
    return this.controllerManagementService.revokeMachineController(
      userId,
      machineId,
      controllerCredentialId,
    );
  }

  @Public()
  @UseGuards(MachineCredentialGuard)
  @Post(':machineId/controllers/:controllerCredentialId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a controller from the paired machine' })
  @ApiResponse({ status: 200, type: Object })
  revokeMachineControllerLocally(
    @Param('machineId', new ParseUUIDPipe()) machineId: MachineId,
    @Param('controllerCredentialId') controllerCredentialId: string,
    @Body() body: ControllerRevocationRequestDto,
    @CurrentMachine() machine: AuthenticatedMachine,
  ): Promise<ControllerRevocationResponseDto> {
    return this.controllerManagementService.revokeMachineControllerLocally({
      machineId,
      controllerCredentialId,
      machine,
      input: body,
    });
  }
}
