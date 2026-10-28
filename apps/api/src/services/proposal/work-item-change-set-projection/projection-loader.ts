import type { Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import type { WorkItemChangeSetValidationRequest } from 'src/generated';
import type { AgentEdge } from 'src/generated/graphs';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import {
  AgentEdgeType as GraphAgentEdgeType,
  type AgentEdgeType as GraphAgentEdgeTypeValue,
} from 'src/generated/graphs/model/agentEdgeType';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { AgentEdgeClientService } from '../../agent-edge-client.service';
import type { ServiceTokenFactory } from '../../service-token-factory';
import { parseDiagramJson } from '../../tasks/diagram-metadata';
import {
  siblingsKey,
  type EndpointSkeleton,
  type Load,
  type LoadKind,
  type LoadedData,
  type NodeSkeleton,
} from './projection-rule';
import {
  existingId,
  nodeKey,
  type NodeKey,
  type ProjectedTaskRecord,
  type ProjectionState,
} from './projection-state';
import { projectedParentOf, type RequestFacts } from './request-facts';

export type GraphAgentEdge = AgentEdge;

/** Writes loaded records into `ProjectionState` the same way the facts phase does. */
export type ProjectionStateWriter = {
  writeTasks(tasks: readonly ProjectedTaskRecord[]): void;
  writeEdge(edge: GraphAgentEdge): void;
};

export type LoadCounts = Partial<
  Record<LoadKind, { loads: number; nodes: number; edges: number }>
>;

export const LARGE_LOAD_NODE_THRESHOLD = 200;

const DIAGRAM_ELEMENT_METADATA_KEY = 'diagramElementMetadata';
const REQUIREMENTS_KEY = 'requirements';

const TASK_INCLUDE = {
  sections: { orderBy: { order: 'asc' as const } },
  serviceRelations: { select: { serviceId: true } },
};

/**
 * The only projector path that reads Prisma beyond the facts phase or calls
 * the Graph. Rules declare loads; this resolves them against the caller's db.
 */
export class ProjectionLoader {
  constructor(
    private readonly params: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      db: AnyTransactionClient;
      agentEdgeClient: AgentEdgeClientService;
      tokenFactory: ServiceTokenFactory;
      request: WorkItemChangeSetValidationRequest;
      facts: RequestFacts;
      state: ProjectionState;
      loaded: LoadedData;
      writer: ProjectionStateWriter;
      logger: Logger;
    },
  ) {}

  async loadAll(loads: readonly Load[]): Promise<LoadCounts> {
    const counts: LoadCounts = {};
    for (const load of loads) {
      const result = await this.load(load);
      const entry = counts[load.kind] ?? { loads: 0, nodes: 0, edges: 0 };
      entry.loads += 1;
      entry.nodes += result.nodes;
      entry.edges += result.edges;
      counts[load.kind] = entry;
      if (result.nodes > LARGE_LOAD_NODE_THRESHOLD) {
        this.params.logger.warn('Projection load returned a large node set', {
          projectId: this.params.projectId,
          load,
          nodeCount: result.nodes,
          threshold: LARGE_LOAD_NODE_THRESHOLD,
        });
      }
    }
    return counts;
  }

  async load(load: Load): Promise<{ nodes: number; edges: number }> {
    switch (load.kind) {
      case 'parent':
        return 'of' in load
          ? this.loadParent(load.of)
          : this.loadEndpointParent(load.endpointOf, load.endpoint);
      case 'ancestorsToRoot':
        return this.loadAncestorsToRoot(load.of);
      case 'children':
        return this.loadChildren(load.of);
      case 'siblingsNamed':
        return this.loadSiblingsNamed(load.parent, load.name);
      case 'edgeById':
        return this.loadEdgeById(load.ref);
      case 'incidentEdges':
        return 'of' in load
          ? this.loadIncidentEdges(load.of, load.edgeTypes)
          : this.loadSourceIncidentEdges(load.sourceOf, load.edgeTypes);
      case 'dependsOnClosure':
        return this.loadDependsOnClosure(load.from, load.edges);
      case 'planStages':
        return this.loadPlanStages(load.plan);
      case 'diagramGraph': {
        // Element-rooted edits may know the parent type without its metadata.
        // Hydrate the container so kind-specific rules see the whole Diagram.
        const id = existingId(load.of);
        let diagramNodes = 0;
        if (id && !this.params.state.nodes.has(load.of)) {
          const tasks = (await this.params.db.task.findMany({
            where: { id, ...this.liveTaskWhere() },
            include: TASK_INCLUDE,
          })) as ProjectedTaskRecord[];
          this.params.writer.writeTasks(tasks);
          diagramNodes = tasks.length;
        }

        const graph = await this.loadRootNeighbourhood(
          load.of,
          [
            GraphAgentEdgeType.Standard,
            GraphAgentEdgeType.Conditional,
            GraphAgentEdgeType.Loop,
          ],
          true,
        );
        const targets = await this.loadDiagramTargets(
          this.params.loaded.children.get(load.of) ?? [],
        );
        return {
          nodes: diagramNodes + graph.nodes + targets.nodes,
          edges: graph.edges + targets.edges,
        };
      }
      case 'diagramTargets':
        return this.loadDiagramTargets(load.of);
      case 'services':
        return this.loadServices(load.ids);
      case 'requirementCitations':
        return this.loadRequirementCitations(load);
    }
  }

  /**
   * The root-children consumer view: `children(root)` plus the relationships
   * among the root, its children and the other projected nodes.
   */
  async loadRootNeighbourhood(
    root: NodeKey,
    edgeTypes: readonly GraphAgentEdgeTypeValue[],
    includeExternalRelationships = false,
  ): Promise<{ nodes: number; edges: number }> {
    const rootId = existingId(root);
    if (!rootId) return { nodes: 0, edges: 0 };
    const children = await this.loadChildren(root);
    const nodeIds = [
      rootId,
      ...(this.params.loaded.children.get(root) ?? []).map(
        (child) => existingId(child)!,
      ),
    ];
    const edges = await this.params.agentEdgeClient.findIncident(
      this.params.organizationId,
      this.params.projectId,
      { nodeIds: new Set(nodeIds), types: new Set(edgeTypes) },
      this.token(),
    );
    const neighbourhoodEdges = edges.filter(
      (edge) =>
        isWorkItemEdge(edge) &&
        (includeExternalRelationships ||
          (this.params.state.nodes.has(`existing:${edge.sourceNodeId}`) &&
            this.params.state.nodes.has(`existing:${edge.targetNodeId}`))),
    );
    neighbourhoodEdges.forEach((edge) => this.params.writer.writeEdge(edge));
    return { nodes: children.nodes, edges: neighbourhoodEdges.length };
  }

  private liveTaskWhere() {
    return {
      organizationId: this.params.organizationId,
      projectId: this.params.projectId,
      archivedAt: null,
      status: { not: 'ARCHIVED' as const },
    };
  }

  private token(): string {
    return this.params.tokenFactory(
      this.params.organizationId,
      this.params.projectId,
    );
  }

  private async loadParent(of: NodeKey) {
    const parent = projectedParentOf(this.params.facts, of);
    const id = parent ? existingId(parent) : undefined;
    if (!id || this.params.state.nodes.has(parent!))
      return { nodes: 0, edges: 0 };
    const tasks = (await this.params.db.task.findMany({
      where: { id, ...this.liveTaskWhere() },
      include: TASK_INCLUDE,
    })) as ProjectedTaskRecord[];
    this.params.writer.writeTasks(tasks);
    return { nodes: tasks.length, edges: 0 };
  }

  private async loadEndpointParent(ref: string, endpoint: 'source' | 'target') {
    let resolved = { nodes: 0, edges: 0 };
    if (!this.params.state.relationships.has(ref))
      resolved = await this.loadEdgeById(ref);
    const edge = this.params.state.relationships.get(ref);
    if (!edge) return resolved;
    const parent = await this.loadParent(nodeKey(edge[endpoint]));
    return {
      nodes: resolved.nodes + parent.nodes,
      edges: resolved.edges + parent.edges,
    };
  }

  private async loadAncestorsToRoot(of: NodeKey) {
    const chain: NodeSkeleton[] = [];
    const seen = new Set<NodeKey>([of]);
    let next = projectedParentOf(this.params.facts, of) ?? null;
    let queried = 0;
    while (next && !seen.has(next)) {
      seen.add(next);
      const known = this.params.state.nodes.get(next);
      let skeleton: NodeSkeleton | undefined;
      if (known) {
        skeleton = {
          id: existingId(next) ?? next,
          type: known.type,
          parent: known.parent ? nodeKey(known.parent) : null,
        };
      } else {
        const id = existingId(next);
        if (!id) break;
        const row = await this.params.db.task.findFirst({
          where: { id, ...this.liveTaskWhere() },
          select: { id: true, type: true, parentTaskId: true },
        });
        queried += 1;
        if (!row) break;
        skeleton = {
          id: row.id,
          type: row.type,
          parent: row.parentTaskId ? `existing:${row.parentTaskId}` : null,
        };
      }
      chain.push(skeleton);
      if (next === this.params.facts.root) break;
      next = skeleton.parent;
    }
    this.params.loaded.ancestors.set(of, chain);
    return { nodes: queried, edges: 0 };
  }

  private async loadChildren(of: NodeKey) {
    const id = existingId(of);
    if (!id) return { nodes: 0, edges: 0 };
    const tasks = (await this.params.db.task.findMany({
      where: { parentTaskId: id, ...this.liveTaskWhere() },
      include: TASK_INCLUDE,
    })) as ProjectedTaskRecord[];
    this.params.writer.writeTasks(tasks);
    this.params.loaded.children.set(
      of,
      tasks.map((task) => `existing:${task.id}`),
    );
    return { nodes: tasks.length, edges: 0 };
  }

  private async loadSiblingsNamed(parent: NodeKey, name: string) {
    const id = existingId(parent);
    if (!id) return { nodes: 0, edges: 0 };
    const tasks = (await this.params.db.task.findMany({
      where: { parentTaskId: id, name, ...this.liveTaskWhere() },
      include: TASK_INCLUDE,
    })) as ProjectedTaskRecord[];
    this.params.writer.writeTasks(tasks);
    this.params.loaded.siblings.set(
      siblingsKey(parent, name),
      tasks.map((task) => `existing:${task.id}`),
    );
    return { nodes: tasks.length, edges: 0 };
  }

  private async loadEdgeById(ref: string) {
    const id = existingId(ref);
    if (!id) return { nodes: 0, edges: 0 };
    let edge: GraphAgentEdge;
    try {
      edge = await this.params.agentEdgeClient.get(
        this.params.organizationId,
        this.params.projectId,
        id,
        this.token(),
      );
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        this.params.loaded.missingEdges.add(ref);
        return { nodes: 0, edges: 0 };
      }
      throw error;
    }
    if (!isWorkItemEdge(edge)) {
      this.params.loaded.missingEdges.add(ref);
      return { nodes: 0, edges: 0 };
    }
    this.params.writer.writeEdge(edge);
    this.params.loaded.storedEdgeTypes.set(ref, edge.type);
    // An update that keeps its endpoints still validates them.
    const endpointIds = [edge.sourceNodeId, edge.targetNodeId].filter(
      (endpointId) => !this.params.state.nodes.has(`existing:${endpointId}`),
    );
    const endpoints = endpointIds.length
      ? ((await this.params.db.task.findMany({
          where: {
            id: { in: [...new Set(endpointIds)].sort() },
            ...this.liveTaskWhere(),
          },
          include: TASK_INCLUDE,
        })) as ProjectedTaskRecord[])
      : [];
    this.params.writer.writeTasks(endpoints);
    return { nodes: endpoints.length, edges: 1 };
  }

  private async loadIncidentEdges(of: NodeKey, edgeTypes: string[]) {
    const id = existingId(of);
    if (!id || edgeTypes.length === 0) return { nodes: 0, edges: 0 };
    const edges = await this.params.agentEdgeClient.findIncident(
      this.params.organizationId,
      this.params.projectId,
      {
        nodeIds: new Set([id]),
        types: new Set(edgeTypes as GraphAgentEdgeTypeValue[]),
      },
      this.token(),
    );
    const workItemEdges = edges.filter(isWorkItemEdge);
    workItemEdges.forEach((edge) => this.params.writer.writeEdge(edge));
    this.params.loaded.incidentEdges.set(of, [
      ...(this.params.loaded.incidentEdges.get(of) ?? []),
      ...workItemEdges.map((edge) => `existing:${edge.id}`),
    ]);
    const farIds = [
      ...new Set(
        workItemEdges
          .flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId])
          .filter(
            (endpointId) =>
              endpointId !== id &&
              !this.params.state.nodes.has(`existing:${endpointId}`),
          ),
      ),
    ].sort();
    if (farIds.length === 0) return { nodes: 0, edges: workItemEdges.length };
    const rows = await this.params.db.task.findMany({
      where: { id: { in: farIds }, ...this.liveTaskWhere() },
      select: {
        id: true,
        type: true,
        parentTaskId: true,
        parentTask: { select: { type: true } },
      },
    });
    for (const row of rows as Array<{
      id: string;
      type: string;
      parentTaskId: string | null;
      parentTask: { type: string } | null;
    }>) {
      const endpoint: EndpointSkeleton = {
        id: row.id,
        type: row.type,
        parent: row.parentTaskId ? `existing:${row.parentTaskId}` : null,
        parentType: row.parentTask?.type ?? null,
      };
      this.params.loaded.edgeEndpoints.set(`existing:${row.id}`, endpoint);
    }
    return { nodes: rows.length, edges: workItemEdges.length };
  }

  private async loadSourceIncidentEdges(ref: string, edgeTypes: string[]) {
    let resolved = { nodes: 0, edges: 0 };
    if (!this.params.state.relationships.has(ref))
      resolved = await this.loadEdgeById(ref);
    const edge = this.params.state.relationships.get(ref);
    if (!edge) return resolved;
    const incident = await this.loadIncidentEdges(
      nodeKey(edge.source),
      edgeTypes,
    );
    return {
      nodes: resolved.nodes + incident.nodes,
      edges: resolved.edges + incident.edges,
    };
  }

  private async loadDependsOnClosure(from: NodeKey[], edgeRefs: string[]) {
    const targets = [...from];
    for (const ref of edgeRefs) {
      if (!this.params.state.relationships.has(ref))
        await this.loadEdgeById(ref);
      const edge = this.params.state.relationships.get(ref);
      if (edge) targets.push(nodeKey(edge.target));
    }
    const start = [
      ...new Set(
        targets.map(existingId).filter((id): id is string => id !== undefined),
      ),
    ];
    const visited = new Set(start);
    let frontier = start;
    while (frontier.length > 0) {
      const edges = await this.params.agentEdgeClient.findIncident(
        this.params.organizationId,
        this.params.projectId,
        {
          nodeIds: new Set(frontier),
          types: new Set([GraphAgentEdgeType.DependsOn]),
        },
        this.token(),
      );
      const current = new Set(frontier);
      const outgoing = edges.filter(
        (edge) =>
          edge.type === GraphAgentEdgeType.DependsOn &&
          edge.sourceEntityType === AgentEdgeEndpointEntityType.Task &&
          edge.targetEntityType === AgentEdgeEndpointEntityType.Task &&
          current.has(edge.sourceNodeId),
      );
      this.params.loaded.closureEdges.push(...outgoing);
      frontier = [
        ...new Set(
          outgoing
            .map((edge) => edge.targetNodeId)
            .filter((id) => !visited.has(id)),
        ),
      ];
      frontier.forEach((id) => visited.add(id));
    }
    if (visited.size === 0) return { nodes: 0, edges: 0 };
    const rows = await this.params.db.task.findMany({
      where: { id: { in: [...visited].sort() }, ...this.liveTaskWhere() },
      select: { id: true, type: true, parentTaskId: true },
    });
    for (const row of rows) {
      this.params.loaded.closureNodes.set(`existing:${row.id}`, {
        id: row.id,
        type: row.type,
        parent: row.parentTaskId ? `existing:${row.parentTaskId}` : null,
      });
    }
    return {
      nodes: rows.length,
      edges: this.params.loaded.closureEdges.length,
    };
  }

  private async loadPlanStages(plan: NodeKey) {
    const id = existingId(plan);
    if (!id) return { nodes: 0, edges: 0 };
    const stages = (await this.params.db.task.findMany({
      where: { parentTaskId: id, type: 'PLAN_STAGE', ...this.liveTaskWhere() },
      include: TASK_INCLUDE,
    })) as ProjectedTaskRecord[];
    this.params.writer.writeTasks(stages);
    const entry = {
      stages: stages.map((stage) => `existing:${stage.id}`),
      edges: [] as string[],
    };
    this.params.loaded.planStages.set(plan, entry);
    if (stages.length === 0) return { nodes: 0, edges: 0 };
    const stageIds = new Set(stages.map((stage) => stage.id));
    const edges = await this.params.agentEdgeClient.findIncident(
      this.params.organizationId,
      this.params.projectId,
      {
        nodeIds: stageIds,
        types: new Set([GraphAgentEdgeType.DependsOn]),
      },
      this.token(),
    );
    const stageEdges = edges.filter(
      (edge) =>
        isWorkItemEdge(edge) &&
        stageIds.has(edge.sourceNodeId) &&
        stageIds.has(edge.targetNodeId),
    );
    stageEdges.forEach((edge) => this.params.writer.writeEdge(edge));
    entry.edges = stageEdges.map((edge) => `existing:${edge.id}`);
    return { nodes: stages.length, edges: stageEdges.length };
  }

  private async loadDiagramTargets(of: NodeKey[]) {
    const taskIds = new Set<string>();
    const serviceIds = new Set<string>();
    for (const key of of) {
      for (const content of this.sectionContents(
        key,
        DIAGRAM_ELEMENT_METADATA_KEY,
      )) {
        const reference = canonicalReferenceOf(content);
        if (!reference) continue;
        (reference.entityType === 'SERVICE' ? serviceIds : taskIds).add(
          reference.entityId,
        );
      }
    }
    const [tasks, services] = await Promise.all([
      taskIds.size
        ? this.params.db.task.findMany({
            where: { id: { in: [...taskIds].sort() }, ...this.liveTaskWhere() },
            select: { id: true, type: true },
          })
        : [],
      serviceIds.size
        ? this.params.db.service.findMany({
            where: {
              id: { in: [...serviceIds].sort() },
              ...this.liveTaskWhere(),
            },
            select: { id: true },
          })
        : [],
    ]);
    tasks.forEach((task: { id: string; type: string }) =>
      this.params.loaded.diagramTargets.set(task.id, {
        entityType: 'TASK',
        type: task.type,
      }),
    );
    services.forEach((service: { id: string }) =>
      this.params.loaded.diagramTargets.set(service.id, {
        entityType: 'SERVICE',
      }),
    );
    return { nodes: tasks.length, edges: 0 };
  }

  private async loadServices(ids: string[]) {
    const requested = [...new Set(ids)].sort();
    if (requested.length === 0) return { nodes: 0, edges: 0 };
    const services = await this.params.db.service.findMany({
      where: { id: { in: requested }, ...this.liveTaskWhere() },
      select: { id: true },
    });
    services.forEach((service: { id: string }) =>
      this.params.loaded.services.add(service.id),
    );
    return { nodes: 0, edges: 0 };
  }

  private async loadRequirementCitations({
    feature,
    records,
    onlyEntityId,
  }: Extract<Load, { kind: 'requirementCitations' }>) {
    const taskIds = new Set<string>();
    const designDocIds = new Set<string>();
    const prior = this.params.state.nodes
      .get(feature)
      ?.sections.find((section) => section.key === REQUIREMENTS_KEY)?.content;
    if (prior !== undefined && prior !== null)
      this.params.loaded.priorRequirements.set(feature, prior);
    const add = (ids: Set<string>, id: string) => {
      if (onlyEntityId === undefined || id === onlyEntityId) ids.add(id);
    };
    for (const record of records) {
      record.designedBy.forEach(({ entityType, entityId }) =>
        add(entityType === 'DESIGN_DOC' ? designDocIds : taskIds, entityId),
      );
      record.fulfilledBy.forEach(({ entityId }) => add(taskIds, entityId));
      record.contracts.forEach(({ entityId }) => add(taskIds, entityId));
    }
    // Cross-project citations must be found to be reported as such, so these
    // reads are scoped to the organization only.
    const [tasks, designDocs] = await Promise.all([
      taskIds.size
        ? this.params.db.task.findMany({
            where: {
              id: { in: [...taskIds].sort() },
              organizationId: this.params.organizationId,
              archivedAt: null,
            },
            select: { id: true, projectId: true, type: true },
          })
        : [],
      designDocIds.size
        ? this.params.db.designDoc.findMany({
            where: {
              id: { in: [...designDocIds].sort() },
              organizationId: this.params.organizationId,
              archivedAt: null,
            },
            select: { id: true, projectId: true },
          })
        : [],
    ]);
    tasks.forEach((task: { id: string; projectId: string; type: string }) =>
      this.params.loaded.requirementCitations.set(task.id, {
        entityType: 'TASK',
        projectId: task.projectId,
        type: task.type,
      }),
    );
    designDocs.forEach((doc: { id: string; projectId: string }) =>
      this.params.loaded.requirementCitations.set(doc.id, {
        entityType: 'DESIGN_DOC',
        projectId: doc.projectId,
      }),
    );
    return { nodes: tasks.length, edges: 0 };
  }

  /**
   * Loads run before operations apply, so a section's relevant values are the
   * stored one plus every value the request writes.
   */
  private sectionContents(key: NodeKey, sectionKey: string): unknown[] {
    const contents: unknown[] = [];
    const stored = this.params.state.nodes
      .get(key)
      ?.sections.find((section) => section.key === sectionKey);
    if (stored && stored.content !== null && stored.content !== undefined)
      contents.push(stored.content);
    for (const operation of this.params.request.operations) {
      if (
        operation.op === 'section.replace' &&
        operation.key === sectionKey &&
        nodeKey(operation.ref) === key &&
        operation.content !== null
      )
        contents.push(operation.content);
    }
    return contents;
  }
}

function isWorkItemEdge(edge: GraphAgentEdge): boolean {
  return (
    (edge.sourceEntityType === undefined ||
      edge.sourceEntityType === AgentEdgeEndpointEntityType.Task) &&
    (edge.targetEntityType === undefined ||
      edge.targetEntityType === AgentEdgeEndpointEntityType.Task)
  );
}

function canonicalReferenceOf(
  content: unknown,
): { entityType: string; entityId: string } | undefined {
  let value: unknown;
  try {
    value = parseDiagramJson(content);
  } catch {
    // Malformed metadata is reported by the metadata rule itself.
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const reference = (value as { canonicalReference?: unknown })
    .canonicalReference;
  if (!reference || typeof reference !== 'object') return undefined;
  const { entityType, entityId } = reference as Record<string, unknown>;
  return typeof entityType === 'string' && typeof entityId === 'string'
    ? { entityType, entityId }
    : undefined;
}
