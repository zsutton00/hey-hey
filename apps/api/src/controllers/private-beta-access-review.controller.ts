import {
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { PrivateBetaAccessRequestReviewDto } from '../generated';
import type { PrivateBetaAccessRequestId } from '../types';
import { PrivateBetaAccessReviewService } from '../services/private-beta-access-review.service';

@ApiTags('Private Beta Access')
@ApiBearerAuth()
@Controller('api/v1/admin/private-beta-access-requests')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PrivateBetaAccessReviewController {
  private readonly logger = new Logger(PrivateBetaAccessReviewController.name);

  constructor(
    private readonly privateBetaAccessReviewService: PrivateBetaAccessReviewService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Discover private-beta access requests',
    description:
      'Admin-only authenticated read of durably stored private-beta access requests available for manual review.',
  })
  @ApiResponse({
    status: 200,
    description: 'Private-beta access request reviews retrieved successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid authentication.',
  })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  async findMany(): Promise<PrivateBetaAccessRequestReviewDto[]> {
    this.logger.debug('Private-beta review collection entered controller', {
      authorization: 'jwt-admin',
    });
    const reviews = await this.privateBetaAccessReviewService.findMany();
    this.logger.debug('Private-beta review collection delegation completed', {
      requestCount: reviews.length,
    });
    return reviews;
  }

  @Get(':requestId')
  @ApiOperation({
    summary: 'Review one private-beta access request',
    description:
      'Admin-only authenticated read of one durably stored private-beta access request.',
  })
  @ApiParam({
    name: 'requestId',
    type: 'string',
    format: 'uuid',
    description: 'Stable UUID of the private-beta access request.',
  })
  @ApiResponse({
    status: 200,
    description: 'Private-beta access request review retrieved successfully.',
  })
  @ApiResponse({ status: 400, description: 'Malformed request identity.' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid authentication.',
  })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({
    status: 404,
    description: 'Private-beta access request not found.',
  })
  async findOne(
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<PrivateBetaAccessRequestReviewDto> {
    this.logger.debug('Private-beta review request entered controller', {
      requestId,
      authorization: 'jwt-admin',
    });
    this.logger.debug('Private-beta review delegating to review service', {
      requestId,
    });
    const review = await this.privateBetaAccessReviewService.findOne(
      requestId as PrivateBetaAccessRequestId,
    );
    this.logger.debug('Private-beta review service delegation completed', {
      requestId,
      status: review.status,
      hasProvisioningOutcome: review.provisioningOutcome !== null,
    });
    return review;
  }
}
