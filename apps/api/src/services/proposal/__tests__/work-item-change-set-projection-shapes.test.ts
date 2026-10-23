import type {
  WorkItemChangeSetOperation,
  WorkItemChangeSetValidationRequest,
} from '../../../generated';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { OrganizationId, ProjectId } from '../../../types';
import { createWarmWorkItemTypeRegistry } from '../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import type { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import type { WorkItemTypeGraphCapability } from '../../../generated/model/workItemTypeGraphCapability';
import {
  loadIdentity,
  planProjection,
  type Load,
} from '../work-item-change-set-projection/projection-rule';
import type {
  ProjectedNode,
  ProjectionState,
} from '../work-item-change-set-projection/projection-state';
import { deriveRequestFacts } from '../work-item-change-set-projection/request-facts';
import { PROJECTION_RULES } from '../work-item-change-set-projection/rules';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';

/**
 * One row per Shape Table entry in "Declared Rule Applicability for Work-Item
 * Change-Set Validation". Each row pins the planner's exact active rule ids
 * and loads; rows that assert no loads also pin that projection performs no
 * read beyond the facts phase and no Graph call.
 */

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
// A project the warm registry fixture seeds with the built-in types.
const projectId = '00000000-0000-4000-8000-000000000002' as ProjectId;

const FEATURE = 'aaaaaaaa-0000-4000-8000-000000000001';
const TASK = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER_TASK = 'aaaaaaaa-0000-4000-8000-000000000003';
const PLAN = 'aaaaaaaa-0000-4000-8000-000000000004';
const STAGE = 'aaaaaaaa-0000-4000-8000-000000000005';
const OTHER_STAGE = 'aaaaaaaa-0000-4000-8000-000000000006';
const DIAGRAM = 'aaaaaaaa-0000-4000-8000-000000000007';
const ELEMENT = 'aaaaaaaa-0000-4000-8000-000000000008';
const OTHER_ELEMENT = 'aaaaaaaa-0000-4000-8000-000000000009';
const STANDARD_UNDER_FEATURE = 'aaaaaaaa-0000-4000-8000-00000000000a';
const EDGE = 'bbbbbbbb-0000-4000-8000-000000000001';
const SERVICE = 'cccccccc-0000-4000-8000-000000000001';

const existing = (id: string) => ({ refType: 'existing' as const, id });
const temporary = (tempId: string) => ({
  refType: 'temporary' as const,
  tempId,
});
const key = (id: string) => `existing:${id}`;

/** Stored type and parent of every existing node a shape touches. */
const STORED: Record<string, { type: string; parent?: string }> = {
  [FEATURE]: { type: 'FEATURE' },
  [TASK]: { type: 'STANDARD', parent: STAGE },
  [OTHER_TASK]: { type: 'STANDARD', parent: STAGE },
  [PLAN]: { type: 'PLAN', parent: FEATURE },
  [STAGE]: { type: 'PLAN_STAGE', parent: PLAN },
  [OTHER_STAGE]: { type: 'PLAN_STAGE', parent: PLAN },
  [DIAGRAM]: { type: 'DIAGRAM', parent: FEATURE },
  [ELEMENT]: { type: 'DIAGRAM_ELEMENT', parent: DIAGRAM },
  [OTHER_ELEMENT]: { type: 'DIAGRAM_ELEMENT', parent: DIAGRAM },
  [STANDARD_UNDER_FEATURE]: { type: 'STANDARD', parent: FEATURE },
};

const BASE_RULES = [
  'ref.existence',
  'op.typeAvailable',
  'op.refResolves',
  'identity.boundary',
];
const CREATE_RULES = [
  'request.tempRefs',
  // The create names its existing parent, which is `ref.existence`'s trigger;
  // a missing parent still reports `references.<id>`.
  'ref.existence',
  'identity.boundary',
  'node.typeActive',
  'node.parentage',
  'node.requiredScalars',
  'section.schema',
  'name.collision',
];

