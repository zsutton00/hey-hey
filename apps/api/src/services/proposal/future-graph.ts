import { BadRequestException } from '@nestjs/common';
import { isEqual } from 'lodash';
import type {
  FutureRevisionContent,
  ProposalReconciliationBasis,
  ProjectedWorkItem,
  ProjectedWorkItemChangeSetResponse,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetOperation,
  WorkItemChangeSetValidationRequest,
  WorkItemGraphLayoutValue,
} from 'src/generated';

export const graphIdentityKey = (ref: WorkItemChangeSetIdentity) =>
  ref.refType === 'existing' ? `existing:${ref.id}` : `temporary:${ref.tempId}`;

export function futureGraph(content: FutureRevisionContent) {
  return 'type' in content ? content.graph : undefined;
}

/** Presentation labels, ordering and validation findings are not editable content. */
export function graphContentBasis(graph: ProjectedWorkItemChangeSetResponse) {
  const nodes = [graph.projectedRoot, ...graph.children]
    .filter((node) => !node.deleted)
    .map((node) => [
      graphIdentityKey(node.identity),
      {
        type: node.type,
        name: node.name,
        parent: node.parent ?? null,
        status: node.status ?? null,
        priority: node.priority ?? null,
        dueDate: node.dueDate ?? null,
        assigneeId: node.assigneeId ?? null,
        tag: node.tag ?? null,
        serviceIds: [...(node.serviceIds ?? [])].sort(),
        sections: Object.fromEntries(
          node.sections
            .filter(
              (section) => section.content !== null && section.content !== '',
            )
            .map((section) => [
              section.key,
              structuredSectionValue(section.content),
            ]),
        ),
      },
    ]);
  const relationships = graph.incidentRelationships
    .filter((edge) => !edge.deleted)
    .map((edge) => [
      graphIdentityKey(edge.identity),
      {
        source: edge.source,
        target: edge.target,
        sourceEntityType: edge.sourceEntityType ?? 'TASK',
        targetEntityType: edge.targetEntityType ?? 'TASK',
        edgeType: edge.edgeType,
        category:
          edge.category ??
          (['STANDARD', 'CONDITIONAL', 'LOOP'].includes(edge.edgeType)
            ? 'flow'
            : 'meta'),
        direction: edge.direction ?? null,
        predicate: edge.predicate ?? null,
        reasoning: edge.reasoning ?? null,
        metadata: edge.metadata ?? null,
      },
    ]);
  return {
    nodes: Object.fromEntries(nodes),
    relationships: Object.fromEntries(relationships),
  };
}

/**
 * Structured sections reach a graph either as parsed values or as their persisted
 * JSON text, and an unset section as null or ''. Storage form is not content.
 */
function structuredSectionValue(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  const text = content.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return content;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? parsed : content;
  } catch {
    return content;
  }
}

const scalarFields = [
  'name',
  'parent',
  'status',
  'priority',
  'dueDate',
  'assigneeId',
  'tag',
] as const;
const edgeFields = [
  'source',
  'target',
  'edgeType',
  'category',
  'direction',
  'predicate',
  'reasoning',
  'metadata',
] as const;

/** Compile the complete reviewed state into the existing generic operation protocol.
 * A refined temporary create is emitted once with its final values, so recovery
 * never tries to verify an obsolete intermediate operation postcondition.
 */
