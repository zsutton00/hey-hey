import type {
  ProjectModeSettings,
  ProjectedWorkItemSection,
} from 'src/generated';
import { EntityType } from 'src/generated/model/entityType';
import type { WorkItemTypeSectionDefinition } from 'src/generated/model/workItemTypeSectionDefinition';
import {
  findIneligibleProjectModeTypeKeys,
  PROJECT_MODE_SETTINGS_SCHEMA_REF,
} from '../../../tasks/project-mode-settings.validator';
import { formatWorkItemStatusNotAllowedMessage } from '../../../tasks/work-item-status-policy';
import type { Load, ProjectionRule, RuleContext } from '../projection-rule';
import {
  nodeKey,
  type IssueLayer,
  type NodeKey,
  type ProjectedNode,
  type ProjectionState,
} from '../projection-state';
import type { RequestFacts } from '../request-facts';

const REFERENTIAL: IssueLayer = 'referential';

type NodesScope = { nodes: NodeKey[] };

const createdKeys = (facts: RequestFacts): NodeKey[] => [
  ...new Set(facts.creates.map(({ node }) => node)),
];

const isCreated = (facts: RequestFacts, key: NodeKey): boolean =>
  facts.creates.some(({ node }) => node === key);

const parentLoads = (nodes: readonly NodeKey[]): Load[] =>
  [...new Set(nodes)].map((of) => ({ kind: 'parent', of }));

/** A created node the remaining node rules validate; inactive types stop at `node.typeActive`. */
function checkableCreate(
  state: ProjectionState,
  key: NodeKey,
  ctx: RuleContext,
): ProjectedNode | undefined {
  const node = state.nodes.get(key);
  if (!node || node.deleted) return undefined;
  return ctx.registry.isTypeActiveForProject(node.type, ctx.projectId)
    ? node
    : undefined;
}

function liveNode(
  state: ProjectionState,
  key: NodeKey,
): ProjectedNode | undefined {
  const node = state.nodes.get(key);
  return node && !node.deleted ? node : undefined;
}

export const nodeTypeActiveRule: ProjectionRule<NodesScope> = {
  id: 'node.typeActive',
  appliesTo: (facts) =>
    facts.creates.length > 0 ? { nodes: createdKeys(facts) } : null,
  loads: () => [],
  check(state, scope, ctx) {
    for (const key of scope.nodes) {
      const node = liveNode(state, key);
      if (
        !node ||
        ctx.registry.isTypeActiveForProject(node.type, ctx.projectId)
      )
        continue;
      ctx.addIssue(
        `nodes.${key}.type`,
        'unrecognized_type',
        `${node.type} is not an active work-item type for this project.`,
        REFERENTIAL,
      );
    }
  },
};

type ParentageScope = {
  created: NodeKey[];
  /** One entry per reparenting update, so repeated updates report as before. */
  reparented: NodeKey[];
};

export const nodeParentageRule: ProjectionRule<ParentageScope> = {
  id: 'node.parentage',
  appliesTo(facts) {
    const reparented = facts.updates
      .filter((update) => update.parentChange && !isCreated(facts, update.node))
      .map(({ node }) => node);
    return facts.creates.length > 0 || reparented.length > 0
      ? { created: createdKeys(facts), reparented }
      : null;
  },
  loads: (scope) => parentLoads(scope.created),
  check(state, scope, ctx) {
    for (const key of scope.created) {
      const node = checkableCreate(state, key, ctx);
      if (node) validateParentage(state, key, node, ctx);
    }
    for (const key of scope.reparented) {
      const node = liveNode(state, key);
      if (node) validateParentage(state, key, node, ctx);
    }
  },
};

