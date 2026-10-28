import {
  canonicalDiagramType,
  checkDiagramSections,
  diagramElementMetadataSchema,
  diagramMetadataSchema,
  parseDiagramJson,
} from '../../../tasks/diagram-metadata';
import { DiagramKind } from '../../../../generated/model/diagramKind';
import {
  parseDiagramGroupsContent,
  reconcileDiagramGroups,
  validateDiagramGroups,
} from '../../../tasks/diagram-groups';
import type { ProjectionRule } from '../projection-rule';
import { nodeKey, type IssueLayer, type NodeKey } from '../projection-state';
import type { RequestFacts } from '../request-facts';

const STRUCTURAL: IssueLayer = 'structural';
const REFERENTIAL: IssueLayer = 'referential';

const DIAGRAM_TYPES = new Set(['DIAGRAM', 'DIAGRAM_ELEMENT']);
const METADATA_KEYS = new Set(['diagramMetadata', 'diagramElementMetadata']);
const DIAGRAM_METADATA_KEY = 'diagramMetadata';
const DIAGRAM_ELEMENT_METADATA_KEY = 'diagramElementMetadata';

type NodesScope = { nodes: NodeKey[] };

const isDiagramType = (type: string | undefined): boolean =>
  type !== undefined && DIAGRAM_TYPES.has(canonicalDiagramType(type));

export const diagramMetadataRule: ProjectionRule<NodesScope> = {
  id: 'diagram.metadata',
  appliesTo(facts) {
    const nodes = new Set<NodeKey>();
    for (const create of facts.creates)
      if (isDiagramType(create.type)) nodes.add(create.node);
    for (const write of facts.sectionWrites)
      if (
        METADATA_KEYS.has(write.key) &&
        isDiagramType(facts.typeOf(write.node))
      )
        nodes.add(write.node);
    return nodes.size > 0 ? { nodes: [...nodes] } : null;
  },
  loads: (scope) => [{ kind: 'diagramTargets', of: scope.nodes }],
  check(state, scope, ctx) {
    for (const key of scope.nodes) {
      const node = state.nodes.get(key);
      if (!node || node.deleted || !isDiagramType(node.type)) continue;
      try {
        checkDiagramSections({
          type: node.type,
          sections: node.sections,
          definitions: ctx.registry.getSectionDefinitions(
            node.type,
            ctx.projectId,
          ),
          lookupTarget: (reference) => {
            const target = ctx.loaded.diagramTargets.get(reference.entityId);
            return target?.entityType === reference.entityType ? target : null;
          },
        });
      } catch (error) {
        ctx.addIssue(
          `nodes.${key}.sections`,
          'invalid_diagram_metadata',
          error instanceof Error ? error.message : 'Invalid Diagram metadata.',
          REFERENTIAL,
        );
      }
    }
  },
};

type UxFlowScope = { diagrams: NodeKey[] };

