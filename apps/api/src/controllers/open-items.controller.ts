import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentOrganization,
  CurrentUser,
  AuthToken,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import type {
  OpenItemsCollection,
  OpenItemsMutationResult,
  OpenItemsPresentCollection,
  PromoteGroupToGoalResult,
} from '../generated';
import {
  parseOpenItemGroupId,
  parseOpenItemRef,
  parseOpenItemsRequest,
} from '../services/open-items/open-items.boundary';
import { OpenItemsExceptionFilter } from '../services/open-items/open-items.errors';
import type { OpenItemsScope } from '../services/open-items/open-items.repository';
import { OpenItemsService } from '../services/open-items/open-items.service';
import { OpenItemsGoalPromotionService } from '../services/open-items/open-items-goal-promotion.service';
import type { OrganizationId, ProjectId, UserId } from '../types';

/**
 * Open Items for the authenticated user in an authorized project. The user is
 * always taken from the authenticated context; guards enforce organization
 * and project access before any handler runs.
 */
@ApiTags('OpenItems')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@UseFilters(OpenItemsExceptionFilter)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/open-items',
)
export class OpenItemsController {
  private readonly logger = new Logger(OpenItemsController.name);

  constructor(
    private readonly openItems: OpenItemsService,
    private readonly promotion: OpenItemsGoalPromotionService,
  ) {}

  @Post('promotions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'promoteGroupToGoal' })
  promoteGroupToGoal(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
    @AuthToken() token: string | null,
    @Body() body: unknown,
  ): Promise<PromoteGroupToGoalResult> {
    const request = parseOpenItemsRequest('PromoteGroupToGoalRequest', body);
    return this.promotion.promoteGroupToGoal(
      this.scope('promoteGroupToGoal', organizationId, projectId, userId),
      request,
      token,
    );
  }

  @Post('items/:entityType/:entityId/goal-filter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'setOpenItemGoalFilter' })
  setOpenItemGoalFilter(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    return this.openItems.setOpenItemGoalFilter(
      this.scope('setOpenItemGoalFilter', organizationId, projectId, userId),
      parseOpenItemRef({ entityType, entityId }),
      parseOpenItemsRequest('SetOpenItemGoalFilterRequest', body),
    );
  }

  @Post('items/:entityType/:entityId/goal-disclosure')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'setOpenItemGoalDisclosure' })
  setOpenItemGoalDisclosure(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    return this.openItems.setOpenItemGoalDisclosure(
      this.scope(
        'setOpenItemGoalDisclosure',
        organizationId,
        projectId,
        userId,
      ),
      parseOpenItemRef({ entityType, entityId }),
      parseOpenItemsRequest('SetOpenItemGoalDisclosureRequest', body),
    );
  }

  private scope(
    operation: string,
    organizationId: OrganizationId,
    projectId: string,
    userId: UserId,
  ): OpenItemsScope {
    this.logger.debug(
      `${operation}: authorized user ${userId} for project ${projectId} in org ${organizationId}`,
    );
    return { organizationId, projectId: projectId as ProjectId, userId };
  }

  @Get()
  @ApiOperation({ operationId: 'getOpenItems' })
  getOpenItems(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
  ): Promise<OpenItemsCollection> {
    return this.openItems.getOpenItems(
      this.scope('getOpenItems', organizationId, projectId, userId),
    );
  }