function validateParentage(
  state: ProjectionState,
  key: NodeKey,
  node: ProjectedNode,
  ctx: RuleContext,
): void {
  const field = `nodes.${key}.parent`;
  if (!node.parent) {
    if (ctx.registry.isParentRequired(node.type, ctx.projectId)) {
      ctx.addIssue(
        field,
        'missing_parent',
        `${node.type} requires a parent work item.`,
        REFERENTIAL,
      );
    }
    return;
  }

  const parentKey = nodeKey(node.parent);
  const parent = state.nodes.get(parentKey);
  if (!parent) {
    ctx.addIssue(
      field,
      'dangling_reference',
      `Work-item reference ${parentKey} does not resolve.`,
      REFERENTIAL,
    );
  }
  if (!parent || parent.deleted) {
    ctx.addIssue(
      field,
      'invalid_parent',
      `${node.type} cannot use a missing or deleted parent.`,
      REFERENTIAL,
    );
    return;
  }
  let violation;
  try {
    violation = ctx.parentage.evaluate({
      childType: node.type,
      parentEntityType: EntityType.Task,
      parentType: parent.type,
      projectId: ctx.projectId,
    });
  } catch (error) {
    ctx.addIssue(
      field,
      'invalid_child_type',
      error instanceof Error ? error.message : String(error),
      REFERENTIAL,
    );
    return;
  }
  if (violation) {
    ctx.addIssue(field, 'invalid_child_type', violation.reason, REFERENTIAL);
  }
}

type ScalarField = 'dueDate' | 'tag';
const SCALAR_FIELDS: readonly ScalarField[] = ['dueDate', 'tag'];

function checkScalar(
  key: NodeKey,
  node: ProjectedNode,
  field: ScalarField,
  ctx: RuleContext,
  checks: { required: boolean; forbidden: boolean },
): void {
  const required =
    checks.required &&
    ctx.registry.isScalarRequired(node.type, field, ctx.projectId);
  const forbidden =
    checks.forbidden &&
    ctx.registry.isScalarForbidden(node.type, field, ctx.projectId);
  if (required && !node[field]) {
    ctx.addIssue(
      `nodes.${key}.${field}`,
      'missing_required_scalar',
      `${node.type} requires ${field}.`,
      REFERENTIAL,
    );
  } else if (forbidden && node[field]) {
    ctx.addIssue(
      `nodes.${key}.${field}`,
      'forbidden_scalar',
      `${node.type} does not allow ${field}.`,
      REFERENTIAL,
    );
  }
}

export const nodeRequiredScalarsRule: ProjectionRule<NodesScope> = {
  id: 'node.requiredScalars',
  appliesTo: (facts) =>
    facts.creates.length > 0 ? { nodes: createdKeys(facts) } : null,
  loads: () => [],
  check(state, scope, ctx) {
    for (const key of scope.nodes) {
      const node = checkableCreate(state, key, ctx);
      if (!node) continue;
      // Every missing requirement is reported before any forbidden value.
      SCALAR_FIELDS.forEach((field) =>
        checkScalar(key, node, field, ctx, {
          required: true,
          forbidden: false,
        }),
      );
      SCALAR_FIELDS.forEach((field) =>
        checkScalar(key, node, field, ctx, {
          required: false,
          forbidden: true,
        }),
      );
    }
  },
};

type UpdatedScalarsScope = {
  updates: { node: NodeKey; fields: ScalarField[] }[];
};

export const nodeUpdatedScalarsRule: ProjectionRule<UpdatedScalarsScope> = {
  id: 'node.updatedScalars',
  appliesTo(facts) {
    const updates = facts.updates.flatMap((update) => {
      const fields = SCALAR_FIELDS.filter((field) =>
        update.fields.includes(field),
      );
      return fields.length > 0 && !isCreated(facts, update.node)
        ? [{ node: update.node, fields }]
        : [];
    });
    return updates.length > 0 ? { updates } : null;
  },
  loads: () => [],
  check(state, scope, ctx) {
    for (const { node: key, fields } of scope.updates) {
      const node = liveNode(state, key);
      if (!node) continue;
      fields.forEach((field) =>
        checkScalar(key, node, field, ctx, { required: true, forbidden: true }),
      );
    }
  },
};

