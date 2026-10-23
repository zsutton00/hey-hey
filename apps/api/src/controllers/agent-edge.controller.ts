import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthToken,
  CurrentOrganization,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import type { OrganizationId, ProjectId } from '../types';
import type {
  AgentEdge,
  CreateAgentEdgeDto,
  PaginatedAgentEdgeResponse,
  UpdateAgentEdgeDto,
} from '../generated/graphs';
import type { RelationshipType } from '../generated/graphs/model/relationshipType';
import { AgentEdgeClientService } from '../services/agent-edge-client.service';

@ApiTags('AgentEdges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-edges',
)
export class AgentEdgeController {
  private readonly logger = new Logger(AgentEdgeController.name);

  constructor(private readonly agentEdgeClient: AgentEdgeClientService) {}

  private requireToken(userToken: string | null): string {
    if (!userToken) {
      throw new UnauthorizedException('Authentication token required');
    }
    return userToken;
  }

  @Post()
  @ApiOperation({
    summary: 'Create an agent-authored edge',
    description:
      'Create a new edge between two entities, authored by an agent session.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Agent edge created' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async create(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateAgentEdgeDto,
    @AuthToken() userToken: string | null,
  ): Promise<AgentEdge> {
    this.logger.log('POST /agent-edges', {
      organizationId,
      projectId,
      sourceNodeId: body.sourceNodeId,
      targetNodeId: body.targetNodeId,
    });

    return this.agentEdgeClient.create(
      organizationId,
      projectId as ProjectId,
      body,
      this.requireToken(userToken),
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List agent-authored edges',
    description:
      'List agent-authored edges with optional filtering by type, ' +
      'source/target node, or creating session.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'Filter by relationship type',
  })
  @ApiQuery({
    name: 'sourceNodeId',
    required: false,
    description: 'Filter by source node ID',
  })
  @ApiQuery({
    name: 'targetNodeId',
    required: false,
    description: 'Filter by target node ID',
  })
  @ApiQuery({
    name: 'createdBySessionId',
    required: false,
    description: 'Filter by creating session',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list of agent edges' })
  async list(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @AuthToken() userToken: string | null,
    @Query('type') type?: RelationshipType,
    @Query('sourceNodeId') sourceNodeId?: string,
    @Query('targetNodeId') targetNodeId?: string,
    @Query('createdBySessionId') createdBySessionId?: string,
    @Query('page') page?: number,
    @Query('size') size?: number,
  ): Promise<PaginatedAgentEdgeResponse> {
    this.logger.log('GET /agent-edges', {
      organizationId,
      projectId,
      type,
      sourceNodeId,
      targetNodeId,
    });

    return this.agentEdgeClient.list(
      organizationId,
      projectId as ProjectId,
      { type, sourceNodeId, targetNodeId, createdBySessionId, page, size },
      this.requireToken(userToken),
    );
  }

  @Get(':agentEdgeId')
  @ApiOperation({
    summary: 'Get an agent-authored edge by ID',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentEdgeId', description: 'Agent edge ID' })
  @ApiResponse({ status: 200, description: 'Agent edge returned' })
  @ApiResponse({ status: 404, description: 'Agent edge not found' })
  async get(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('agentEdgeId', ParseUUIDPipe) agentEdgeId: string,
    @AuthToken() userToken: string | null,
  ): Promise<AgentEdge> {
    this.logger.log('GET /agent-edges/:id', { agentEdgeId });

    return this.agentEdgeClient.get(
      organizationId,
      projectId as ProjectId,
      agentEdgeId,
      this.requireToken(userToken),
    );
  }

  @Patch(':agentEdgeId')
  @ApiOperation({
    summary: 'Update an agent-authored edge',
    description:
      'Update the relationship type and/or reasoning of an existing edge.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentEdgeId', description: 'Agent edge ID' })
  @ApiResponse({ status: 200, description: 'Agent edge updated' })
  @ApiResponse({ status: 404, description: 'Agent edge not found' })
  async update(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('agentEdgeId', ParseUUIDPipe) agentEdgeId: string,
    @Body() body: UpdateAgentEdgeDto,
    @AuthToken() userToken: string | null,
  ): Promise<AgentEdge> {
    this.logger.log('PATCH /agent-edges/:id', {
      agentEdgeId,
      type: body.type,
    });

    return this.agentEdgeClient.update(
      organizationId,
      projectId as ProjectId,
      agentEdgeId,
      body,
      this.requireToken(userToken),
    );
  }

  @Delete(':agentEdgeId')
  @ApiOperation({
    summary: 'Delete an agent-authored edge',
    description:
      'Remove an agent-authored edge. Optional reason for audit logging.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentEdgeId', description: 'Agent edge ID' })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Agent edge deleted' })
  @ApiResponse({ status: 404, description: 'Agent edge not found' })
  async delete(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('agentEdgeId', ParseUUIDPipe) agentEdgeId: string,
    @Body() body: { reason?: string },
    @AuthToken() userToken: string | null,
  ): Promise<{ deleted: boolean; agentEdgeId: string }> {
    this.logger.log('DELETE /agent-edges/:id', {
      agentEdgeId,
      reason: body?.reason,
    });

    await this.agentEdgeClient.delete(
      organizationId,
      projectId as ProjectId,
      agentEdgeId,
      this.requireToken(userToken),
      body?.reason,
    );

    return { deleted: true, agentEdgeId };
  }
}
