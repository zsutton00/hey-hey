import { AxiosError, AxiosHeaders } from 'axios';
import type { WorkItemChangeSetValidationRequest } from 'src/generated';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { createWarmWorkItemTypeRegistry } from '../../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemParentageValidator } from '../../../tasks/work-item-parentage-validator.service';
import type { WorkItemTypeRegistryService } from '../../../tasks/work-item-type-registry.service';
import { WorkItemChangeSetProjectorService } from '../../work-item-change-set-projector.service';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
// A project the warm registry fixture seeds with the built-in types.
const projectId = '00000000-0000-4000-8000-000000000002' as ProjectId;

const FEATURE = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLAN = 'aaaaaaaa-0000-4000-8000-000000000002';
const STAGE = 'aaaaaaaa-0000-4000-8000-000000000003';
const OTHER_STAGE = 'aaaaaaaa-0000-4000-8000-000000000004';
const THIRD_STAGE = 'aaaaaaaa-0000-4000-8000-000000000005';
const TASK = 'aaaaaaaa-0000-4000-8000-000000000006';
const SIBLING = 'aaaaaaaa-0000-4000-8000-000000000007';
const OTHER_TASK = 'aaaaaaaa-0000-4000-8000-000000000008';
const STALE = 'aaaaaaaa-0000-4000-8000-0000000000fe';
const MISSING = 'aaaaaaaa-0000-4000-8000-0000000000ff';
const REQUIREMENT = 'cccccccc-0000-4000-8000-000000000001';
const NEW_REQUIREMENT = 'cccccccc-0000-4000-8000-000000000002';

type Row = {
  id: string;
  type: string;
  parentTaskId: string | null;
  sections?: { key: string; materializedMarkdown: string }[];
};
type Edge = { id: string; source: string; target: string; type?: string };

const existing = (id: string) => ({ refType: 'existing' as const, id });

function graph(rows: Row[], edges: Edge[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const record = (row: Row) => ({
    name: row.id,
    status: 'BACKLOG',
    priority: null,
    dueDate: null,
    assigneeId: null,
    tag: null,
    serviceRelations: [],
    sections: [],
    projectId,
    ...row,
    parentTask: row.parentTaskId
      ? { type: byId.get(row.parentTaskId)?.type }
      : null,
  });
  const matches = (row: Row, where: Record<string, unknown>) => {
    const id = where['id'];
    if (typeof id === 'string') return row.id === id;
    if (id && typeof id === 'object' && 'in' in id)
      return (id.in as string[]).includes(row.id);
    if ('parentTaskId' in where)
      return (
        row.parentTaskId === where['parentTaskId'] &&
        (where['type'] === undefined || row.type === where['type']) &&
        (where['name'] === undefined || row.id === where['name'])
      );
    return false;
  };
  const findMany = jest.fn(
    async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => matches(row, where)).map(record),
  );
  const graphEdge = (edge: Edge) => ({
    id: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    sourceEntityType: 'TASK',
    targetEntityType: 'TASK',
    type: edge.type ?? 'DEPENDS_ON',
    category: 'meta',
    reasoning: null,
  });
  const findIncident = jest.fn(
    async (
      _organization: unknown,
      _project: unknown,
      request: { nodeIds: Set<string>; types: Set<string> },
    ) =>
      edges
        .filter(
          (edge) =>
            request.types.has(edge.type ?? 'DEPENDS_ON') &&
            (request.nodeIds.has(edge.source) ||
              request.nodeIds.has(edge.target)),
        )
        .map(graphEdge),
  );
  const get = jest.fn(
    async (_organization: unknown, _project: unknown, id: string) => {
      const edge = edges.find((candidate) => candidate.id === id);
      if (edge) return graphEdge(edge);
      throw new AxiosError('not found', '404', undefined, undefined, {
        status: 404,
        statusText: 'Not Found',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      });
    },
  );
  return { findMany, findIncident, get };
}

const PLAN_ROWS: Row[] = [
  { id: FEATURE, type: 'FEATURE', parentTaskId: null },
  { id: PLAN, type: 'PLAN', parentTaskId: FEATURE },
  { id: STAGE, type: 'PLAN_STAGE', parentTaskId: PLAN },
  { id: OTHER_STAGE, type: 'PLAN_STAGE', parentTaskId: PLAN },
  { id: TASK, type: 'STANDARD', parentTaskId: STAGE },
  { id: SIBLING, type: 'STANDARD', parentTaskId: STAGE },
  { id: OTHER_TASK, type: 'STANDARD', parentTaskId: OTHER_STAGE },
];

