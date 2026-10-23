import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AxiosResponse } from 'axios';
import { Prisma, WorkItemTypeCascadeExecutionState } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import {
  AgentEdge,
  AgentEdgeCategory,
  AgentEdgeEndpointEntityType,
  AgentEdgeDirection,
  AgentEdgeType,
  BatchCreateAgentEdgeResult,
  BatchCreateAgentEdgesResponse,
  CreateAgentEdgeDto,
  FindIncidentAgentEdgesRequest,
  PaginatedAgentEdgeResponse,
  UpdateAgentEdgeDto,
} from 'src/generated/graphs';
import { AgentEdgesService } from 'src/generated/graphs/api/agentEdges.service';
import type { RelationshipType } from 'src/generated/graphs/model/relationshipType';
import { OrganizationId, ProjectId } from 'src/types';
import { PrismaService } from 'src/prisma/prisma.service';
import { workflowEdgePredicateSchema } from 'src/services/proposal/workflow-proposal-link.schema';
import {
  axiosResponseToLoggable,
  errorToLoggable,
} from 'src/utils/logging.util';

export interface ListAgentEdgesOptions {
  type?: RelationshipType;
  sourceNodeId?: string;
  targetNodeId?: string;
  createdBySessionId?: string;
  page?: number;
  size?: number;
}

const stringifyJsonWithSets = (data: unknown): string =>
  JSON.stringify(data, (_key, value) =>
    value instanceof Set ? Array.from(value) : value,
  );

const AGENT_EDGE_ENDPOINT_ENTITY_TYPES = new Set<string>(
  Object.values(AgentEdgeEndpointEntityType),
);

const hasOwnField = (value: object, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, field);

export const AGENT_EDGE_BATCH_SIZE = 50;

@Injectable()
export class AgentEdgeClientService {
  private readonly logger = new Logger(AgentEdgeClientService.name);

  constructor(
    private readonly agentEdgesService: AgentEdgesService,
    private readonly prisma: PrismaService,
  ) {}