type ShapeRow = {
  shape: string;
  request: WorkItemChangeSetValidationRequest;
  rules: string[];
  loads: Load[];
};

const dependsOn = (
  source: string,
  target: string,
): WorkItemChangeSetOperation => ({
  op: 'relationship.create',
  ref: temporary('dependency'),
  source: existing(source),
  target: existing(target),
  edgeType: 'DEPENDS_ON',
  category: 'meta',
});

const SHAPES: ShapeRow[] = [
  {
    shape: 'FEATURE description replace (root has 20 children)',
    request: {
      root: existing(FEATURE),
      operations: [
        {
          op: 'section.replace',
          ref: existing(FEATURE),
          key: 'description',
          content: 'Updated.',
        },
      ],
    },
    rules: [...BASE_RULES, 'section.schema'],
    loads: [],
  },
  {
    shape: 'FEATURE requirements replace',
    request: {
      root: existing(FEATURE),
      operations: [
        {
          op: 'section.replace',
          ref: existing(FEATURE),
          key: 'requirements',
          content: { records: [] },
        },
      ],
    },
    rules: [...BASE_RULES, 'section.schema', 'feature.requirements'],
    loads: [
      { kind: 'requirementCitations', feature: key(FEATURE), records: [] },
    ],
  },
  {
    shape: 'FEATURE requirements clear',
    request: {
      root: existing(FEATURE),
      operations: [
        { op: 'section.clear', ref: existing(FEATURE), key: 'requirements' },
      ],
    },
    rules: [...BASE_RULES, 'section.clear'],
    loads: [],
  },
  {
    shape: 'STANDARD description replace under FEATURE',
    request: {
      root: existing(STANDARD_UNDER_FEATURE),
      operations: [
        {
          op: 'section.replace',
          ref: existing(STANDARD_UNDER_FEATURE),
          key: 'description',
          content: 'Updated.',
        },
      ],
    },
    rules: [...BASE_RULES, 'section.schema'],
    loads: [],
  },
  {
    shape: 'STANDARD update name and priority only',
    request: {
      root: existing(STANDARD_UNDER_FEATURE),
      operations: [
        {
          op: 'workItem.update',
          ref: existing(STANDARD_UNDER_FEATURE),
          name: 'Renamed',
          priority: 'HIGH',
        },
      ],
    },
    rules: BASE_RULES,
    loads: [],
  },
  {
    shape: 'STANDARD update with serviceIds',
    request: {
      root: existing(STANDARD_UNDER_FEATURE),
      operations: [
        {
          op: 'workItem.update',
          ref: existing(STANDARD_UNDER_FEATURE),
          serviceIds: [SERVICE],
        },
      ],
    },
    rules: [...BASE_RULES, 'service.refs'],
    loads: [{ kind: 'services', ids: [SERVICE] }],
  },
  {
    shape: 'STANDARD under PLAN_STAGE, acceptanceCriteria replace',
    request: {
      root: existing(TASK),
      operations: [
        {
          op: 'section.replace',
          ref: existing(TASK),
          key: 'acceptanceCriteria',
          content: '- Done.',
        },
      ],
    },
    rules: [...BASE_RULES, 'section.schema', 'plan.stageChild'],
    loads: [],
  },
  {
    shape: 'STANDARD reparent to another PLAN_STAGE',
    request: {
      root: existing(TASK),
      operations: [
        {
          op: 'workItem.update',
          ref: existing(TASK),
          parent: existing(OTHER_STAGE),
        },
      ],
    },
    rules: [
      ...BASE_RULES,
      'node.parentage',
      'plan.stageChild',
      'plan.dependencies.boundary',
    ],
    // The incident-edge load carries each far endpoint's parent and its type.
    loads: [
      { kind: 'incidentEdges', of: key(TASK), edgeTypes: ['DEPENDS_ON'] },
    ],
  },
  {
    shape: 'STANDARD create under a FEATURE',
    request: {
      root: temporary('task'),
      operations: [
        {
          op: 'workItem.create',
          ref: temporary('task'),
          name: 'New task',
          type: 'STANDARD',
          parent: existing(FEATURE),
        },
      ],
    },
    rules: CREATE_RULES,
    loads: [
      { kind: 'parent', of: 'temporary:task' },
      { kind: 'siblingsNamed', parent: key(FEATURE), name: 'New task' },
    ],
  },
  {
    shape: 'DEPENDS_ON create between two STANDARD tasks in one PLAN_STAGE',
    request: {
      root: existing(TASK),
      operations: [dependsOn(TASK, OTHER_TASK)],
    },
    rules: [
      'request.tempRefs',
      'ref.existence',
      'op.refResolves',
      'identity.boundary',
      'relationship.endpoints',
      'dependency.topology',
      'plan.dependencies.boundary',
    ],
    loads: [
      { kind: 'incidentEdges', of: key(TASK), edgeTypes: ['DEPENDS_ON'] },
      { kind: 'dependsOnClosure', from: [key(OTHER_TASK)], edges: [] },
    ],
  },
  {
    shape: 'PLAN_STAGE name update',
    request: {
      root: existing(STAGE),
      operations: [
        { op: 'workItem.update', ref: existing(STAGE), name: 'Renamed' },
      ],
    },
    rules: BASE_RULES,
    loads: [],
  },
  {
    shape: 'DEPENDS_ON create between two PLAN_STAGE nodes',
    request: {
      root: existing(PLAN),
      operations: [dependsOn(OTHER_STAGE, STAGE)],
    },
    rules: [
      'request.tempRefs',
      'ref.existence',
      'op.refResolves',
      'identity.boundary',
      'relationship.endpoints',
      'dependency.topology',
      'plan.dependencies.boundary',
      'plan.dependencies.chain',
    ],
    loads: [
      { kind: 'planStages', plan: key(PLAN) },
      {
        kind: 'incidentEdges',
        of: key(OTHER_STAGE),
        edgeTypes: ['DEPENDS_ON'],
      },
      { kind: 'dependsOnClosure', from: [key(STAGE)], edges: [] },
    ],
  },
  {
    shape:
      'relationship delete of an existing edge between two untouched children',
    request: {
      root: existing(DIAGRAM),
      operations: [{ op: 'relationship.delete', ref: existing(EDGE) }],
    },
    rules: [
      'ref.existence',
      'relationship.existence',
      'op.refResolves',
      'identity.boundary',
    ],
    loads: [{ kind: 'edgeById', ref: key(EDGE) }],
  },
  {
    shape: 'DIAGRAM groups section replace',
    request: {
      root: existing(DIAGRAM),
      operations: [
        {
          op: 'section.replace',
          ref: existing(DIAGRAM),
          key: 'diagramGroups',
          content: { schemaVersion: 'diagram-groups.v1', groups: [] },
        },
      ],
    },
    rules: [...BASE_RULES, 'section.schema', 'diagram.groups'],
    loads: [{ kind: 'children', of: key(DIAGRAM) }],
  },
  {
    shape:
      'DIAGRAM element create with flow relationship and layout replace (with layoutBoundary)',
    request: {
      root: existing(DIAGRAM),
      layoutBoundary: [existing(ELEMENT), temporary('element')],
      operations: [
        {
          op: 'workItem.create',
          ref: temporary('element'),
          name: 'New element',
          type: 'DIAGRAM_ELEMENT',
          parent: existing(DIAGRAM),
        },
        {
          op: 'relationship.create',
          ref: temporary('flow'),
          source: existing(ELEMENT),
          target: temporary('element'),
          edgeType: 'FLOWS_TO',
          category: 'flow',
        },
        {
          op: 'layout.replace',
          root: existing(DIAGRAM),
          sectionKey: 'graphLayout',
          entries: [
            { node: existing(ELEMENT), position: { x: 0, y: 0 } },
            { node: temporary('element'), position: { x: 10, y: 0 } },
          ],
        },
      ] as WorkItemChangeSetOperation[],
    },
    // The layout replace names the existing root, so the op-level rules apply.
    rules: [
      ...CREATE_RULES,
      'op.typeAvailable',
      'op.refResolves',
      'relationship.endpoints',
      'layout.sectionKey',
      'layout.identityUnique',
      'layout.boundary',
      'diagram.metadata',
      // A child create under a groups-capable Diagram; no load beyond named.
      'diagram.groups',
    ],
    loads: [
      { kind: 'parent', of: 'temporary:element' },
      { kind: 'siblingsNamed', parent: key(DIAGRAM), name: 'New element' },
      { kind: 'diagramTargets', of: ['temporary:element'] },
    ],
  },
  {
    shape: 'DIAGRAM element delete',
    request: {
      root: existing(DIAGRAM),
      operations: [{ op: 'workItem.delete', ref: existing(ELEMENT) }],
    },
    rules: [...BASE_RULES, 'diagram.groups'],
    loads: [],
  },
  {
    shape: 'DIAGRAM description replace',
    request: {
      root: existing(DIAGRAM),
      operations: [
        {
          op: 'section.replace',
          ref: existing(DIAGRAM),
          key: 'description',
          content: 'Updated.',
        },
      ],
    },
    rules: [...BASE_RULES, 'section.schema'],
    loads: [],
  },
];