/** UX_FLOW is valid only when every screen and transition is explicit. */
export const diagramUxFlowRule: ProjectionRule<UxFlowScope> = {
  id: 'diagram.uxFlow',
  appliesTo(facts) {
    const diagrams = new Set<NodeKey>();
    const isUxFlow = (node: NodeKey | null | undefined) => {
      if (!node || !isDiagramType(facts.typeOf(node))) return false;
      const metadataWrite = facts.request.operations.find(
        (operation) =>
          operation.op === 'section.replace' &&
          nodeKey(operation.ref) === node &&
          operation.key === DIAGRAM_METADATA_KEY,
      );
      const metadataCleared = facts.request.operations.some(
        (operation) =>
          operation.op === 'section.clear' &&
          nodeKey(operation.ref) === node &&
          operation.key === DIAGRAM_METADATA_KEY,
      );
      if (metadataCleared) return false;
      try {
        const metadata = diagramMetadataSchema.safeParse(
          parseDiagramJson(
            metadataWrite?.op === 'section.replace'
              ? metadataWrite.content
              : facts.sectionContentOf(node, DIAGRAM_METADATA_KEY),
          ),
        );
        return metadata.success && metadata.data.kind === DiagramKind.UxFlow;
      } catch {
        return false;
      }
    };
    const addDiagram = (node: NodeKey | null | undefined) => {
      if (node && isUxFlow(node)) diagrams.add(node);
    };
    const addContainingDiagram = (node: NodeKey | null | undefined) => {
      if (!node) return;
      const parent = facts.parentOf(node);
      if (
        parent &&
        canonicalDiagramType(
          facts.parentTypeOf(node) ?? facts.typeOf(parent) ?? '',
        ) === 'DIAGRAM'
      ) {
        diagrams.add(parent);
      }
    };

    for (const create of facts.creates) {
      addDiagram(create.node);
      addDiagram(create.parent);
      addContainingDiagram(create.node);
    }
    for (const update of facts.updates) {
      addDiagram(update.node);
      addContainingDiagram(update.node);
      addDiagram(update.parentChange?.from);
      addDiagram(update.parentChange?.to);
      addContainingDiagram(update.parentChange?.to);
    }
    for (const deletion of facts.deletes) {
      addDiagram(deletion.parent);
      addContainingDiagram(deletion.node);
    }
    for (const write of facts.sectionWrites) {
      addDiagram(write.node);
      addContainingDiagram(write.node);
    }
    for (const operation of facts.relationshipOps) {
      addDiagram(operation.source);
      addDiagram(operation.target);
      addContainingDiagram(operation.source);
      addContainingDiagram(operation.target);
    }
    addDiagram(facts.root);
    addContainingDiagram(facts.root);

    return diagrams.size > 0 ? { diagrams: [...diagrams] } : null;
  },
  loads: (scope) => scope.diagrams.map((of) => ({ kind: 'diagramGraph', of })),
  check(state, scope, ctx) {
    for (const diagramKey of scope.diagrams) {
      const diagram = state.nodes.get(diagramKey);
      if (!diagram || diagram.deleted) continue;
      const metadataSection = diagram.sections.find(
        (section) => section.key === DIAGRAM_METADATA_KEY,
      );
      if (!metadataSection) continue;

      let metadataValue: unknown;
      try {
        metadataValue = parseDiagramJson(metadataSection.content);
      } catch {
        continue;
      }
      const metadata = diagramMetadataSchema.safeParse(metadataValue);
      if (!metadata.success || metadata.data.kind !== DiagramKind.UxFlow)
        continue;

      const namedChildren = [
        ...ctx.facts.creates
          .filter((create) => create.parent === diagramKey)
          .map((create) => create.node),
        ...ctx.facts.updates
          .filter(
            (update) =>
              update.parentChange?.from === diagramKey ||
              update.parentChange?.to === diagramKey,
          )
          .map((update) => update.node),
        ...ctx.facts.deletes
          .filter((deletion) => deletion.parent === diagramKey)
          .map((deletion) => deletion.node),
        ...[...ctx.findings.overlayNodes].filter(
          (key) => nodeKey(state.nodes.get(key)?.parent) === diagramKey,
        ),
      ];
      const children = new Set(
        [
          ...(ctx.loaded.children.get(diagramKey) ?? []),
          ...namedChildren,
        ].filter((key) => {
          const child = state.nodes.get(key);
          return (
            child !== undefined &&
            !child.deleted &&
            nodeKey(child.parent) === diagramKey
          );
        }),
      );
      for (const childKey of children) {
        const child = state.nodes.get(childKey);
        if (!child || child.deleted) continue;
        const field = `nodes.${childKey}.sections.${DIAGRAM_ELEMENT_METADATA_KEY}`;
        const elementSection = child.sections.find(
          (section) => section.key === DIAGRAM_ELEMENT_METADATA_KEY,
        );
        let elementValue: unknown;
        try {
          elementValue = parseDiagramJson(elementSection?.content);
        } catch {
          ctx.addIssue(
            field,
            'invalid_ux_flow_screen',
            'UX flow screens must have valid Diagram Element metadata and a canonical Mockup reference.',
            REFERENTIAL,
          );
          continue;
        }
        const parsed = diagramElementMetadataSchema.safeParse(elementValue);
        if (!parsed.success) {
          ctx.addIssue(
            field,
            'invalid_ux_flow_screen',
            'UX flow screens must have valid Diagram Element metadata and a canonical Mockup reference.',
            REFERENTIAL,
          );
          continue;
        }
        const reference = parsed.data.canonicalReference;
        if (!reference) {
          ctx.addIssue(
            field,
            'missing_ux_flow_mockup_reference',
            'Every UX flow screen must canonically reference a Mockup work item.',
            REFERENTIAL,
          );
          continue;
        }
        const target = ctx.loaded.diagramTargets.get(reference.entityId);
        if (
          reference.entityType !== 'TASK' ||
          canonicalDiagramType(target?.type ?? '') !== 'mockup'
        ) {
          ctx.addIssue(
            field,
            'invalid_ux_flow_mockup_reference',
            'Every UX flow screen must canonically reference a live Mockup work item.',
            REFERENTIAL,
          );
          continue;
        }

        try {
          checkDiagramSections({
            type: child.type,
            sections: child.sections,
            definitions: ctx.registry.getSectionDefinitions(
              child.type,
              ctx.projectId,
            ),
            lookupTarget: (candidate) => {
              const resolved = ctx.loaded.diagramTargets.get(
                candidate.entityId,
              );
              return resolved?.entityType === candidate.entityType
                ? resolved
                : null;
            },
          });
        } catch (error) {
          ctx.addIssue(
            field,
            'invalid_ux_flow_screen',
            error instanceof Error
              ? error.message
              : 'UX flow screen metadata violates the effective Diagram Element policy.',
            REFERENTIAL,
          );
        }
      }

      for (const relationship of state.relationships.values()) {
        if (
          relationship.deleted ||
          relationship.category !== 'flow' ||
          !['STANDARD', 'CONDITIONAL', 'LOOP'].includes(relationship.edgeType)
        ) {
          continue;
        }
        const source = nodeKey(relationship.source);
        const target = nodeKey(relationship.target);
        if (!children.has(source) && !children.has(target)) continue;
        const field = `relationships.${relationship.identity.refType === 'existing' ? relationship.identity.id : relationship.identity.tempId}.actionLabel`;
        if (!children.has(source) || !children.has(target)) {
          ctx.addIssue(
            field,
            'invalid_ux_flow_transition_endpoint',
            'UX flow transitions must connect two screen elements in the same Diagram.',
            REFERENTIAL,
          );
          continue;
        }
        if (!relationship.actionLabel?.trim()) {
          ctx.addIssue(
            field,
            'missing_ux_flow_action_label',
            'Every UX flow transition must have a non-empty triggering-action label.',
            STRUCTURAL,
          );
        }
      }
    }
  },
};