export function graphChangeSet(
  before: ProjectedWorkItemChangeSetResponse,
  after: ProjectedWorkItemChangeSetResponse,
): WorkItemChangeSetValidationRequest {
  const operations: WorkItemChangeSetOperation[] = [];
  const beforeNodes = new Map(
    [before.projectedRoot, ...before.children]
      .filter((n) => !n.deleted)
      .map((n) => [graphIdentityKey(n.identity), n]),
  );
  const afterNodes = new Map(
    [after.projectedRoot, ...after.children]
      .filter((n) => !n.deleted)
      .map((n) => [graphIdentityKey(n.identity), n]),
  );
  const beforeEdges = new Map(
    before.incidentRelationships
      .filter((e) => !e.deleted)
      .map((e) => [graphIdentityKey(e.identity), e]),
  );
  const afterEdges = new Map(
    after.incidentRelationships
      .filter((e) => !e.deleted)
      .map((e) => [graphIdentityKey(e.identity), e]),
  );
  for (const [key, edge] of beforeEdges) {
    if (!afterEdges.has(key))
      operations.push({ op: 'relationship.delete', ref: edge.identity });
  }
  for (const [key, node] of beforeNodes) {
    if (!afterNodes.has(key))
      operations.push({ op: 'workItem.delete', ref: node.identity });
  }
  for (const [key, node] of afterNodes) {
    const previous = beforeNodes.get(key);
    if (!previous) {
      if (node.identity.refType !== 'temporary')
        throw new BadRequestException(
          'New future graph children require temporary identities.',
        );
      operations.push({
        op: 'workItem.create',
        ref: node.identity,
        type: node.type,
        ...nodeScalars(node),
      });
    } else {
      if (previous.type !== node.type)
        throw new BadRequestException(
          'Future graph edits cannot change work-item types.',
        );
      const changed = Object.fromEntries(
        scalarFields
          .filter(
            (field) => !isEqual(previous[field] ?? null, node[field] ?? null),
          )
          .map((field) => [field, node[field] ?? null]),
      );
      if (Object.keys(changed).length)
        operations.push({
          op: 'workItem.update',
          ref: node.identity,
          ...changed,
        });
    }
    const sections = new Map(previous?.sections.map((s) => [s.key, s.content]));
    for (const section of node.sections) {
      if (isEqual(sections.get(section.key), section.content)) continue;
      const layout = section.content as WorkItemGraphLayoutValue | null;
      if (layout?.schemaVersion === 'work-item-graph-layout.v1') {
        operations.push({
          op: 'layout.replace',
          root: node.identity,
          sectionKey: section.key,
          entries: layout.nodes.map(({ node: ref, position }) => ({
            node:
              ref.kind === 'persistedWorkItem'
                ? { refType: 'existing', id: ref.workItemId }
                : { refType: 'temporary', tempId: ref.temporaryRef },
            position,
          })),
        });
      } else if (section.content === null) {
        operations.push({
          op: 'section.clear',
          ref: node.identity,
          key: section.key,
        });
      } else {
        operations.push({
          op: 'section.replace',
          ref: node.identity,
          key: section.key,
          content: section.content,
        });
      }
    }
    for (const section of previous?.sections ?? []) {
      if (!node.sections.some((s) => s.key === section.key))
        operations.push({
          op: 'section.clear',
          ref: node.identity,
          key: section.key,
        });
    }
  }
  for (const [key, edge] of afterEdges) {
    const previous = beforeEdges.get(key);
    if (!previous) {
      if (edge.identity.refType !== 'temporary')
        throw new BadRequestException(
          'New future graph relationships require temporary identities.',
        );
      const base = {
        op: 'relationship.create' as const,
        ref: edge.identity,
        source: edge.source,
        target: edge.target,
        reasoning: edge.reasoning,
        metadata: edge.metadata,
      };
      if (
        edge.edgeType === 'STANDARD' ||
        edge.edgeType === 'LOOP' ||
        edge.edgeType === 'CONDITIONAL'
      ) {
        if (edge.edgeType === 'CONDITIONAL') {
          if (!edge.direction)
            throw new BadRequestException(
              'Conditional relationships require an authored direction.',
            );
          if (!edge.predicate)
            throw new BadRequestException(
              'Conditional relationships require a predicate.',
            );
          operations.push({
            ...base,
            edgeType: 'CONDITIONAL',
            category: 'flow',
            direction: edge.direction,
            predicate: edge.predicate,
          });
        } else if (edge.edgeType === 'LOOP')
          operations.push({
            ...base,
            edgeType: 'LOOP',
            category: 'flow',
            ...(edge.predicate ? { predicate: edge.predicate } : {}),
          });
        else {
          if (!edge.direction)
            throw new BadRequestException(
              'Standard relationships require an authored direction.',
            );
          operations.push({
            ...base,
            edgeType: 'STANDARD',
            category: 'flow',
            direction: edge.direction,
          });
        }
      } else
        operations.push({
          ...base,
          edgeType: edge.edgeType,
          category: 'meta',
          ...(edge.direction ? { direction: edge.direction } : {}),
        });
    } else {
      const changed = Object.fromEntries(
        edgeFields
          .filter(
            (field) => !isEqual(previous[field] ?? null, edge[field] ?? null),
          )
          .map((field) => [field, edge[field] ?? null]),
      );
      if (Object.keys(changed).length)
        operations.push({
          op: 'relationship.update',
          ref: edge.identity,
          ...changed,
        });
    }
  }
  return JSON.parse(
    JSON.stringify({ root: after.projectedRoot.identity, operations }),
  );
}

function nodeScalars(node: ProjectedWorkItem) {
  return {
    name: node.name,
    parent: node.parent,
    status: node.status,
    priority: node.priority,
    dueDate: node.dueDate,
    assigneeId: node.assigneeId,
    tag: node.tag,
  };
}