function namedIds(request: WorkItemChangeSetValidationRequest): string[] {
  return Object.keys(STORED).filter((id) =>
    JSON.stringify(request).includes(`"${id}"`),
  );
}

/** The facts-phase state: every directly named existing node, hydrated. */
function factsState(request: WorkItemChangeSetValidationRequest) {
  const state: ProjectionState = {
    nodes: new Map(),
    relationships: new Map(),
    identityLabels: {},
    issues: [],
    warnings: [],
    layoutEntries: new Map(),
    deletedLayoutRoots: new Set(),
    unavailableWorkItemIds: new Set(),
  };
  for (const id of namedIds(request)) {
    const stored = STORED[id]!;
    state.nodes.set(key(id), {
      identity: existing(id),
      label: id,
      type: stored.type,
      name: id,
      parent: stored.parent ? existing(stored.parent) : undefined,
      sections: [],
      deleted: false,
    } as ProjectedNode);
  }
  return state;
}

const sortedLoads = (loads: readonly Load[]) =>
  [...loads].map(loadIdentity).sort();

function storedRow(id: string) {
  const stored = STORED[id]!;
  return {
    id,
    name: id,
    type: stored.type,
    parentTaskId: stored.parent ?? null,
    parentTask: stored.parent ? { type: STORED[stored.parent]!.type } : null,
    status: 'BACKLOG',
    priority: null,
    dueDate: null,
    assigneeId: null,
    tag: null,
    sections: [],
    serviceRelations: [],
  };
}