type GroupsScope = {
  root: NodeKey;
  groups: {
    node: NodeKey;
    sectionKey: string;
    replaced: boolean;
    /** Children the request creates, deletes or reparents under `node`. */
    named: NodeKey[];
  }[];
};

/** Children the request names under `parent`, before and after it applies. */
function namedChildren(facts: RequestFacts, parent: NodeKey): NodeKey[] {
  return [
    ...facts.creates.filter((c) => c.parent === parent).map((c) => c.node),
    ...facts.deletes.filter((d) => d.parent === parent).map((d) => d.node),
    ...facts.updates
      .filter(
        (u) => u.parentChange?.from === parent || u.parentChange?.to === parent,
      )
      .map((u) => u.node),
  ];
}

/**
 * Groups are graph-local: members must be the root graph's projected
 * elements. Elements deleted by the change set are pruned (the materializer
 * prunes identically), while a dangling parent group in an explicit
 * replacement is rejected because publication must match the stored
 * operation without consulting prior state. Only in-scope nodes' content is
 * canonicalized; other stored content is left as it is.
 */
export const diagramGroupsRule: ProjectionRule<GroupsScope> = {
  id: 'diagram.groups',
  appliesTo(facts, registry, projectId) {
    const groups = new Map<NodeKey, GroupsScope['groups'][number]>();
    const sectionKeyOf = (node: NodeKey | null): string | undefined => {
      const type = node ? facts.typeOf(node) : undefined;
      return type
        ? (registry.getGraphCapability(type, projectId)?.groups?.sectionKey ??
            undefined)
        : undefined;
    };
    for (const write of facts.sectionWrites) {
      const sectionKey = sectionKeyOf(write.node);
      if (write.kind === 'replace' && sectionKey === write.key)
        groups.set(write.node, {
          node: write.node,
          sectionKey,
          replaced: true,
          named: namedChildren(facts, write.node),
        });
    }
    for (const { parent } of [...facts.creates, ...facts.deletes]) {
      const sectionKey = sectionKeyOf(parent);
      if (parent && sectionKey && !groups.has(parent))
        groups.set(parent, {
          node: parent,
          sectionKey,
          replaced: false,
          named: namedChildren(facts, parent),
        });
    }
    return groups.size > 0
      ? { root: facts.root, groups: [...groups.values()] }
      : null;
  },
  loads: (scope) =>
    scope.groups
      .filter(({ replaced }) => replaced)
      .map(({ node }) => ({ kind: 'children', of: node })),
  check(state, scope, ctx) {
    for (const { node: key, sectionKey, replaced, named } of scope.groups) {
      const node = state.nodes.get(key);
      if (!node || node.deleted) continue;
      const section = node.sections.find(
        (candidate) => candidate.key === sectionKey,
      );
      if (!section || section.content === null || section.content === undefined)
        continue;
      const field = `nodes.${key}.sections.${sectionKey}`;
      const parsed = parseDiagramGroupsContent(section.content);
      if (!parsed.success) {
        ctx.addIssue(
          field,
          'invalid_diagram_groups',
          parsed.message,
          STRUCTURAL,
        );
        continue;
      }
      const live = new Set<string>();
      const removed = new Set<string>();
      const candidates = new Set([
        ...(ctx.loaded.children.get(key) ?? []),
        ...named,
      ]);
      for (const childKey of candidates) {
        const child = state.nodes.get(childKey);
        if (!child || nodeKey(child.parent) !== key) continue;
        (child.deleted ? removed : live).add(childKey);
      }
      const reconciled = reconcileDiagramGroups(parsed.value, {
        removedMemberKeys: removed,
      });
      // Only a replaced value is the change set's claim, and members are
      // graph-local to the root, so resolve them just there.
      const issues = validateDiagramGroups(
        reconciled,
        key === scope.root && replaced ? live : undefined,
      );
      for (const issue of issues) {
        ctx.addIssue(
          `${field}.${issue.path}`,
          issue.code,
          issue.message,
          issue.code === 'dangling_group_member' ? REFERENTIAL : STRUCTURAL,
          issue.code === 'unknown_parent_group'
            ? 'Set parentGroupId to a surviving ancestor or omit it.'
            : undefined,
        );
      }
      section.content = reconciled;
    }
  },
};
