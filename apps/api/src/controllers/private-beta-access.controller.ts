import type { Request } from 'express';
import { extractBrowserSessionRequestMetadata } from '../auth/browser-session-request-metadata';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import type {
  PrivateBetaAccessRequestAcceptedResponseDto,
  PrivateBetaAccessRequestSubmissionDto,
  PublicPrivateBetaAdmissionModeDto,
} from '../generated';
import { PrivateBetaAccessService } from '../services/private-beta-access.service';
import { PrivateBetaAccessProgramService } from '../services/private-beta-access-program.service';

const PUBLIC_SUBMISSION_LIMIT = 5;
const PUBLIC_SUBMISSION_TTL_MS = 60 * 60 * 1000;

@ApiTags('Private Beta Access')
@Controller('api/v1')
export class PrivateBetaAccessController {
  private readonly logger = new Logger(PrivateBetaAccessController.name);

  constructor(
    private readonly privateBetaAccessService: PrivateBetaAccessService,
    private readonly privateBetaAccessProgramService: PrivateBetaAccessProgramService,
  ) {}

  @Get('private-beta-access/admission-mode')
  @Public()
  @ApiOperation({ summary: 'Get public admission mode' })
  async getAdmissionMode(): Promise<PublicPrivateBetaAdmissionModeDto> {
    const { mode } =
      await this.privateBetaAccessProgramService.getSelfServiceAdmissionMode();
    return { mode } satisfies PublicPrivateBetaAdmissionModeDto;
  }

  @Post('private-beta/access-requests')
  @Public()
  @Throttle({
    default: {
      limit: PUBLIC_SUBMISSION_LIMIT,
      ttl: PUBLIC_SUBMISSION_TTL_MS,
    },
  })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a beta signup',
    description:
      'Public intake that validates, normalizes, and durably records a request before returning a generic accepted response.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Signup durably received.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request.',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Public intake rate limit exceeded.',
  })
  async submit(
    @Body() input: PrivateBetaAccessRequestSubmissionDto,
    @Req() request: Request,
  ): Promise<PrivateBetaAccessRequestAcceptedResponseDto> {
    this.logger.debug('Private-beta public authorization exemption granted', {
      throttleBoundary: 'passed',
      throttleLimit: PUBLIC_SUBMISSION_LIMIT,
      throttleTtlMs: PUBLIC_SUBMISSION_TTL_MS,
    });

    return this.privateBetaAccessService.submit(
      input,
      extractBrowserSessionRequestMetadata(request),
    );
  }
}
