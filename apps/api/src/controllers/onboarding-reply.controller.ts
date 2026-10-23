import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import {
  MessageResponseDto,
  SubmitOnboardingReplyRequestDto,
} from '../generated';
import { OnboardingReplyService } from '../services/onboarding-reply.service';
import { ConversationId, OrganizationId, ProjectId, UserId } from '../types';
import { validate as isUuid } from 'uuid';

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/onboarding/conversations/:conversationId/replies',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class OnboardingReplyController {
  constructor(
    private readonly onboardingReplyService: OnboardingReplyService,
  ) {}

  @Post()
  @HttpCode(202)
  submit(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @Body() request: SubmitOnboardingReplyRequestDto,
  ): Promise<MessageResponseDto> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new BadRequestException(
        'Onboarding reply request must be an object',
      );
    }
    const allowedFields = new Set([
      'parentMessageId',
      'expectedConversationVersion',
      'answers',
    ]);
    const unknownFields = Object.keys(request).filter(
      (field) => !allowedFields.has(field),
    );
    if (unknownFields.length) {
      throw new BadRequestException(
        `Unknown onboarding reply fields: ${unknownFields.join(', ')}`,
      );
    }
    if (
      typeof request.parentMessageId !== 'string' ||
      !isUuid(request.parentMessageId)
    ) {
      throw new BadRequestException('parentMessageId must be a UUID');
    }
    if (
      !Number.isInteger(request.expectedConversationVersion) ||
      request.expectedConversationVersion < 1
    ) {
      throw new BadRequestException(
        'expectedConversationVersion must be a positive integer',
      );
    }
    if (
      !request.answers ||
      typeof request.answers !== 'object' ||
      Array.isArray(request.answers) ||
      Object.keys(request.answers).length === 0
    ) {
      throw new BadRequestException('answers must be a non-empty object');
    }
    return this.onboardingReplyService.admit({
      organizationId,
      projectId,
      conversationId,
      userId,
      request,
    });
  }
}