/** A future owns one graph boundary; canonical referenced items remain read-only. */
export function assertFutureGraphBoundary(
  before: ProjectedWorkItemChangeSetResponse,
  request: WorkItemChangeSetValidationRequest,
) {
  const root = graphIdentityKey(before.projectedRoot.identity);
  const nodes = new Set([
    root,
    ...before.children.map((n) => graphIdentityKey(n.identity)),
  ]);
  const edges = new Set(
    before.incidentRelationships.map((e) => graphIdentityKey(e.identity)),
  );
  const endpoints = new Map(
    before.incidentRelationships.map((edge) => [
      graphIdentityKey(edge.identity),
      { source: edge.source, target: edge.target },
    ]),
  );
  for (const op of request.operations) {
    if (op.op === 'workItem.create') nodes.add(graphIdentityKey(op.ref));
    if (op.op === 'relationship.create') {
      edges.add(graphIdentityKey(op.ref));
      endpoints.set(graphIdentityKey(op.ref), {
        source: op.source,
        target: op.target,
      });
    }
  }
  for (const op of request.operations) {
    const ref = 'ref' in op ? op.ref : op.root;
    const key = graphIdentityKey(ref);
    if (!(op.op.startsWith('relationship.') ? edges : nodes).has(key))
      throw new BadRequestException(
        'Future graph operations must stay within the selected graph.',
      );
    if (op.op === 'relationship.create' || op.op === 'relationship.update') {
      const previous = endpoints.get(key);
      const source = op.source ?? previous?.source;
      const target = op.target ?? previous?.target;
      if (source && target) {
        if (
          !nodes.has(graphIdentityKey(source)) &&
          !nodes.has(graphIdentityKey(target))
        )
          throw new BadRequestException(
            'Future relationships must remain incident to the selected graph.',
          );
        endpoints.set(key, { source, target });
      }
    }
    if (op.op === 'workItem.create' && !op.parent)
      throw new BadRequestException(
        'New future graph elements require the selected root as their parent.',
      );
    if (
      key === root &&
      (op.op === 'workItem.delete' ||
        (op.op === 'workItem.update' && op.status !== undefined))
    )
      throw new BadRequestException(
        'A future graph cannot delete its root or change root status.',
      );
    if (
      (op.op === 'workItem.create' || op.op === 'workItem.update') &&
      'parent' in op &&
      key !== root &&
      (!op.parent || graphIdentityKey(op.parent) !== root)
    )
      throw new BadRequestException(
        'Future graph children must remain beneath the selected root.',
      );
  }
}

/** Resolve only protocol-owned references; arbitrary authored strings remain untouched. */
export function remapGraphProjection(
  graph: ProjectedWorkItemChangeSetResponse,
  workItems: Record<string, string>,
  relationships: Record<string, string>,
  preserveUnmapped = false,
): ProjectedWorkItemChangeSetResponse {
  function ref(
    identity: WorkItemChangeSetIdentity,
    mappings = workItems,
  ): WorkItemChangeSetIdentity {
    if (identity.refType === 'existing') return identity;
    const id = mappings[graphIdentityKey(identity)];
    if (!id && preserveUnmapped) return identity;
    if (!id)
      throw new BadRequestException(
        'Applied graph is missing a reserved identity.',
      );
    return { refType: 'existing', id };
  }
  function content(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(content);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (
      record.kind === 'temporaryWorkItem' &&
      typeof record.temporaryRef === 'string'
    ) {
      const mapped = ref({ refType: 'temporary', tempId: record.temporaryRef });
      return mapped.refType === 'existing'
        ? { kind: 'persistedWorkItem', workItemId: mapped.id }
        : record;
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, content(entry)]),
    );
  }
  const node = (entry: ProjectedWorkItem): ProjectedWorkItem => ({
    ...entry,
    identity: ref(entry.identity),
    ...(entry.parent ? { parent: ref(entry.parent) } : {}),
    sections: entry.sections.map((section) => ({
      ...section,
      content: content(section.content),
    })),
  });
  const root = node(graph.projectedRoot);
  return {
    ...graph,
    projectedRoot: root,
    sections: root.sections,
    children: graph.children.filter((entry) => !entry.deleted).map(node),
    incidentRelationships: graph.incidentRelationships
      .filter((entry) => !entry.deleted)
      .map((entry) => ({
        ...entry,
        identity: ref(entry.identity, relationships),
        source: ref(entry.source),
        target: ref(entry.target),
      })),
  };
}

/** OpenAPI unique arrays are Sets inside the NestJS projector, and arrays on JSON boundaries. */
export function serializableGraphProjection(
  graph: ProjectedWorkItemChangeSetResponse,
): ProjectedWorkItemChangeSetResponse {
  return JSON.parse(
    JSON.stringify(graph, (_key, value: unknown) =>
      value instanceof Set ? [...value] : value,
    ),
  );
}

/** Apply-time source tokens captured only after checking the complete reviewed baseline. */
export type FutureGraphApplication = {
  futureId: string;
  revision: number;
  refinementIds: string[];
  reviewedBases: ProposalReconciliationBasis[];
};
