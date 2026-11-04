import { z } from 'zod';
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
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { LocalOnboardingStepRequest } from '../generated';
import { ConversationId, OrganizationId, ProjectId, UserId } from '../types';
import { LocalOnboardingService } from '../services/workflows/local-onboarding.service';

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/onboarding/conversations/:conversationId/local-step',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class LocalOnboardingController {
  constructor(private readonly onboarding: LocalOnboardingService) {}
  @Post()
  @HttpCode(200)
  advance(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @Body() request: LocalOnboardingStepRequest,
  ) {
    const parsed = z
      .object({
        agentSessionId: z.string().uuid(),
        requestId: z.string().uuid().optional(),
        outputText: z.string().optional(),
      })
      .strict()
      .safeParse(request);
    if (!parsed.success) {
      throw new BadRequestException('Invalid local onboarding step request');
    }
    return this.onboarding.advance({
      organizationId,
      projectId,
      conversationId,
      userId,
      request: parsed.data,
    });
  }
}
