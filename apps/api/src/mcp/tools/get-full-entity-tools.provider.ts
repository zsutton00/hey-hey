import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { AgentEdgeType } from '../../generated/graphs/model/agentEdgeType';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentEdgeClientService } from '../../services/agent-edge-client.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { TaskService } from '../../services/tasks/task.service';
import type { FeatureRequirementsSection } from '../../generated/model/featureRequirementsSection';
import {
  FeatureRequirementsReadError,
  readFeatureRequirementsSection,
} from '../../services/tasks/feature-requirements-reader';
import type { OrganizationId, ProjectId, TaskId } from '../../types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  resolveProjectId,
} from './mcp-tool.utils';
import { admitWholeRecords, SIZE_BUDGET_REASON } from './response-budget';

/** Dedicated handler keys; registered work-item type keys alias TASK. */
const SUPPORTED_TYPES = [
  'TASK',
  'INITIATIVE',
  'DESIGN_DOC',
  'SERVICE',
  'IMPLEMENTATION_HINT',
] as const;

type SupportedEntityType = (typeof SUPPORTED_TYPES)[number];

type ReplacementState = 'NOT_SUPERSEDED' | 'SUPERSEDED' | 'INCONSISTENT';

interface ReplacedByEntity {
  entityType: string;
  entityId: string;
  title: string;
  status: string;
}

interface ReplacementMetadata {
  state: ReplacementState;
  replacedBy: ReplacedByEntity[];
}

const pair = z.object({
  entityType: z
    .string()
    .describe(
      'Any registered work-item type key (such as CONTRACT) aliases TASK; also accepts ' +
        SUPPORTED_TYPES.join(', '),
    ),
  entityId: z.string().uuid().describe('The UUID of the entity to retrieve'),
});

export const getFullEntityParameters = z.object({
  entities: z
    .array(pair)
    .min(1)
    .max(10)
    .describe(
      'Array of 1–10 { entityType, entityId } pairs to retrieve in one call.',
    ),
});

type EntityRead = Record<string, unknown> | null;
type EntityOmission = {
  omitted: true;
  reason: typeof SIZE_BUDGET_REASON;
  entityType: string;
  entityId: string;
};

function budgetEntityReads(
  entities: z.infer<typeof getFullEntityParameters>['entities'],
  reads: EntityRead[],
): Record<string, EntityRead | EntityOmission> {
  const toRecord = (entries: readonly (EntityRead | EntityOmission)[]) =>
    Object.fromEntries(
      entities.map(({ entityId }, index) => [entityId, entries[index]!]),
    );
  const entries = admitWholeRecords<EntityRead, EntityOmission>(
    reads,
    (_read, index) => ({
      omitted: true,
      reason: SIZE_BUDGET_REASON,
      entityType: entities[index]!.entityType,
      entityId: entities[index]!.entityId,
    }),
    // A pretty-printed object is "{\n" + entries joined by ",\n" + "\n}": an
    // entry's own text is its one-key wrapper minus 4, plus its 2-char
    // separator, over an envelope of 2.
    (entry, index) =>
      JSON.stringify({ [entities[index]!.entityId]: entry }, null, 2).length -
      2,
    2,
  );
  return toRecord(entries);
}

function formatSections(
  sections: {
    key: string;
    order: number;
    materializedMarkdown: string | null;
  }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const s of sections.sort((a, b) => a.order - b.order)) {
    result[s.key] = s.materializedMarkdown ?? '';
  }
  return result;
}