type StatusScope = { created: NodeKey[]; updated: NodeKey[] };

export const nodeStatusRule: ProjectionRule<StatusScope> = {
  id: 'node.status',
  appliesTo(facts) {
    const created = [
      ...new Set(
        facts.request.operations.flatMap((operation) =>
          operation.op === 'workItem.create' && operation.status !== undefined
            ? [nodeKey(operation.ref)]
            : [],
        ),
      ),
    ];
    const updated = facts.request.operations.flatMap((operation) =>
      operation.op === 'workItem.update' &&
      operation.status !== undefined &&
      !isCreated(facts, nodeKey(operation.ref))
        ? [nodeKey(operation.ref)]
        : [],
    );
    return created.length > 0 || updated.length > 0
      ? { created, updated }
      : null;
  },
  loads: () => [],
  check(state, scope, ctx) {
    const validate = (key: NodeKey, node: ProjectedNode | undefined) => {
      if (!node || node.status === undefined) return;
      const rules = ctx.registry.getRulesForProject(node.type, ctx.projectId);
      if (!rules || rules.agentSettableStatuses.includes(node.status)) return;
      ctx.addIssue(
        `nodes.${key}.status`,
        'status_not_allowed',
        formatWorkItemStatusNotAllowedMessage(
          node.status,
          node.type,
          rules.agentSettableStatuses,
        ),
        REFERENTIAL,
        "Choose a status from the target work-item type's agent-settable status policy.",
      );
    };
    scope.created.forEach((key) =>
      validate(key, checkableCreate(state, key, ctx)),
    );
    scope.updated.forEach((key) => validate(key, liveNode(state, key)));
  },
};

type SectionSchemaScope = {
  created: NodeKey[];
  replaces: { node: NodeKey; index: number; key: string; content: unknown }[];
};

export const sectionSchemaRule: ProjectionRule<SectionSchemaScope> = {
  id: 'section.schema',
  appliesTo(facts) {
    const replaces = facts.request.operations.flatMap((operation, index) =>
      operation.op === 'section.replace' &&
      !isCreated(facts, nodeKey(operation.ref))
        ? [
            {
              node: nodeKey(operation.ref),
              index,
              key: operation.key,
              content: operation.content as unknown,
            },
          ]
        : [],
    );
    return facts.creates.length > 0 || replaces.length > 0
      ? { created: createdKeys(facts), replaces }
      : null;
  },
  loads: () => [],
  check(state, scope, ctx) {
    for (const key of scope.created) {
      const node = checkableCreate(state, key, ctx);
      if (node) validateCreatedSections(key, node, ctx);
    }
    for (const replace of scope.replaces) {
      const node = liveNode(state, replace.node);
      if (!node) continue;
      const definition = ctx.registry.getSectionDefinition(
        node.type,
        replace.key,
        ctx.projectId,
      );
      if (!definition) {
        ctx.addIssue(
          `operations[${replace.index}].key`,
          'invalid_section',
          `${replace.key} is not declared for ${node.type}.`,
          REFERENTIAL,
        );
        continue;
      }
      validateSectionContent(
        definition,
        { key: replace.key, content: replace.content },
        `operations[${replace.index}].content`,
        ctx,
      );
    }
  },
};

function validateCreatedSections(
  key: NodeKey,
  node: ProjectedNode,
  ctx: RuleContext,
): void {
  const definitionsByKey = new Map(
    ctx.registry
      .getSectionDefinitions(node.type, ctx.projectId)
      .map((definition) => [definition.key, definition]),
  );
  const seen = new Set<string>();
  node.sections.forEach((section, index) => {
    if (seen.has(section.key)) {
      ctx.addIssue(
        `nodes.${key}.sections[${index}].key`,
        'duplicate_section',
        `Section ${section.key} appears more than once.`,
        REFERENTIAL,
      );
    }
    seen.add(section.key);
    const definition = definitionsByKey.get(section.key);
    if (!definition) {
      ctx.addIssue(
        `nodes.${key}.sections[${index}].key`,
        'invalid_section',
        `${section.key} is not declared for ${node.type}.`,
        REFERENTIAL,
      );
      return;
    }
    validateSectionContent(
      definition,
      section,
      `nodes.${key}.sections[${index}].content`,
      ctx,
    );
  });
}

