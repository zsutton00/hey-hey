import { Injectable, Logger } from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { AgentEdgeType } from '../../generated/graphs/model/agentEdgeType';
import type { AgentEdgeType as AgentEdgeTypeValue } from '../../generated/graphs/model/agentEdgeType';
import { DiagramGroupsValueSchema } from '../../generated/diagram.schemas';
import type { WorkItemGraphLayoutNodeRef } from '../../generated/model/workItemGraphLayoutNodeRef';
import { AgentEdgeClientService } from '../../services/agent-edge-client.service';
import {
  TaskService,
  ALL_DECLARED_SECTIONS,
} from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { WORK_ITEM_TYPE_KEYS } from '../../services/tasks/work-item-type-keys';
import { validateWorkItemGraphLayoutContent } from '../../services/tasks/work-item-graph-layout.validator';
import {
  diagramElementMetadataSchema,
  diagramMetadataSchema,
  parseDiagramJson,
} from '../../services/tasks/diagram-metadata';
import type { OrganizationId, ProjectId, TaskId } from '../../types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';
import {
  renderDiagramView,
  type DiagramViewElement,
  type DiagramViewGroup,
} from './diagram-view';

const DIAGRAM_METADATA_KEY = 'diagramMetadata';
const DIAGRAM_ELEMENT_METADATA_KEY = 'diagramElementMetadata';
const DESCRIPTION_SECTION_KEY = 'description';
const ELEMENT_READ_LIMIT = 500;

const FLOW_TYPES = new Set<string>([
  AgentEdgeType.Standard,
  AgentEdgeType.Conditional,
  AgentEdgeType.Loop,
]);

const CONTRACT_PARTICIPATION_TYPES = new Set<string>([
  AgentEdgeType.Guarantees,
  AgentEdgeType.Implements,
  AgentEdgeType.Consumes,
]);

// Every type with its own category; the rest of the readable meta types are
// informational, including DEPENDS_ON to a Contract.
const CATEGORIZED_TYPES = new Set<string>([
  ...FLOW_TYPES,
  AgentEdgeType.FulfilledBy,
  ...CONTRACT_PARTICIPATION_TYPES,
]);

export const getDiagramParameters = z.object({
  workflowId: z.string().uuid().describe('ID of the Diagram to read'),
});

type SectionRecord = {
  key: unknown;
  materializedMarkdown: string | null | undefined;
};

function requireToken(token: string | null): string | CallToolResult {
  return token ?? mcpError('Authentication token required for Diagram reads.');
}

