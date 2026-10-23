import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import {
  NotificationChannel,
  NotificationDto,
  NotificationEventType,
  NotificationPreferencesDto,
  NotificationStatus,
  UpdateNotificationPreferencesDto,
} from 'src/generated';
import { NotificationService } from 'src/services/notifications/notification.service';
import { OrganizationId, UserId } from 'src/types';

@ApiTags('Notifications')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('notifications')
  @ApiOperation({ summary: 'List notifications' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'eventType', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: NotificationStatus })
  @ApiQuery({ name: 'channel', required: false, enum: NotificationChannel })
  @ApiQuery({ name: 'includeDismissed', required: false, type: Boolean })
  @ApiQuery({ name: 'createdAfter', required: false, type: String })
  @ApiQuery({ name: 'createdBefore', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Notifications retrieved' })
  async listNotifications(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
    @Query('userId') userId?: string,
    @Query('eventType') eventType?: string | string[],
    @Query('status') status?: NotificationStatus,
    @Query('channel') channel?: NotificationChannel,
    @Query('includeDismissed') includeDismissed?: string,
    @Query('createdAfter') createdAfter?: string,
    @Query('createdBefore') createdBefore?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<NotificationDto[]> {
    const parsed = await this.notificationService.listNotifications({
      organizationId,
      actorUserId: user.userId,
      ...(userId ? { userId: userId as UserId } : {}),
      ...(eventType
        ? {
            eventTypes: this.parseEventTypeQuery(eventType),
          }
        : {}),
      ...(status ? { status: this.parseStatus(status) } : {}),
      ...(channel ? { channel: this.parseChannel(channel) } : {}),
      ...(includeDismissed !== undefined
        ? {
            includeDismissed: this.parseBoolean(
              includeDismissed,
              'includeDismissed',
            ),
          }
        : {}),
      ...(createdAfter
        ? { createdAfter: this.parseIsoDate(createdAfter, 'createdAfter') }
        : {}),
      ...(createdBefore
        ? { createdBefore: this.parseIsoDate(createdBefore, 'createdBefore') }
        : {}),
      ...(limit !== undefined ? { limit: this.parseInt(limit, 'limit') } : {}),
      ...(offset !== undefined
        ? { offset: this.parseInt(offset, 'offset') }
        : {}),
    });

    response.setHeader('X-Total-Count', parsed.totalCount.toString());
    if (parsed.nextOffset !== undefined) {
      response.setHeader('X-Next-Offset', parsed.nextOffset.toString());
    }

    return parsed.data;
  }

  @Get('users/:id/notification-preferences')
  @ApiOperation({ summary: 'Get user notification preferences' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Notification preferences retrieved',
  })
  async getPreferences(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') targetUserId: string,
  ): Promise<NotificationPreferencesDto> {
    return this.notificationService.getUserNotificationPreferences(
      organizationId,
      user.userId,
      targetUserId as UserId,
    );
  }

  @Put('users/:id/notification-preferences')
  @ApiOperation({ summary: 'Update user notification preferences' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Notification preferences updated',
  })
  async updatePreferences(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') targetUserId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    return this.notificationService.updateUserNotificationPreferences(
      organizationId,
      user.userId,
      targetUserId as UserId,
      dto,
    );
  }

  @Patch('notifications/:notificationId/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'notificationId', description: 'Notification ID' })
  async markRead(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationDto> {
    return this.notificationService.markRead(
      organizationId,
      user.userId,
      notificationId,
    );
  }

  @Patch('notifications/:notificationId/unread')
  @ApiOperation({ summary: 'Mark notification as unread' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'notificationId', description: 'Notification ID' })
  async markUnread(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationDto> {
    return this.notificationService.markUnread(
      organizationId,
      user.userId,
      notificationId,
    );
  }

  @Patch('notifications/:notificationId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge a notification' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'notificationId', description: 'Notification ID' })
  async acknowledge(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationDto> {
    return this.notificationService.acknowledge(
      organizationId,
      user.userId,
      notificationId,
    );
  }

  @Patch('notifications/:notificationId/dismiss')
  @ApiOperation({ summary: 'Dismiss a notification' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'notificationId', description: 'Notification ID' })
  async dismiss(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationDto> {
    return this.notificationService.dismiss(
      organizationId,
      user.userId,
      notificationId,
    );
  }

  private parseEventTypeQuery(
    eventType: string | string[],
  ): NotificationEventType[] {
    const raw = Array.isArray(eventType) ? eventType.join(',') : eventType;

    const parsed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const allowed = new Set(Object.values(NotificationEventType));
    const invalid = parsed.filter(
      (entry) => !allowed.has(entry as NotificationEventType),
    );

    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid eventType value(s): ${invalid.join(', ')}`,
      );
    }

    return parsed as NotificationEventType[];
  }

  private parseStatus(status: string): NotificationStatus {
    const allowed = new Set(Object.values(NotificationStatus));
    if (!allowed.has(status as NotificationStatus)) {
      throw new BadRequestException(`Invalid notification status: ${status}`);
    }
    return status as NotificationStatus;
  }

  private parseChannel(channel: string): NotificationChannel {
    const allowed = new Set(Object.values(NotificationChannel));
    if (!allowed.has(channel as NotificationChannel)) {
      throw new BadRequestException(`Invalid notification channel: ${channel}`);
    }
    return channel as NotificationChannel;
  }

  private parseBoolean(raw: string, fieldName: string): boolean {
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
    throw new BadRequestException(`${fieldName} must be true or false`);
  }

  private parseIsoDate(raw: string, fieldName: string): Date {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `${fieldName} must be an ISO-8601 datetime`,
      );
    }
    return parsed;
  }

  private parseInt(raw: string, fieldName: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        `${fieldName} must be a non-negative integer`,
      );
    }
    return parsed;
  }
}
