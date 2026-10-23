import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import type { GoalPmRoutingSelectionPayload } from '../generated';
import { GoalPmRoutingDecisionService } from '../services/goal-pm-routing-decision.service';
import type { ConversationId, OrganizationId, UserId } from '../types';

@Controller(
  'api/v1/organizations/:organizationId/conversations/:conversationId/goal-pm-routing-decisions',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class GoalPmRoutingDecisionController {
  constructor(private readonly decisions: GoalPmRoutingDecisionService) {}

  @Post()
  @HttpCode(200)
  recordGoalPmRoutingDecision(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId | undefined,
    @Param('conversationId') conversationId: ConversationId,
    @Body() input: GoalPmRoutingSelectionPayload,
  ) {
    if (!userId) throw new UnauthorizedException();
    return this.decisions.record(organizationId, conversationId, userId, input);
  }
}