describe('ported relationship, dependency, requirements and Plan rules', () => {
  let registry: WorkItemTypeRegistryService;

  beforeAll(async () => {
    registry = await createWarmWorkItemTypeRegistry();
  });

  function projector(rows: Row[], edges: Edge[] = []) {
    const fake = graph(rows, edges);
    const service = new WorkItemChangeSetProjectorService(
      {
        db: {
          task: { findMany: fake.findMany, findFirst: jest.fn() },
          service: { findMany: jest.fn().mockResolvedValue([]) },
          designDoc: { findMany: jest.fn().mockResolvedValue([]) },
        },
      } as unknown as PrismaService,
      registry,
      new WorkItemParentageValidator(registry),
      { findIncident: fake.findIncident, get: fake.get } as never,
      () => 'service-token',
    );
    return {
      ...fake,
      project: (request: WorkItemChangeSetValidationRequest) =>
        service.project({ organizationId, projectId, request }),
    };
  }

  describe('plan.dependencies.chain', () => {
    // Three stages with no DEPENDS_ON between them: a persisted disconnected chain.
    const brokenChain = [
      ...PLAN_ROWS,
      { id: THIRD_STAGE, type: 'PLAN_STAGE', parentTaskId: PLAN },
    ];

    it('does not check a persisted broken chain when deleting a non-dependency stage link', async () => {
      const { project } = projector(brokenChain, [
        {
          id: 'related',
          source: STAGE,
          target: OTHER_STAGE,
          type: 'RELATED_TO',
        },
      ]);

      const projected = await project({
        root: existing(PLAN),
        operations: [{ op: 'relationship.delete', ref: existing('related') }],
      });

      expect(projected.issues).toEqual([]);
    });

    it('still checks the chain when retyping a stage dependency away from DEPENDS_ON', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'chain', source: OTHER_STAGE, target: STAGE },
      ]);

      const projected = await project({
        root: existing(PLAN),
        operations: [
          {
            op: 'relationship.update',
            ref: existing('chain'),
            edgeType: 'RELATED_TO',
          },
        ],
      });

      expect(projected.issues).toEqual([
        expect.objectContaining({
          field: `nodes.existing:${PLAN}.stageDependencies`,
          code: 'plan_stage_disconnected',
        }),
      ]);
    });

    it('does not fail a PLAN_STAGE rename on a persisted broken chain', async () => {
      const { project } = projector(brokenChain);

      const projected = await project({
        root: existing(PLAN),
        operations: [
          { op: 'workItem.update', ref: existing(STAGE), name: 'Renamed' },
        ],
      });

      expect(projected.issues).toEqual([]);
    });

    it('still reports a stage cycle the request introduces, with unchanged codes and fields', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'chain', source: OTHER_STAGE, target: STAGE },
      ]);

      const projected = await project({
        root: existing(PLAN),
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'back' },
            source: existing(STAGE),
            target: existing(OTHER_STAGE),
            edgeType: 'DEPENDS_ON',
            category: 'meta',
          },
        ],
      });

      expect(projected.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: `nodes.existing:${PLAN}.stageDependencies`,
            code: 'plan_stage_cycle',
          }),
          expect.objectContaining({
            field: 'relationships.temporary:back',
            code: 'dependency_cycle',
          }),
        ]),
      );
    });
  });

  describe('plan.dependencies.boundary', () => {
    it('checks stored endpoint parents when retyping an edge without naming endpoints', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'retyped', source: TASK, target: OTHER_TASK, type: 'RELATED_TO' },
      ]);

      const projected = await project({
        root: existing(TASK),
        operations: [
          {
            op: 'relationship.update',
            ref: existing('retyped'),
            edgeType: 'DEPENDS_ON',
          },
        ],
      });

      expect(projected.issues).toEqual([
        expect.objectContaining({
          field: 'relationships.existing:retyped',
          code: 'cross_boundary_dependency',
        }),
      ]);
    });

    it('ignores a legacy cross-stage edge on an untouched sibling when adding a same-stage DEPENDS_ON', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'legacy', source: SIBLING, target: OTHER_TASK },
      ]);

      const projected = await project({
        root: existing(STAGE),
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'dependency' },
            source: existing(TASK),
            target: existing(SIBLING),
            edgeType: 'DEPENDS_ON',
            category: 'meta',
          },
        ],
      });

      expect(projected.issues).toEqual([]);
    });

    it('still reports a cross-stage DEPENDS_ON the request creates', async () => {
      const { project } = projector(PLAN_ROWS);

      const projected = await project({
        root: existing(TASK),
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'dependency' },
            source: existing(TASK),
            target: existing(OTHER_TASK),
            edgeType: 'DEPENDS_ON',
            category: 'meta',
          },
        ],
      });

      expect(projected.issues).toEqual([
        expect.objectContaining({
          field: 'relationships.temporary:dependency',
          code: 'cross_boundary_dependency',
        }),
      ]);
    });

    it("reports cross_boundary_dependency for a reparented task's own edges", async () => {
      // Before declared loads neither Stage was loaded for an edit rooted at
      // the task, so this passed silently.
      const { project } = projector(PLAN_ROWS, [
        { id: 'own', source: TASK, target: SIBLING },
      ]);

      const projected = await project({
        root: existing(TASK),
        operations: [
          {
            op: 'workItem.update',
            ref: existing(TASK),
            parent: existing(OTHER_STAGE),
          },
        ],
      });

      // plan.stageChild also reports the moved task's missing sections.
      expect(
        projected.issues.filter(
          (issue) => issue.code === 'cross_boundary_dependency',
        ),
      ).toEqual([
        expect.objectContaining({
          field: 'relationships.existing:own',
          code: 'cross_boundary_dependency',
        }),
      ]);
    });
  });

  describe('dependency.topology on a retype that names no endpoints', () => {
    const retype = {
      root: existing(PLAN),
      operations: [
        {
          op: 'relationship.update' as const,
          ref: existing('retyped'),
          edgeType: 'DEPENDS_ON' as const,
        },
      ],
    };

    it('reports duplicate_dependency when the stored source already depends on the target', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'retyped', source: TASK, target: SIBLING, type: 'RELATED_TO' },
        { id: 'duplicate', source: TASK, target: SIBLING },
      ]);

      const projected = await project(retype);

      expect(projected.issues).toEqual([
        expect.objectContaining({
          field: 'relationships.existing:retyped',
          code: 'duplicate_dependency',
        }),
      ]);
    });

    it('passes when the stored source has no duplicate dependency', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'retyped', source: TASK, target: SIBLING, type: 'RELATED_TO' },
      ]);

      const projected = await project(retype);

      expect(projected.issues).toEqual([]);
    });

    it('reports dependency_cycle when the retype closes a cycle', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'retyped', source: TASK, target: SIBLING, type: 'RELATED_TO' },
        { id: 'back', source: SIBLING, target: TASK },
      ]);

      const projected = await project(retype);

      expect(projected.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'relationships.existing:retyped',
            code: 'dependency_cycle',
          }),
        ]),
      );
    });

    it('passes when the retype closes no cycle', async () => {
      const { project } = projector(PLAN_ROWS, [
        { id: 'retyped', source: TASK, target: SIBLING, type: 'RELATED_TO' },
        { id: 'onward', source: SIBLING, target: OTHER_TASK },
      ]);

      const projected = await project(retype);

      expect(projected.issues).toEqual([]);
    });
  });

  describe('relationship.existence', () => {
    it('deletes an edge between two untouched children through edgeById', async () => {
      const { project, get } = projector(PLAN_ROWS, [
        { id: 'between', source: TASK, target: SIBLING },
      ]);

      const projected = await project({
        root: existing(PLAN),
        operations: [{ op: 'relationship.delete', ref: existing('between') }],
      });

      expect(get).toHaveBeenCalledWith(
        organizationId,
        projectId,
        'between',
        'service-token',
      );
      expect(projected.issues).toEqual([]);
    });

    it('keeps the relationships.existing dangling issue for an edge the Graph does not have', async () => {
      const { project } = projector(PLAN_ROWS);

      const projected = await project({
        root: existing(PLAN),
        operations: [{ op: 'relationship.delete', ref: existing('gone') }],
      });

      expect(projected.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'relationships.existing:gone',
            code: 'dangling_reference',
          }),
        ]),
      );
    });
  });

  describe('feature.requirements', () => {
    const citing = (id: string, statement: string, cited: string) => ({
      id,
      statement,
      designedBy: [],
      fulfilledBy: [
        { entityType: 'TASK', entityId: cited, entityTitle: 'Cited' },
      ],
      contracts: [],
    });
    const stored = { records: [citing(REQUIREMENT, 'Existing.', STALE)] };

    it('checks only records whose cites changed on a replace', async () => {
      const { project, findMany } = projector([
        {
          id: FEATURE,
          type: 'FEATURE',
          parentTaskId: null,
          sections: [
            {
              key: 'requirements',
              materializedMarkdown: JSON.stringify(stored),
            },
          ],
        },
      ]);

      const projected = await project({
        root: existing(FEATURE),
        operations: [
          {
            op: 'section.replace',
            ref: existing(FEATURE),
            key: 'requirements',
            content: {
              records: [
                // Same cites with new wording: the stale citation is not re-checked.
                { ...stored.records[0]!, statement: 'Existing, reworded.' },
                citing(NEW_REQUIREMENT, 'New.', MISSING),
              ],
            },
          },
        ],
      });

      expect(findMany).toHaveBeenCalledTimes(2);
      expect(findMany.mock.calls[1]![0]).toEqual({
        where: { id: { in: [MISSING] }, organizationId, archivedAt: null },
        select: { id: true, projectId: true, type: true },
      });
      expect(projected.issues).toEqual([
        expect.objectContaining({
          field: `nodes.existing:${FEATURE}.sections[requirements].records[1].fulfilledBy[0]`,
          code: 'feature_requirement_entity_not_found',
        }),
      ]);
    });

    it('loads no citations when requirements are cleared', async () => {
      const { project, findMany } = projector([
        {
          id: FEATURE,
          type: 'FEATURE',
          parentTaskId: null,
          sections: [
            {
              key: 'requirements',
              materializedMarkdown: JSON.stringify(stored),
            },
          ],
        },
      ]);
      const projected = await project({
        root: existing(FEATURE),
        operations: [
          { op: 'section.clear', ref: existing(FEATURE), key: 'requirements' },
        ],
      });
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(projected.issues.map((issue) => issue.code)).toEqual([
        'invalid_feature_requirement_section',
      ]);
    });

    it('does not load citations removed by a replacement', async () => {
      const { project, findMany } = projector([
        {
          id: FEATURE,
          type: 'FEATURE',
          parentTaskId: null,
          sections: [
            {
              key: 'requirements',
              materializedMarkdown: JSON.stringify(stored),
            },
          ],
        },
      ]);
      const projected = await project({
        root: existing(FEATURE),
        operations: [
          {
            op: 'section.replace',
            ref: existing(FEATURE),
            key: 'requirements',
            content: { records: [] },
          },
        ],
      });
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(projected.issues).toEqual([]);
    });

    it.each([false, true])(
      'loads only the new parent for unchanged citations on reparent (replace: %s)',
      async (replace) => {
        const content = {
          records: [
            citing(REQUIREMENT, 'Parent.', PLAN),
            citing(NEW_REQUIREMENT, 'Unrelated.', STALE),
          ],
        };
        const { project, findMany } = projector([
          {
            id: FEATURE,
            type: 'FEATURE',
            parentTaskId: null,
            sections: [
              {
                key: 'requirements',
                materializedMarkdown: JSON.stringify(content),
              },
            ],
          },
          { id: PLAN, type: 'FEATURE', parentTaskId: null },
        ]);
        const projected = await project({
          root: existing(FEATURE),
          operations: [
            {
              op: 'workItem.update',
              ref: existing(FEATURE),
              parent: existing(PLAN),
            },
            ...(replace
              ? [
                  {
                    op: 'section.replace' as const,
                    ref: existing(FEATURE),
                    key: 'requirements',
                    content,
                  },
                ]
              : []),
          ],
        });
        expect(findMany).toHaveBeenCalledTimes(2);
        expect(findMany.mock.calls[1]![0]).toEqual({
          where: { id: { in: [PLAN] }, organizationId, archivedAt: null },
          select: { id: true, projectId: true, type: true },
        });
        expect(projected.issues).toEqual([
          expect.objectContaining({
            field: `nodes.existing:${FEATURE}.sections[requirements].records[0].fulfilledBy[0]`,
            code: 'feature_requirement_excluded_reference',
          }),
        ]);
      },
    );

    it('loads all new requirement records for a created Feature', async () => {
      const { project, findMany } = projector([
        { id: FEATURE, type: 'FEATURE', parentTaskId: null },
      ]);
      const ref = { refType: 'temporary' as const, tempId: 'new-feature' };
      const projected = await project({
        root: ref,
        operations: [
          {
            op: 'workItem.create',
            ref,
            name: 'New feature',
            type: 'FEATURE',
            parent: existing(FEATURE),
          },
          {
            op: 'section.replace',
            ref,
            key: 'requirements',
            content: { records: [citing(REQUIREMENT, 'New.', MISSING)] },
          },
        ],
      });
      expect(findMany).toHaveBeenCalledWith({
        where: { id: { in: [MISSING] }, organizationId, archivedAt: null },
        select: { id: true, projectId: true, type: true },
      });
      expect(projected.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field:
              'nodes.temporary:new-feature.sections[requirements].records[0].fulfilledBy[0]',
            code: 'feature_requirement_entity_not_found',
          }),
        ]),
      );
    });
  });
});