describe('Work-item change-set projection shapes', () => {
  let registry: WorkItemTypeRegistryService;

  beforeAll(async () => {
    registry = await createWarmWorkItemTypeRegistry();
    // The fixture lacks the Flyway-seeded Diagram groups capability.
    const graphCapability = registry.getGraphCapability.bind(registry);
    jest
      .spyOn(registry, 'getGraphCapability')
      .mockImplementation(
        (
          typeKey: string,
          project: string,
        ): WorkItemTypeGraphCapability | null => {
          const capability: WorkItemTypeGraphCapability | null =
            graphCapability(typeKey, project);
          return typeKey === 'DIAGRAM'
            ? ({
                ...capability,
                groups: {
                  sectionKey: 'diagramGroups',
                  schemaRef: '#/components/schemas/DiagramGroupsValue',
                },
              } as WorkItemTypeGraphCapability)
            : capability;
        },
      );
  });

  for (const row of SHAPES) {
    it(row.shape, async () => {
      const plan = planProjection({
        rules: PROJECTION_RULES,
        facts: deriveRequestFacts(
          row.request,
          factsState(row.request),
          new Map(
            namedIds(row.request).map((id) => [
              key(id),
              STORED[id]!.parent ? STORED[STORED[id]!.parent!]!.type : null,
            ]),
          ),
        ),
        registry,
        projectId,
      });

      expect(plan.active.map(({ rule }) => rule.id as string).sort()).toEqual(
        [...row.rules].sort(),
      );
      expect(sortedLoads(plan.loads)).toEqual(sortedLoads(row.loads));

      if (row.loads.length > 0) return;
      const findMany = jest.fn(
        async ({ where }: { where: { id?: unknown } }) =>
          typeof where.id === 'object' && where.id !== null && 'in' in where.id
            ? (where.id.in as string[]).map(storedRow)
            : [],
      );
      const findIncident = jest.fn().mockResolvedValue([]);
      const projector = new WorkItemChangeSetProjectorService(
        {
          db: {
            task: { findMany, findFirst: jest.fn() },
            service: { findMany: jest.fn().mockResolvedValue([]) },
          },
        } as unknown as PrismaService,
        registry,
        new WorkItemParentageValidator(registry),
        { findIncident, get: jest.fn() } as never,
        () => 'service-token',
      );
      await projector.project({
        organizationId,
        projectId,
        request: row.request,
      });
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findIncident).not.toHaveBeenCalled();
    });
  }

  describe('footprint', () => {
    const shape = (name: string) =>
      SHAPES.find((row) => row.shape.startsWith(name))!.request;

    async function footprint(request: WorkItemChangeSetValidationRequest) {
      const findMany = jest.fn(
        async ({
          where,
        }: {
          where: { id?: unknown; parentTaskId?: string };
        }) =>
          typeof where.id === 'object' && where.id !== null && 'in' in where.id
            ? (where.id.in as string[]).map(storedRow)
            : typeof where.id === 'string'
              ? [storedRow(where.id)]
              : where.parentTaskId
                ? Object.keys(STORED)
                    .filter((id) => STORED[id]!.parent === where.parentTaskId)
                    .map(storedRow)
                : [],
      );
      const projector = new WorkItemChangeSetProjectorService(
        {
          db: {
            task: {
              findMany,
              findFirst: jest.fn(
                async ({ where }: { where: { id: string } }) =>
                  STORED[where.id] ? storedRow(where.id) : null,
              ),
            },
            service: { findMany: jest.fn().mockResolvedValue([]) },
          },
        } as unknown as PrismaService,
        registry,
        new WorkItemParentageValidator(registry),
        {
          findIncident: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
        } as never,
        () => 'service-token',
      );
      return projector.projectSnapshots({ organizationId, projectId, request });
    }

    it('is the root only for a FEATURE description replace', async () => {
      const { workItemKeys, relationshipKeys } = await footprint(
        shape('FEATURE description replace'),
      );
      expect(workItemKeys).toEqual([key(FEATURE)]);
      expect(relationshipKeys).toEqual([]);
    });

    it.each([
      'STANDARD description replace under FEATURE',
      'STANDARD under PLAN_STAGE',
    ])('keeps only the edited task for %s', async (name) => {
      const { workItemKeys, relationshipKeys } = await footprint(shape(name));
      expect(workItemKeys).toEqual([
        key(name.includes('FEATURE') ? STANDARD_UNDER_FEATURE : TASK),
      ]);
      expect(relationshipKeys).toEqual([]);
    });

    it('includes the Diagram and the children its groups rule read', async () => {
      const { workItemKeys } = await footprint(
        shape('DIAGRAM groups section replace'),
      );
      expect(workItemKeys).toEqual(
        [key(DIAGRAM), key(ELEMENT), key(OTHER_ELEMENT)].sort(),
      );
    });

    it('includes both DEPENDS_ON endpoints and the nodes its rules loaded', async () => {
      const { workItemKeys, relationshipKeys } = await footprint(
        shape('DEPENDS_ON create between two STANDARD tasks'),
      );
      expect(workItemKeys).toEqual([key(TASK), key(OTHER_TASK)].sort());
      expect(relationshipKeys).toEqual(['temporary:dependency']);
    });
  });
});
