import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { extractBrowserSessionRequestMetadata } from '../auth/browser-session-request-metadata';
import type {
  PrivateBetaAccessRequestDecisionInputDto,
  PrivateBetaAccessRequestDecisionResultDto,
} from '../generated';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { PrivateBetaAccessRequestId } from '../types';
import { PrivateBetaAccessDecisionService } from '../services/private-beta-access-decision.service';
import { PrivateBetaAccessRequestDecisionPipe } from '../pipes/private-beta-access-request-decision.pipe';

@ApiTags('Private Beta Access')
@ApiBearerAuth()
@Controller('api/v1/admin/private-beta-access-requests')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PrivateBetaAccessDecisionController {
  private readonly logger = new Logger(
    PrivateBetaAccessDecisionController.name,
  );

  constructor(
    private readonly privateBetaAccessDecisionService: PrivateBetaAccessDecisionService,
  ) {}

  @Post(':requestId/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve or reject one private-beta access request',
    description:
      'Admin-only authenticated decision for one durably stored private-beta access request.',
  })
  @ApiParam({
    name: 'requestId',
    type: 'string',
    format: 'uuid',
    description: 'Stable UUID of the private-beta access request.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Decision recorded or replayed with its persisted outcome.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing or invalid decision input or request identity.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid bearer authentication.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Admin access required.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Private-beta access request not found.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Decision conflicts with the request current state.',
  })
  async decide(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(PrivateBetaAccessRequestDecisionPipe)
    input: PrivateBetaAccessRequestDecisionInputDto,
    @Req() request: Request,
  ): Promise<PrivateBetaAccessRequestDecisionResultDto> {
    const user = request.user as AuthenticatedUser;
    this.logger.debug('Private-beta decision request entered controller', {
      requestId,
      operatorId: user.userId,
      decision: input.decision,
    });

    const result = await this.privateBetaAccessDecisionService.decide(
      requestId as PrivateBetaAccessRequestId,
      input,
      user.userId,
      extractBrowserSessionRequestMetadata(request),
    );

    this.logger.debug('Private-beta decision delegation completed', {
      requestId,
      operatorId: user.userId,
      decision: result.decision,
      status: result.status,
      hasProvisioningOutcome: result.provisioningOutcome !== null,
    });
    return result;
  }
}