function isToken(value: string | CallToolResult): value is string {
  return typeof value === 'string';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function findSection(
  sections: SectionRecord[] | undefined,
  key: string,
): SectionRecord | undefined {
  return sections?.find((section) => String(section.key) === key);
}

/** A blank description reads as null, so an element without one prints nothing extra. */
function descriptionText(sections: SectionRecord[] | undefined): string | null {
  const text = findSection(
    sections,
    DESCRIPTION_SECTION_KEY,
  )?.materializedMarkdown;
  return text?.trim() ? text : null;
}

/** An absent or blank section reads as null; a populated section that fails its schema is an error. */
function parseOptionalSection<T>(
  sections: SectionRecord[] | undefined,
  key: string,
  schema: z.ZodType<T>,
  label: string,
): T | null {
  const section = findSection(sections, key);
  if (!section?.materializedMarkdown?.trim()) return null;
  let value: unknown;
  try {
    value = parseDiagramJson(section.materializedMarkdown);
  } catch (error) {
    throw new Error(`${label} is invalid: ${errorMessage(error)}`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message);
    throw new Error(`${label} is invalid: ${reasons.join('; ')}`);
  }
  return parsed.data;
}

function persistedMemberId(member: WorkItemGraphLayoutNodeRef): string {
  if (member.kind !== 'persistedWorkItem') {
    throw new Error('Diagram groups must reference materialized elements.');
  }
  return member.workItemId;
}

@Injectable()
export class GetDiagramToolsProvider {
  private readonly logger = new Logger(GetDiagramToolsProvider.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly agentEdgeClient: AgentEdgeClientService,
  ) {}

  @Tool({
    name: 'get_diagram',
    description:
      'Read one Diagram as compact text: its description, kind and level, every ' +
      'element with its id, role, name, canonical reference, group and description, ' +
      'and every link with its ' +
      'id and endpoints, grouped as flow, fulfillment, Contract participation, or ' +
      'informational. Ids are persisted and layout is omitted. Use this, not ' +
      'get_context, to read a Diagram; never infer its elements or relationships ' +
      'from orientation context. Project is resolved from X-Project-ID.',
    parameters: getDiagramParameters,
  })
  async getDiagram(
    params: z.infer<typeof getDiagramParameters>,
    _context: Context,
    request: Request,
  ): Promise<CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const token = requireToken(auth.token);
    if (!isToken(token)) return token;

    this.logger.log('get_diagram called', {
      organizationId: auth.organizationId,
      projectId,
      diagramId: params.workflowId,
    });

    try {
      const diagram = await this.taskService.findOneByOrganization(
        auth.organizationId as OrganizationId,
        params.workflowId as TaskId,
        false,
        false,
        false,
        false,
        token,
      );

      if (!diagram) {
        return mcpError('Diagram not found or not accessible.');
      }
      if (diagram.projectId !== projectId) {
        return mcpError('Diagram is outside the requested project scope.');
      }

      const graph = this.workItemTypeRegistry.getGraphCapability(
        diagram.type,
        projectId as ProjectId,
      );
      if (
        ![WORK_ITEM_TYPE_KEYS.Workflow, WORK_ITEM_TYPE_KEYS.Diagram].some(
          (type) => type === diagram.type,
        ) ||
        graph === null
      ) {
        return mcpError(
          'The requested work item is not a graph-capable Diagram.',
        );
      }

      const steps = await this.taskService.findAll(
        auth.organizationId as OrganizationId,
        null,
        {
          projectId: projectId as ProjectId,
          parentTaskId: params.workflowId as TaskId,
          taskType: graph.nodeChildType,
          includeSectionKeys: ALL_DECLARED_SECTIONS,
          page: 1,
          limit: ELEMENT_READ_LIMIT,
        },
      );

      const nodeIds = new Set([diagram.id, ...steps.map((step) => step.id)]);
      const readableEdgeTypes = new Set<AgentEdgeTypeValue>(
        graph.readableRelationships.map(
          (relationship) => relationship.edgeType,
        ),
      );
      const edges = await this.agentEdgeClient.findIncident(
        auth.organizationId as OrganizationId,
        projectId as ProjectId,
        { nodeIds, types: readableEdgeTypes },
        token,
      );

      const readableMetaTypes = new Set<string>(
        graph.readableRelationships
          .filter((relationship) => relationship.category === 'meta')
          .map((relationship) => relationship.edgeType),
      );
      const scopedEdges = edges.filter(
        (edge) =>
          nodeIds.has(edge.sourceNodeId) || nodeIds.has(edge.targetNodeId),
      );
      const flowLinks = scopedEdges.filter(
        (edge) =>
          FLOW_TYPES.has(edge.type) &&
          nodeIds.has(edge.sourceNodeId) &&
          nodeIds.has(edge.targetNodeId),
      );
      const fulfillmentLinks = scopedEdges.filter(
        (edge) =>
          edge.type === AgentEdgeType.FulfilledBy &&
          nodeIds.has(edge.sourceNodeId),
      );
      const contractLinks = scopedEdges.filter(
        (edge) =>
          CONTRACT_PARTICIPATION_TYPES.has(edge.type) &&
          nodeIds.has(edge.sourceNodeId),
      );
      const informationalLinks = scopedEdges.filter(
        (edge) =>
          readableMetaTypes.has(edge.type) &&
          !CATEGORIZED_TYPES.has(edge.type) &&
          nodeIds.has(edge.sourceNodeId),
      );

      const groupsValue = graph.groups
        ? parseOptionalSection(
            diagram.sections,
            graph.groups.sectionKey,
            DiagramGroupsValueSchema,
            'Diagram groups',
          )
        : null;
      const groups: DiagramViewGroup[] = (groupsValue?.groups ?? []).map(
        (group) => ({
          id: group.id,
          label: group.label,
          meaning: group.meaning,
          parentGroupId: group.parentGroupId ?? null,
          memberIds: group.members.map(persistedMemberId),
        }),
      );
      const groupIdsByElement = new Map<string, string[]>();
      for (const group of groups) {
        for (const memberId of group.memberIds) {
          groupIdsByElement.set(memberId, [
            ...(groupIdsByElement.get(memberId) ?? []),
            group.id,
          ]);
        }
      }

      const elements: DiagramViewElement[] = steps.map((step) => {
        const metadata = parseOptionalSection(
          step.sections,
          DIAGRAM_ELEMENT_METADATA_KEY,
          diagramElementMetadataSchema,
          `Diagram element ${step.id} metadata`,
        );
        return {
          id: step.id,
          name: step.name,
          role: metadata?.role ?? null,
          canonicalReference: metadata?.canonicalReference ?? null,
          description: descriptionText(step.sections),
          groupIds: groupIdsByElement.get(step.id) ?? [],
        };
      });

      const diagramMetadata = parseOptionalSection(
        diagram.sections,
        DIAGRAM_METADATA_KEY,
        diagramMetadataSchema,
        'Diagram metadata',
      );

      // Layout is omitted from the view, but a populated layout that fails
      // validation still fails the read.
      const layoutContent = findSection(
        diagram.sections,
        graph.layout.sectionKey,
      )?.materializedMarkdown;
      if (layoutContent && layoutContent.trim().length > 0) {
        const parsed = validateWorkItemGraphLayoutContent(layoutContent);
        if (!parsed.success) {
          return mcpError(`Diagram layout is invalid: ${parsed.message}`);
        }
      }

      const text = renderDiagramView({
        id: diagram.id,
        name: diagram.name,
        description: descriptionText(diagram.sections),
        kind: diagramMetadata?.kind ?? null,
        level: diagramMetadata?.level ?? null,
        elements,
        elementsTruncated: steps.length >= ELEMENT_READ_LIMIT,
        flowLinks,
        fulfillmentLinks,
        contractLinks,
        informationalLinks,
        groups,
      });

      return { content: [{ type: 'text', text }] };
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.logger.warn(`get_diagram failed: ${message}`);
      return mcpError(`Diagram read failed: ${message}`);
    }
  }
}