function validateSectionContent(
  definition: WorkItemTypeSectionDefinition,
  section: ProjectedWorkItemSection,
  field: string,
  ctx: RuleContext,
): void {
  const result = ctx.sectionValidators.validate(definition, section.content);
  if (!result.success) {
    ctx.addIssue(field, result.code, result.message, REFERENTIAL);
    return;
  }
  if (definition.schemaRef !== PROJECT_MODE_SETTINGS_SCHEMA_REF) return;
  const ineligible = findIneligibleProjectModeTypeKeys(
    JSON.parse(result.canonicalContent) as ProjectModeSettings,
    (typeKey) => ctx.registry.isTypeActiveForProject(typeKey, ctx.projectId),
  );
  if (ineligible.length > 0) {
    ctx.addIssue(
      `${field}.eligibleWorkItemTypeKeys`,
      'invalid_json_section',
      `Eligible work-item type keys must be active in the project's effective registry: ${ineligible.join(', ')}.`,
      REFERENTIAL,
    );
  }
}

const PLAN_STAGE_CHILD_SECTIONS = ['description', 'acceptanceCriteria'];

type PlanStageChildScope = {
  /** Section keys to check per node, in first-touched order. */
  nodes: { node: NodeKey; created: boolean; keys: string[] }[];
};

export const planStageChildRule: ProjectionRule<PlanStageChildScope> = {
  id: 'plan.stageChild',
  appliesTo(facts) {
    const keysByNode = new Map<NodeKey, Set<string>>();
    // Parent types are facts; checking a section never loads the parent node.
    const mayBeStageChild = (node: NodeKey) =>
      facts.parentTypeOf(node) === 'PLAN_STAGE';
    const touch = (node: NodeKey, keys: readonly string[]) => {
      if (facts.typeOf(node) !== 'STANDARD' || !mayBeStageChild(node)) return;
      const touched = keysByNode.get(node) ?? new Set<string>();
      keys.forEach((key) => touched.add(key));
      keysByNode.set(node, touched);
    };
    facts.creates.forEach(({ node }) => touch(node, PLAN_STAGE_CHILD_SECTIONS));
    facts.updates.forEach((update) => {
      if (update.parentChange && !isCreated(facts, update.node))
        touch(update.node, PLAN_STAGE_CHILD_SECTIONS);
    });
    facts.sectionWrites.forEach((write) => {
      if (
        PLAN_STAGE_CHILD_SECTIONS.includes(write.key) &&
        !isCreated(facts, write.node)
      )
        touch(write.node, [write.key]);
    });
    if (keysByNode.size === 0) return null;
    return {
      nodes: [...keysByNode].map(([node, keys]) => ({
        node,
        created: isCreated(facts, node),
        keys: PLAN_STAGE_CHILD_SECTIONS.filter((key) => keys.has(key)),
      })),
    };
  },
  loads: () => [],
  check(state, scope, ctx) {
    for (const { node: key, created, keys } of scope.nodes) {
      const node = created
        ? checkableCreate(state, key, ctx)
        : liveNode(state, key);
      if (!node || node.type !== 'STANDARD' || !node.parent) continue;
      if (ctx.facts.parentTypeOf(key) !== 'PLAN_STAGE') continue;
      for (const sectionKey of keys) {
        const content = node.sections.find(
          (section) => section.key === sectionKey,
        )?.content;
        if (typeof content === 'string' && content.trim().length > 0) continue;
        ctx.addIssue(
          `nodes.${key}.sections.${sectionKey}`,
          'missing_required_section',
          `A direct STANDARD child of PLAN_STAGE requires ${sectionKey}.`,
          REFERENTIAL,
        );
      }
    }
  },
};