@Injectable()
export class GetFullEntityToolsProvider {
  private readonly logger = new Logger(GetFullEntityToolsProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  @Tool({
    name: 'get_full_entity',
    description:
      'Retrieve the full, untruncated content of one or more entities in a single call. ' +
      'Accepts 1–10 { entityType, entityId } pairs in the entities array. ' +
      'Any registered project work-item type key is accepted as an alias of TASK. ' +
      'Search tools (unified_search, task_search, plan_search, etc.) return truncated snippets — ' +
      'use them to find entities first, then call get_full_entity to read complete content ' +
      'including all sections and replacement metadata. Every full record preserves the ' +
      'requested entity and reports whether lifecycle state and direct successor topology agree. ' +
      'Returns a JSON object keyed by entityId. Unknown or not-found IDs produce a null value ' +
      'for that key rather than failing the whole call. Returns whole records in request order ' +
      'within an 8,000-token estimated budget (four characters per token), including formatting. ' +
      'The first requested record is always returned whole, even if oversized. When the next ' +
      'record would exceed the budget, it and the remaining suffix carry omission markers: ' +
      'omitted: true, reason: SIZE_BUDGET, entityType, and entityId. Re-request exactly those ' +
      'omitted entityType/entityId pairs and repeat until all required records are read. ' +
      'A batch exceeding 10 pairs is rejected.',
    parameters: getFullEntityParameters,
  })
  async getFullEntity(
    params: z.infer<typeof getFullEntityParameters>,
    _context: Context,
    request: Request,
  ): Promise<CallToolResult> {
    this.logger.debug('get_full_entity called', {
      count: params.entities.length,
    });

    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;
    const { organizationId, token } = auth;
    const resolvedProjectId = resolveProjectId({}, request);
    if (!isProjectId(resolvedProjectId)) return resolvedProjectId;
    const projectId = resolvedProjectId;

    const handlerKeys = params.entities.map(({ entityType }) =>
      this.resolveHandlerKey(entityType, projectId),
    );
    if (handlerKeys.some((key) => key === undefined)) {
      const acceptedTypes = [
        ...new Set([
          ...SUPPORTED_TYPES,
          ...this.workItemTypeRegistry
            .getDefinitions(projectId)
            .filter(({ definition }) =>
              this.workItemTypeRegistry.getRulesForProject(
                definition.key,
                projectId,
              ),
            )
            .map(({ definition }) => definition.key),
        ]),
      ];
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              'Invalid entityType. Accepted types: ' + acceptedTypes.join(', '),
          },
        ],
      };
    }

    const reads: EntityRead[] = [];

    for (const [index, { entityType, entityId }] of params.entities.entries()) {
      const handlerKey = handlerKeys[index];
      if (!handlerKey) {
        continue;
      }
      const handler = this.handlers[handlerKey];
      if (!handler) {
        reads.push(null);
        continue;
      }
      try {
        const entity = await handler(entityId, organizationId, projectId);
        reads.push(
          entity
            ? {
                ...entity,
                replacement: await this.buildReplacementMetadata(
                  handlerKey,
                  entityId,
                  entity,
                  organizationId,
                  token,
                ),
              }
            : null,
        );
      } catch (error) {
        if (error instanceof FeatureRequirementsReadError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `get_full_entity failed for ${entityType}:${entityId}: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        reads.push(null);
      }
    }

    this.logger.debug('get_full_entity completed', {
      count: params.entities.length,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            budgetEntityReads(params.entities, reads),
            null,
            2,
          ),
        },
      ],
    };
  }

  private resolveHandlerKey(
    entityType: string,
    projectId: ProjectId,
  ): SupportedEntityType | undefined {
    const legacyType = SUPPORTED_TYPES.find((key) => key === entityType);
    if (legacyType) {
      return legacyType;
    }

    if (this.workItemTypeRegistry.getRulesForProject(entityType, projectId)) {
      return 'TASK';
    }

    return undefined;
  }

  private async buildReplacementMetadata(
    entityType: SupportedEntityType,
    entityId: string,
    entity: Record<string, unknown>,
    organizationId: OrganizationId,
    token: string | null,
  ): Promise<ReplacementMetadata> {
    const lifecycleSaysSuperseded = entity['status'] === 'SUPERSEDED';
    const projectId = await this.projectIdFor(
      entityType,
      entity,
      organizationId,
    );
    if (!projectId) {
      return {
        state: lifecycleSaysSuperseded ? 'INCONSISTENT' : 'NOT_SUPERSEDED',
        replacedBy: [],
      };
    }
    if (!token) {
      throw new Error('Authentication token required for replacement reads.');
    }

    const edges = await this.agentEdgeClient.findIncident(
      organizationId,
      projectId,
      {
        nodeIds: new Set([entityId]),
        types: new Set([AgentEdgeType.Supersedes]),
      },
      token,
    );
    const outboundEdges = edges.filter(
      (edge) =>
        edge.type === AgentEdgeType.Supersedes &&
        edge.sourceNodeId === entityId,
    );
    const targetIds = [
      ...new Set(outboundEdges.map((edge) => edge.targetNodeId)),
    ];
    const successors = targetIds.length
      ? await this.prisma.db.task.findMany({
          where: {
            id: { in: targetIds },
            organizationId,
            projectId,
          },
          select: {
            id: true,
            name: true,
            status: true,
          },
        })
      : [];
    const successorsById = new Map<string, (typeof successors)[number]>(
      successors.map((successor) => [successor.id, successor]),
    );

    const replacedBy = outboundEdges.map((edge): ReplacedByEntity => {
      const successor = successorsById.get(edge.targetNodeId);
      if (!successor || !edge.targetEntityType) {
        throw new Error(
          `SUPERSEDES successor ${edge.targetNodeId} is not resolvable in project scope.`,
        );
      }
      return {
        entityType: edge.targetEntityType,
        entityId: successor.id,
        title: successor.name,
        status: successor.status,
      };
    });
    const deduplicated = [
      ...new Map(
        replacedBy.map((successor) => [successor.entityId, successor]),
      ).values(),
    ].sort(
      (left, right) =>
        left.entityType.localeCompare(right.entityType) ||
        left.entityId.localeCompare(right.entityId),
    );
    const topologySaysSuperseded = deduplicated.length > 0;

    return {
      state:
        lifecycleSaysSuperseded === topologySaysSuperseded
          ? lifecycleSaysSuperseded
            ? 'SUPERSEDED'
            : 'NOT_SUPERSEDED'
          : 'INCONSISTENT',
      replacedBy: deduplicated,
    };
  }

  private async projectIdFor(
    entityType: SupportedEntityType,
    entity: Record<string, unknown>,
    organizationId: OrganizationId,
  ): Promise<ProjectId | null> {
    const projectId = entity['projectId'] ?? entity['originatingProjectId'];
    if (typeof projectId === 'string') return projectId as ProjectId;

    if (
      entityType === 'IMPLEMENTATION_HINT' &&
      typeof entity['serviceId'] === 'string'
    ) {
      const service = await this.prisma.db.service.findFirst({
        where: { id: entity['serviceId'], organizationId },
        select: { projectId: true },
      });
      return (service?.projectId as ProjectId | undefined) ?? null;
    }
    return null;
  }

  private handlers: Record<
    SupportedEntityType,
    (
      id: string,
      orgId: OrganizationId,
      projectId: ProjectId,
    ) => Promise<Record<string, unknown> | null>
  > = {
    TASK: async (id, orgId, projectId) => {
      const task = await this.taskService.findOneByOrganization(
        orgId,
        id as TaskId,
      );
      if (!task || task.projectId !== projectId) return null;
      const { sections, ...rest } = task;
      const result: Record<string, unknown> = {
        ...rest,
        sections: formatSections(sections ?? []),
      };

      // FEATURE requirements remain canonical JSON in the section envelope;
      // expose the generated record shape at this read boundary.
      if (task.type === 'FEATURE') {
        const requirementsContent = (sections ?? []).find(
          (section) => section.key === 'requirements',
        )?.materializedMarkdown;
        let requirementsSection: FeatureRequirementsSection | undefined;
        try {
          requirementsSection =
            readFeatureRequirementsSection(requirementsContent);
        } catch (error) {
          this.logger.error('get_full_entity: invalid feature requirements', {
            taskId: id,
            code:
              error instanceof FeatureRequirementsReadError
                ? error.code
                : 'unknown',
            diagnostic: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        if (requirementsSection !== undefined) {
          result.requirementsSection = requirementsSection;
        }
      }

      return result;
    },

    INITIATIVE: async (id, orgId) => {
      const initiative = await this.prisma.db.initiative.findFirst({
        where: { id, organizationId: orgId },
        include: {
          sections: {
            select: {
              key: true,
              order: true,
              materializedMarkdown: true,
            },
          },
        },
      });
      if (!initiative) return null;
      const { sections, ...rest } = initiative;
      return {
        ...rest,
        sections: formatSections(sections),
      };
    },

    DESIGN_DOC: async (id, orgId) => {
      const doc = await this.prisma.db.designDoc.findFirst({
        where: { id, organizationId: orgId },
        include: {
          sections: {
            select: {
              key: true,
              order: true,
              materializedMarkdown: true,
            },
          },
        },
      });
      if (!doc) return null;
      const { sections, ...rest } = doc;
      return {
        ...rest,
        sections: formatSections(sections),
      };
    },

    SERVICE: async (id, orgId) => {
      const service = await this.prisma.db.service.findFirst({
        where: { id, organizationId: orgId },
        include: {
          implementationHints: {
            select: {
              id: true,
              featureName: true,
              description: true,
              sourceType: true,
              confidence: true,
            },
            take: 50,
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      return service as Record<string, unknown> | null;
    },

    IMPLEMENTATION_HINT: async (id, orgId) => {
      const hint = await this.prisma.db.implementationHint.findFirst({
        where: {
          id,
          service: { organizationId: orgId },
        },
        include: {
          fileReferences: {
            select: {
              filePath: true,
              startLine: true,
              endLine: true,
            },
          },
        },
      });
      return hint as Record<string, unknown> | null;
    },
  };
}
