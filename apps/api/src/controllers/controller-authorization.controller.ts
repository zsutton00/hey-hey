import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import {
  PrepareControllerAuthorizationRequestDto,
  PrepareControllerAuthorizationResponseDto,
  ResolveControllerAuthorizationRequestDto,
  ResolveControllerAuthorizationResponseDto,
  SubmitControllerAuthorizedActionRequestDto,
  SubmitControllerAuthorizedActionResponseDto,
} from '../generated';
import { ControllerAuthorizationService } from '../services/controller-authorization/controller-authorization.service';
import {
  ControllerBindingCookieService,
  readControllerBindingSecret,
} from '../services/controller-authorization/controller-binding-cookie.service';
import { OrganizationId, ProjectId, UserId } from '../types';
import type { Request, Response } from 'express';

@ApiTags('Controller Authorization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard, ControllerBindingOriginGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/controller-authorizations',
)
export class ControllerAuthorizationController {
  constructor(
    private readonly controllerAuthorizationService: ControllerAuthorizationService,
    private readonly controllerBindingCookieService: ControllerBindingCookieService,
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve matching active controller authorization' })
  @ApiResponse({ status: 200, type: Object })
  resolve(
    @Param('organizationId', new ParseUUIDPipe())
    organizationId: OrganizationId,
    @Param('projectId', new ParseUUIDPipe()) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Req() request: Request,
    @Body() body: ResolveControllerAuthorizationRequestDto,
  ): Promise<ResolveControllerAuthorizationResponseDto> {
    return this.controllerAuthorizationService.resolve({
      organizationId,
      projectId,
      userId,
      controllerBindingSecret: readControllerBindingSecret(request),
      input: body,
    });
  }

  @Post('prepare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prepare one exact controller authorization' })
  @ApiResponse({ status: 200, type: Object })
  prepare(
    @Param('organizationId', new ParseUUIDPipe())
    organizationId: OrganizationId,
    @Param('projectId', new ParseUUIDPipe()) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Req() request: Request,
    @Body() body: PrepareControllerAuthorizationRequestDto,
  ): Promise<PrepareControllerAuthorizationResponseDto> {
    return this.controllerAuthorizationService.prepare({
      organizationId,
      projectId,
      userId,
      controllerBindingSecret: readControllerBindingSecret(request),
      input: body,
    });
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit one controller-authorized host action' })
  @ApiResponse({ status: 200, type: Object })
  async submit(
    @Param('organizationId', new ParseUUIDPipe())
    organizationId: OrganizationId,
    @Param('projectId', new ParseUUIDPipe()) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Body() body: SubmitControllerAuthorizedActionRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubmitControllerAuthorizedActionResponseDto> {
    const result = await this.controllerAuthorizationService.submit({
      organizationId,
      projectId,
      userId,
      input: body,
    });
    if (result.binding) {
      this.controllerBindingCookieService.set(
        response,
        result.binding.secret,
        result.binding.expiresAt,
      );
    }
    return result.response;
  }
}
