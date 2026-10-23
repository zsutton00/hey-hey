import { ProjectAccessService } from '../auth/services/project-access.service';
import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrganizationId } from 'src/types';
import {
  CreateValidationSessionDto,
  UpdateValidationSessionDto,
  ValidationSessionDto,
} from 'src/generated';
import { ValidationSessionService } from '../services/validation-session.service';

@ApiTags('ValidationSessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@ProjectResourceId('validationSession')
@Controller('api/v1/organizations/:organizationId/validation-sessions')
export class ValidationSessionController {
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly validationSessionService: ValidationSessionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a validation session' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({ status: 201, description: 'Validation session created' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Task or conversation not found' })
  async create(
    @Body() dto: CreateValidationSessionDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ValidationSessionDto> {
    if (!dto.taskId) {
      throw new BadRequestException('taskId is required');
    }
    if (!dto.projectId) {
      throw new BadRequestException('projectId is required');
    }

    return this.validationSessionService.create(
      organizationId,
      user.userId,
      dto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List validation sessions' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'taskId',
    required: false,
    description: 'Filter by task ID',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['CREATED', 'RUNNING', 'COMPLETED', 'FAILED'],
    description: 'Filter by status',
  })
  async findMany(
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('taskId') taskId?: string,
    @Query('status') status?: string,
  ): Promise<ValidationSessionDto[]> {
    return this.validationSessionService.findMany(organizationId, {
      accessibleProjectIds: await this.projectAccess.accessibleProjectIds(
        callerId,
        organizationId,
      ),
      taskId,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a validation session by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Validation session ID' })
  @ApiResponse({ status: 200, description: 'Validation session found' })
  @ApiResponse({ status: 404, description: 'Validation session not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ValidationSessionDto> {
    return this.validationSessionService.findOne(organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a validation session' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Validation session ID' })
  @ApiResponse({ status: 200, description: 'Validation session updated' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 404, description: 'Validation session not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateValidationSessionDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ValidationSessionDto> {
    return this.validationSessionService.update(organizationId, id, dto);
  }
}