  private authHeaders(userToken: string) {
    return {
      Authorization: `Bearer ${userToken}`,
      'X-API-Auth': `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    };
  }

  async create(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: CreateAgentEdgeDto,
    userToken: string,
    materializationId?: string,
  ): Promise<AgentEdge> {
    return this.withGraphWritePreflight(
      organizationId,
      projectId,
      [dto.sourceNodeId, dto.targetNodeId],
      materializationId,
      () => this.createGraphEdge(organizationId, projectId, dto, userToken),
    );
  }

  async createBatch(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dtos: readonly CreateAgentEdgeDto[],
    userToken: string,
    materializationId?: string,
  ): Promise<BatchCreateAgentEdgeResult[]> {
    if (dtos.length === 0) {
      return [];
    }

    return this.withGraphWritePreflight(
      organizationId,
      projectId,
      dtos.flatMap((dto) => [dto.sourceNodeId, dto.targetNodeId]),
      materializationId,
      async () => {
        const results: BatchCreateAgentEdgeResult[] = [];
        for (
          let offset = 0;
          offset < dtos.length;
          offset += AGENT_EDGE_BATCH_SIZE
        ) {
          const chunk = dtos.slice(offset, offset + AGENT_EDGE_BATCH_SIZE);
          results.push(
            ...(await this.createGraphEdgeBatchChunk(
              organizationId,
              projectId,
              chunk,
              userToken,
              offset,
            )),
          );
        }
        return results;
      },
    );
  }

  private async createGraphEdgeBatchChunk(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dtos: readonly CreateAgentEdgeDto[],
    userToken: string,
    offset: number,
  ): Promise<BatchCreateAgentEdgeResult[]> {
    try {
      const response = await firstValueFrom<
        AxiosResponse<BatchCreateAgentEdgesResponse>
      >(
        this.agentEdgesService.createAgentEdgesBatch(
          organizationId,
          projectId,
          { edges: [...dtos] },
          { config: { headers: this.authHeaders(userToken) } },
        ),
      );
      this.assertBatchResponse(dtos.length, response.data);
      return response.data.results.map((result) => ({
        ...result,
        index: offset + result.index,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create agent edge batch', {
        error: errorToLoggable(error),
        downstream: axiosResponseToLoggable(error),
        organizationId,
        projectId,
        offset,
        edgeCount: dtos.length,
      });
      return dtos.map(
        (_dto, index) =>
          ({
            index: offset + index,
            success: false,
            error: message,
          }) satisfies BatchCreateAgentEdgeResult,
      );
    }
  }

  private assertBatchResponse(
    requestSize: number,
    response: BatchCreateAgentEdgesResponse,
  ): void {
    if (response.results.length !== requestSize) {
      throw new Error(
        'Graph batch response did not contain exactly one result per request entry.',
      );
    }
    response.results.forEach((result, index) => {
      if (result.index !== index) {
        throw new Error(
          'Graph batch response results were not correlated in input order.',
        );
      }
      if (result.success && !result.edge) {
        throw new Error('Graph batch success result omitted its edge.');
      }
      if (!result.success && !result.error) {
        throw new Error('Graph batch failure result omitted its error.');
      }
    });
  }

  private async createGraphEdge(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: CreateAgentEdgeDto,
    userToken: string,
  ): Promise<AgentEdge> {
    this.validateCreateDto(dto);

    this.logger.log('Creating agent edge', {
      organizationId,
      projectId,
      sourceNodeId: dto.sourceNodeId,
      sourceEntityType: dto.sourceEntityType,
      targetNodeId: dto.targetNodeId,
      targetEntityType: dto.targetEntityType,
      type: dto.type,
    });

    try {
      const response = await firstValueFrom<AxiosResponse<AgentEdge>>(
        this.agentEdgesService.createAgentEdge(organizationId, projectId, dto, {
          config: { headers: this.authHeaders(userToken) },
        }),
      );
      this.logger.log('Agent edge created', { id: response.data.id });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to create agent edge', {
        error: errorToLoggable(error),
        downstream: axiosResponseToLoggable(error),
        organizationId,
        projectId,
      });
      throw error;
    }
  }

  private validateCreateDto(dto: CreateAgentEdgeDto): void {
    this.validateEndpointEntityType(
      'CreateAgentEdgeDto',
      'sourceEntityType',
      dto.sourceEntityType,
    );
    this.validateEndpointEntityType(
      'CreateAgentEdgeDto',
      'targetEntityType',
      dto.targetEntityType,
    );
    this.validateRelationshipVariant(dto);
  }

  /**
   * Keep Graph materialization defensive even when a caller bypasses proposal
   * admission. The proposal OpenAPI union is the authoring contract; this is
   * the last boundary before a create request reaches Graph.
   */
  private validateRelationshipVariant(dto: CreateAgentEdgeDto): void {
    const flowEdgeTypes = new Set<AgentEdgeType>([
      AgentEdgeType.Standard,
      AgentEdgeType.Conditional,
      AgentEdgeType.Loop,
    ]);
    if (!flowEdgeTypes.has(dto.type)) return;

    if (dto.category !== AgentEdgeCategory.Flow) {
      throw new BadRequestException(
        'CreateAgentEdgeDto.category must be "flow" for STANDARD, CONDITIONAL, and LOOP relationships.',
      );
    }

    const hasDirection = hasOwnField(dto, 'direction');
    const hasPredicate = hasOwnField(dto, 'predicate');
    const direction = dto.direction;

    if (dto.type === AgentEdgeType.Loop) {
      if (hasDirection) {
        throw new BadRequestException(
          'CreateAgentEdgeDto.direction must be omitted for LOOP relationships; LOOP is a relationship variant, not a direction.',
        );
      }
      if (hasPredicate) {
        this.validatePredicate(dto.predicate, false);
      }
      return;
    }

    if (
      !hasDirection ||
      direction === null ||
      direction === undefined ||
      !Object.values(AgentEdgeDirection).includes(direction)
    ) {
      throw new BadRequestException(
        `CreateAgentEdgeDto.direction is required for ${dto.type} relationships and must be "forward" or "backward".`,
      );
    }

    if (dto.type === AgentEdgeType.Standard) {
      if (hasPredicate) {
        throw new BadRequestException(
          'CreateAgentEdgeDto.predicate must be omitted for STANDARD relationships.',
        );
      }
      return;
    }

    if (!hasPredicate) {
      throw new BadRequestException(
        'CreateAgentEdgeDto.predicate is required for CONDITIONAL relationships.',
      );
    }
    this.validatePredicate(dto.predicate, true);
  }

  private validatePredicate(
    predicate: CreateAgentEdgeDto['predicate'],
    required: boolean,
  ): void {
    if (predicate === null || predicate === undefined) {
      if (required) {
        throw new BadRequestException(
          'CreateAgentEdgeDto.predicate is required for CONDITIONAL relationships.',
        );
      }
      throw new BadRequestException(
        'CreateAgentEdgeDto.predicate must be a non-blank string when provided on LOOP relationships.',
      );
    }
    if (!workflowEdgePredicateSchema.safeParse(predicate).success) {
      throw new BadRequestException(
        'CreateAgentEdgeDto.predicate must use the portable workflow predicate syntax.',
      );
    }
  }

  private validateEndpointEntityType(
    dtoName: 'CreateAgentEdgeDto' | 'UpdateAgentEdgeDto',
    field: 'sourceEntityType' | 'targetEntityType',
    value: unknown,
  ): void {
    if (
      typeof value !== 'string' ||
      !AGENT_EDGE_ENDPOINT_ENTITY_TYPES.has(value)
    ) {
      throw new BadRequestException(
        `${dtoName}.${field} must be a supported graph endpoint entity type.`,
      );
    }
  }

  private validateUpdateDto(dto: UpdateAgentEdgeDto): void {
    this.validateReconnectEndpointPair(dto, 'sourceNodeId', 'sourceEntityType');
    this.validateReconnectEndpointPair(dto, 'targetNodeId', 'targetEntityType');
    if (dto.sourceEntityType !== undefined) {
      this.validateEndpointEntityType(
        'UpdateAgentEdgeDto',
        'sourceEntityType',
        dto.sourceEntityType,
      );
    }
    if (dto.targetEntityType !== undefined) {
      this.validateEndpointEntityType(
        'UpdateAgentEdgeDto',
        'targetEntityType',
        dto.targetEntityType,
      );
    }
  }

  private validateReconnectEndpointPair(
    dto: UpdateAgentEdgeDto,
    idField: 'sourceNodeId' | 'targetNodeId',
    typeField: 'sourceEntityType' | 'targetEntityType',
  ): void {
    const hasId = dto[idField] !== undefined;
    const hasType = dto[typeField] !== undefined;
    if (hasId !== hasType) {
      throw new BadRequestException(
        `UpdateAgentEdgeDto.${idField} and UpdateAgentEdgeDto.${typeField} must be provided together.`,
      );
    }
  }

  async get(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentEdgeId: string,
    userToken: string,
  ): Promise<AgentEdge> {
    this.logger.log('Getting agent edge', { agentEdgeId });

    try {
      const response = await firstValueFrom<AxiosResponse<AgentEdge>>(
        this.agentEdgesService.getAgentEdge(
          organizationId,
          projectId,
          agentEdgeId,
          { config: { headers: this.authHeaders(userToken) } },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get agent edge', {
        error: errorToLoggable(error),
        downstream: axiosResponseToLoggable(error),
        agentEdgeId,
      });
      throw error;
    }
  }

  async list(
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: ListAgentEdgesOptions,
    userToken: string,
  ): Promise<PaginatedAgentEdgeResponse> {
    this.logger.log('Listing agent edges', {
      organizationId,
      projectId,
      ...options,
    });

    try {
      const response = await firstValueFrom<
        AxiosResponse<PaginatedAgentEdgeResponse>
      >(
        this.agentEdgesService.listAgentEdges(
          organizationId,
          projectId,
          options.type,
          options.sourceNodeId,
          options.targetNodeId,
          options.createdBySessionId,
          options.page,
          options.size,
          undefined, // sort — unused, positional arg required by generated client
          { config: { headers: this.authHeaders(userToken) } },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to list agent edges', {
        error: errorToLoggable(error),
        downstream: axiosResponseToLoggable(error),
        organizationId,
        projectId,
      });
      throw error;
    }
  }

  async findIncident(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: FindIncidentAgentEdgesRequest,
    userToken: string,
  ): Promise<AgentEdge[]> {
    this.logger.log('Finding incident agent edges', {
      organizationId,
      projectId,
      nodeCount: request.nodeIds.size,
      typeCount: request.types.size,
    });

    try {
      const response = await firstValueFrom<AxiosResponse<AgentEdge[]>>(
        this.agentEdgesService.findIncidentAgentEdges(
          organizationId,
          projectId,
          request,
          {
            config: {
              headers: this.authHeaders(userToken),
              transformRequest: [stringifyJsonWithSets],
            },
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to find incident agent edges', {
        error: errorToLoggable(error),
        downstream: axiosResponseToLoggable(error),
        organizationId,
        projectId,
      });
      throw error;
    }
  }

  async update(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentEdgeId: string,
    dto: UpdateAgentEdgeDto,
    userToken: string,
    materializationId?: string,
    expectedUpdatedAt?: string,
  ): Promise<AgentEdge> {
    return this.withGraphWritePreflight(
      organizationId,
      projectId,
      [dto.sourceNodeId, dto.targetNodeId].filter(
        (id): id is string => id !== undefined,
      ),
      materializationId,
      () =>
        this.updateGraphEdge(
          organizationId,
          projectId,
          agentEdgeId,
          dto,
          userToken,
          expectedUpdatedAt,
        ),
    );
  }

  private async updateGraphEdge(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentEdgeId: string,
    dto: UpdateAgentEdgeDto,
    userToken: string,
    expectedUpdatedAt?: string,
  ): Promise<AgentEdge> {
    this.validateUpdateDto(dto);

    this.logger.log('Updating agent edge', {
      agentEdgeId,
      type: dto.type,
      hasReasoning: dto.reasoning !== undefined,
    });

    try {
      const response = await firstValueFrom<AxiosResponse<AgentEdge>>(
        this.agentEdgesService.updateAgentEdge(
          organizationId,
          projectId,
          agentEdgeId,
          dto,
          expectedUpdatedAt,
          { config: { headers: this.authHeaders(userToken) } },
        ),
      );
      this.logger.log('Agent edge updated', { id: response.data.id });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to update agent edge', {
        error: errorToLoggable(error),
        downstream: axiosResponseToLoggable(error),
        agentEdgeId,
      });
      throw error;
    }
  }

  async delete(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentEdgeId: string,
    userToken: string,
    reason?: string,
    materializationId?: string,
    expectedUpdatedAt?: string,
  ): Promise<void> {
    return this.withGraphWritePreflight(
      organizationId,
      projectId,
      [],
      materializationId,
      () =>
        this.deleteGraphEdge(
          organizationId,
          projectId,
          agentEdgeId,
          userToken,
          reason,
          expectedUpdatedAt,
        ),
    );
  }

  private async deleteGraphEdge(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentEdgeId: string,
    userToken: string,
    reason?: string,
    expectedUpdatedAt?: string,
  ): Promise<void> {
    this.logger.log('Deleting agent edge', { agentEdgeId, reason });

    try {
      await firstValueFrom(
        this.agentEdgesService.deleteAgentEdge(
          organizationId,
          projectId,
          agentEdgeId,
          expectedUpdatedAt,
          reason,
          { config: { headers: this.authHeaders(userToken) } },
        ),
      );
      this.logger.log('Agent edge deleted', { agentEdgeId });
    } catch (error) {
      this.logger.error('Failed to delete agent edge', {
        error: errorToLoggable(error),
        downstream: axiosResponseToLoggable(error),
        agentEdgeId,
      });
      throw error;
    }
  }

  private async assertGraphWriteAllowed(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    workItemIds: readonly string[],
    materializationId?: string,
  ): Promise<void> {
    const workItems = new Set(workItemIds);
    if (workItems.size > 0) {
      const taskTypes = await tx.task.findMany({
        where: {
          id: { in: [...workItems] },
          organizationId,
          projectId,
        },
        select: { type: true },
      });
      const pendingCascade =
        taskTypes.length > 0
          ? await tx.workItemTypeCascadeExecution.findFirst({
              where: {
                organizationId,
                projectId,
                typeKey: {
                  in: [...new Set(taskTypes.map(({ type }) => type))],
                },
                state: { not: WorkItemTypeCascadeExecutionState.COMPLETED },
              },
              select: { typeKey: true },
            })
          : null;
      if (pendingCascade) {
        throw new ConflictException(
          `Graph relationship is fenced while work-item type '${pendingCascade.typeKey}' is being deleted.`,
        );
      }
    }
    if (materializationId) {
      const intents = await tx.workItemChangeSetMaterialization.findMany({
        where: {
          organizationId,
          projectId,
          id: materializationId,
        },
        select: {
          id: true,
          status: true,
        },
      });
      const owner = intents.find((intent) => intent.id === materializationId);
      if (owner?.status !== 'APPLYING') {
        throw new ConflictException(
          'Graph change-set write is not owned by the active materialization.',
        );
      }
    }
  }

  private async withGraphWritePreflight<T>(
    organizationId: OrganizationId,
    projectId: ProjectId,
    workItemIds: readonly string[],
    materializationId: string | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    // Graph edge I/O must never run inside an API database transaction. The
    // transaction performs only contract-valid preflight checks; it does not
    // reject direct writes because an unrelated materialization is pending.
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertGraphWriteAllowed(
        tx as unknown as Prisma.TransactionClient,
        organizationId,
        projectId,
        workItemIds,
        materializationId,
      );
    });

    return operation();
  }
}
