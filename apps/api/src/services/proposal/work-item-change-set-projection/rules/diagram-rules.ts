import {
  canonicalDiagramType,
  checkDiagramSections,
} from '../../../tasks/diagram-metadata';
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
