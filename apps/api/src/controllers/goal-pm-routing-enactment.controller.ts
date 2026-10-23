import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  AuthToken,
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { Request } from 'express';
import { buildUserRequestorContext } from '../services/proposal/user-requestor-context';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import type {
  GoalPmRoutingEnactmentRequest,
  GoalPmRoutingCompletionRequest,
} from '../generated';
import type { ConversationId, OrganizationId, UserId } from '../types';
import { GoalPmRoutingEnactmentService } from '../services/goal-pm-routing-enactment.service';

@Controller(
  'api/v1/organizations/:organizationId/conversations/:conversationId/goal-pm-routing-enactments',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class GoalPmRoutingEnactmentController {
  constructor(private readonly enactment: GoalPmRoutingEnactmentService) {}

  @Post()
  @HttpCode(200)
  async enact(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: ConversationId,
    @Body() input: GoalPmRoutingEnactmentRequest,
    @AuthToken() token: string | null,
    @Req() request: Request,
  ) {
    if (!user?.userId) throw new UnauthorizedException();
    const result = await this.enactment.enact(
      organizationId,
      conversationId,
      user.userId,
      input,
    );
    if (
      result.answer.selectedOption.kind !== 'trackExistingWork' &&
      result.answer.selectedOption.kind !== 'createMissingWork'
    )
      return result;
    return this.enactment.enactWork(
      organizationId,
      conversationId,
      user.userId,
      input.selection,
      token,
      buildUserRequestorContext(
        user,
        organizationId,
        request,
        'POST /goal-pm-routing-enactments',
      ),
    );
  }

  @Post('complete')
  @HttpCode(200)
  complete(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId | undefined,
    @Param('conversationId') conversationId: ConversationId,
    @Body() input: GoalPmRoutingCompletionRequest,
  ) {
    if (!userId) throw new UnauthorizedException();
    return this.enactment.complete(
      organizationId,
      conversationId,
      userId,
      input.selection,
    );
  }
}
