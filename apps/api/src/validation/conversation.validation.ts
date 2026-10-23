import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationResponseDto } from 'src/generated';
import { ProjectId } from '../types';

@Injectable()
export class ConversationValidation {
  constructor() {}

  validateConversationBelongsToProject(
    conversation: ConversationResponseDto | null,
    projectId: ProjectId,
  ): void {
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.projectId !== projectId) {
      throw new BadRequestException(
        'Conversation does not belong to the specified project',
      );
    }
  }

  validateProjectIdConsistency(
    dtoProjectId: ProjectId | undefined,
    routeProjectId: ProjectId,
  ): void {
    if (dtoProjectId && dtoProjectId !== routeProjectId) {
      throw new BadRequestException(
        'Project ID in request body must match the route parameter',
      );
    }
  }
}