  @Post('activations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'activateOpenItem' })
  activateOpenItem(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const request = parseOpenItemsRequest('ActivateOpenItemRequest', body);
    return this.openItems.activateOpenItem(
      this.scope('activateOpenItem', organizationId, projectId, userId),
      request,
    );
  }

  @Post('items/:entityType/:entityId/note')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'setOpenItemNote' })
  setOpenItemNote(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const ref = parseOpenItemRef({ entityType, entityId });
    const request = parseOpenItemsRequest('SetOpenItemNoteRequest', body);
    return this.openItems.setOpenItemNote(
      this.scope('setOpenItemNote', organizationId, projectId, userId),
      ref,
      request,
    );
  }

  @Post('items/:entityType/:entityId/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'setOpenItemPin' })
  setOpenItemPin(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const ref = parseOpenItemRef({ entityType, entityId });
    const request = parseOpenItemsRequest('SetOpenItemPinRequest', body);
    return this.openItems.setOpenItemPin(
      this.scope('setOpenItemPin', organizationId, projectId, userId),
      ref,
      request,
    );
  }

  @Post('items/:entityType/:entityId/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'moveOpenItem' })
  moveOpenItem(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const ref = parseOpenItemRef({ entityType, entityId });
    const request = parseOpenItemsRequest('MoveOpenItemRequest', body);
    return this.openItems.moveOpenItem(
      this.scope('moveOpenItem', organizationId, projectId, userId),
      ref,
      request,
    );
  }

  @Post('items/:entityType/:entityId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'removeOpenItem' })
  removeOpenItem(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const ref = parseOpenItemRef({ entityType, entityId });
    const request = parseOpenItemsRequest('RemoveOpenItemRequest', body);
    return this.openItems.removeOpenItem(
      this.scope('removeOpenItem', organizationId, projectId, userId),
      ref,
      request,
    );
  }

  @Post('remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'removeOpenItems' })
  removeOpenItems(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const request = parseOpenItemsRequest('RemoveOpenItemsRequest', body);
    return this.openItems.removeOpenItems(
      this.scope('removeOpenItems', organizationId, projectId, userId),
      request,
    );
  }

  @Post('groups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'createOpenItemGroup' })
  createOpenItemGroup(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const request = parseOpenItemsRequest('CreateOpenItemGroupRequest', body);
    return this.openItems.createOpenItemGroup(
      this.scope('createOpenItemGroup', organizationId, projectId, userId),
      request,
    );
  }

  @Post('groups/:groupId/rename')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'renameOpenItemGroup' })
  renameOpenItemGroup(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('groupId') groupId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const group = parseOpenItemGroupId(groupId);
    const request = parseOpenItemsRequest('RenameOpenItemGroupRequest', body);
    return this.openItems.renameOpenItemGroup(
      this.scope('renameOpenItemGroup', organizationId, projectId, userId),
      group,
      request,
    );
  }

  @Post('groups/:groupId/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'deleteOpenItemGroup' })
  deleteOpenItemGroup(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('groupId') groupId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const group = parseOpenItemGroupId(groupId);
    const request = parseOpenItemsRequest('DeleteOpenItemGroupRequest', body);
    return this.openItems.deleteOpenItemGroup(
      this.scope('deleteOpenItemGroup', organizationId, projectId, userId),
      group,
      request,
    );
  }

  @Post('groups/:groupId/disclosure')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'setOpenItemGroupDisclosure' })
  setOpenItemGroupDisclosure(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('groupId') groupId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const group = parseOpenItemGroupId(groupId);
    const request = parseOpenItemsRequest(
      'SetOpenItemGroupDisclosureRequest',
      body,
    );
    return this.openItems.setOpenItemGroupDisclosure(
      this.scope(
        'setOpenItemGroupDisclosure',
        organizationId,
        projectId,
        userId,
      ),
      group,
      request,
    );
  }

  @Post('groups/:groupId/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'moveOpenItemGroup' })
  moveOpenItemGroup(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('groupId') groupId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const group = parseOpenItemGroupId(groupId);
    const request = parseOpenItemsRequest('MoveOpenItemGroupRequest', body);
    return this.openItems.moveOpenItemGroup(
      this.scope('moveOpenItemGroup', organizationId, projectId, userId),
      group,
      request,
    );
  }

  @Post('groups/:groupId/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'assignOpenItemsToGroup' })
  assignOpenItemsToGroup(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('groupId') groupId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const group = parseOpenItemGroupId(groupId);
    const request = parseOpenItemsRequest(
      'AssignOpenItemsToGroupRequest',
      body,
    );
    return this.openItems.assignOpenItemsToGroup(
      this.scope('assignOpenItemsToGroup', organizationId, projectId, userId),
      group,
      request,
    );
  }

  @Post('ungroup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'ungroupOpenItems' })
  ungroupOpenItems(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const request = parseOpenItemsRequest('UngroupOpenItemsRequest', body);
    return this.openItems.ungroupOpenItems(
      this.scope('ungroupOpenItems', organizationId, projectId, userId),
      request,
    );
  }

  @Post('groups/:groupId/members/:entityType/:entityId/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'moveOpenItemGroupMember' })
  moveOpenItemGroupMember(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @Param('groupId') groupId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsMutationResult> {
    const group = parseOpenItemGroupId(groupId);
    const ref = parseOpenItemRef({ entityType, entityId });
    const request = parseOpenItemsRequest(
      'MoveOpenItemGroupMemberRequest',
      body,
    );
    return this.openItems.moveOpenItemGroupMember(
      this.scope('moveOpenItemGroupMember', organizationId, projectId, userId),
      group,
      ref,
      request,
    );
  }

  @Post('migration')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'migrateOpenItems' })
  migrateOpenItems(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsPresentCollection> {
    const request = parseOpenItemsRequest('MigrateOpenItemsRequest', body);
    return this.openItems.migrateOpenItems(
      this.scope('migrateOpenItems', organizationId, projectId, userId),
      request,
    );
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'resetOpenItems' })
  resetOpenItems(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: string,
    @CurrentUser('userId') userId: UserId,
    @Body() body: unknown,
  ): Promise<OpenItemsPresentCollection> {
    const request = parseOpenItemsRequest('ResetOpenItemsRequest', body);
    return this.openItems.resetOpenItems(
      this.scope('resetOpenItems', organizationId, projectId, userId),
      request,
    );
  }
}
