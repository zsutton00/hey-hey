import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  AbandonMachineEnrollmentClaimRequestDto,
  AbandonMachineEnrollmentClaimResponseDto,
  BeginMachineEnrollmentClaimRequestDto,
  BeginMachineEnrollmentClaimResponseDto,
  CompleteMachineEnrollmentClaimRequestDto,
  CompleteMachineEnrollmentClaimResponseDto,
} from '../generated';
import { MachineEnrollmentClaimService } from '../services/machine-pairing/machine-enrollment-claim.service';
import {
  readControllerBindingSecret,
  ControllerBindingCookieService,
} from '../services/controller-authorization/controller-binding-cookie.service';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';

@ApiTags('Machines')
@Controller('api/v1/machines/enrollments/claim')
@UseGuards(JwtAuthGuard, ControllerBindingOriginGuard)
@ApiBearerAuth()
export class MachineEnrollmentClaimController {
  constructor(
    private readonly machineEnrollmentClaimService: MachineEnrollmentClaimService,
    private readonly controllerBindingCookieService: ControllerBindingCookieService,
  ) {}

  @Post('begin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Begin a machine enrollment claim' })
  @ApiResponse({ status: 200, type: Object })
  async beginClaim(
    @Body() body: BeginMachineEnrollmentClaimRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BeginMachineEnrollmentClaimResponseDto> {
    const result = await this.machineEnrollmentClaimService.beginClaim(
      body,
      user.userId,
      user.orgMemberships,
      request.ip,
      { email: user.email, name: user.name },
    );
    const context =
      await this.machineEnrollmentClaimService.ensureBrowserContext(
        readControllerBindingSecret(request),
        user.userId,
      );
    this.controllerBindingCookieService.set(
      response,
      context.secret,
      context.expiresAt,
    );
    if (result.state === 'awaiting-machine-confirmation') {
      const binding =
        await this.machineEnrollmentClaimService.issueBrowserBindingForAwaitingConfirmation(
          {
            enrollmentId: result.enrollmentId,
            controllerBindingSecret: context.secret,
            userId: user.userId,
            organizationId: result.organizationId,
          },
        );
      this.controllerBindingCookieService.set(
        response,
        binding.secret,
        binding.expiresAt,
      );
    }
    return result;
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a machine enrollment claim' })
  @ApiResponse({ status: 200, type: Object })
  async completeClaim(
    @Body() body: CompleteMachineEnrollmentClaimRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CompleteMachineEnrollmentClaimResponseDto> {
    const result = await this.machineEnrollmentClaimService.completeClaim(
      body,
      user.userId,
      user.orgMemberships,
      request.ip,
    );
    const binding =
      await this.machineEnrollmentClaimService.issueBrowserBindingForAwaitingConfirmation(
        {
          enrollmentId: result.enrollmentId,
          controllerBindingSecret: readControllerBindingSecret(request),
          userId: user.userId,
          organizationId: result.organizationId,
        },
      );
    this.controllerBindingCookieService.set(
      response,
      binding.secret,
      binding.expiresAt,
    );
    return result;
  }

  @Post('abandon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abandon a machine enrollment claim' })
  @ApiResponse({ status: 200, type: Object })
  async abandonClaim(
    @Body() body: AbandonMachineEnrollmentClaimRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AbandonMachineEnrollmentClaimResponseDto> {
    return this.machineEnrollmentClaimService.abandonClaim(
      body,
      user.userId,
      user.orgMemberships,
    );
  }
}
