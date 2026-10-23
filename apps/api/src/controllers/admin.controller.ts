import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  Body,
  Req,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { extractBrowserSessionRequestMetadata } from '../auth/browser-session-request-metadata';
import { OnboardBetaUserDto, OnboardBetaUserResponseDto } from '../generated';
import { BetaOnboardingService } from '../services/beta-onboarding.service';
import { OrganizationService } from '../services/organization.service';
import { OrganizationId } from '../types';

@ApiTags('Admin')
@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private betaOnboardingService: BetaOnboardingService,
    private organizationService: OrganizationService,
  ) {}

  @Post('onboard-beta-user')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Onboard a beta user' })
  @ApiResponse({
    status: 201,
    description: 'Beta user onboarded successfully',
  })
  @ApiResponse({ status: 400, description: 'Missing required field' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async onboardBetaUser(
    @Body() dto: OnboardBetaUserDto,
    @Req() request: Request,
  ): Promise<OnboardBetaUserResponseDto> {
    if (!dto.email?.trim()) {
      throw new BadRequestException('email is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!dto.organizationName?.trim()) {
      throw new BadRequestException('organizationName is required');
    }
    return this.betaOnboardingService.onboardBetaUser(
      {
        email: dto.email,
        name: dto.name,
        organizationName: dto.organizationName,
      },
      extractBrowserSessionRequestMetadata(request),
    );
  }

  @Delete('organizations/:organizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an organization (admin only)',
    description:
      'Soft-deletes by default (sets isActive=false). Pass ?hard=true to permanently purge all data — intended for cleaning up test/beta organizations.',
  })
  @ApiQuery({
    name: 'hard',
    required: false,
    type: Boolean,
    description: 'When true, permanently deletes all organization data',
  })
  @ApiResponse({ status: 204, description: 'Organization deleted' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async deleteOrganization(
    @Param('organizationId') organizationId: OrganizationId,
    @Query('hard') hard?: string,
  ): Promise<void> {
    const isHard = hard === 'true';
    if (isHard) {
      await this.organizationService.purgeOrganization(organizationId);
    } else {
      await this.organizationService.deactivateOrganization(organizationId);
    }
  }
}
