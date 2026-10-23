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
  SubmitRepositoryImportReplyRequestDto,
} from '../generated';
import { RepositoryImportReplyService } from '../services/repository-import-reply.service';
import { ConversationId, OrganizationId, ProjectId, UserId } from '../types';
import { validate as isUuid } from 'uuid';

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/repository-import/conversations/:conversationId/replies',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class RepositoryImportReplyController {
  constructor(
    private readonly repositoryImportReplyService: RepositoryImportReplyService,
  ) {}

  @Post()
  @HttpCode(202)
  submit(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @Body() request: SubmitRepositoryImportReplyRequestDto,
  ): Promise<MessageResponseDto> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new BadRequestException(
        'Repository import reply request must be an object',
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
        `Unknown repository import reply fields: ${unknownFields.join(', ')}`,
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
    return this.repositoryImportReplyService.admit({
      organizationId,
      projectId,
      conversationId,
      userId,
      request,
    });
  }
}
