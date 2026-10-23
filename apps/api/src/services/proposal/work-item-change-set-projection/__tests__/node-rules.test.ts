import type {
  ProjectedWorkItem,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
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
const TASK = 'aaaaaaaa-0000-4000-8000-000000000004';
const SUBTASK = 'aaaaaaaa-0000-4000-8000-000000000005';
const LEAF = 'aaaaaaaa-0000-4000-8000-000000000006';
const MISSING = 'aaaaaaaa-0000-4000-8000-0000000000ff';

type Row = {
  id: string;
  name: string;
  type: string;
  parentTaskId: string | null;
  sections: { key: string; materializedMarkdown: string | null }[];
};

const row = (
  id: string,
  type: string,
  parentTaskId: string | null,
  sections: Row['sections'] = [],
): Row => ({ id, name: id, type, parentTaskId, sections });

const ROWS: Row[] = [
  row(FEATURE, 'FEATURE', null),
  row(PLAN, 'PLAN', FEATURE),
  row(STAGE, 'PLAN_STAGE', PLAN),
  // A Plan task with no stored description or acceptance criteria.
  row(TASK, 'STANDARD', STAGE),
  row(SUBTASK, 'STANDARD', TASK),
  row(LEAF, 'STANDARD', SUBTASK),
];

const toRecord = (task: Row) => ({
  status: 'BACKLOG',
  priority: null,
  dueDate: null,
  assigneeId: null,
  tag: null,
  serviceRelations: [],
  parentTask: task.parentTaskId
    ? { type: ROWS.find((row) => row.id === task.parentTaskId)!.type }
    : null,
  ...task,
});

function matches(task: Row, where: Record<string, unknown>): boolean {
  const id = where['id'];
  if (typeof id === 'string') return task.id === id;
  if (id && typeof id === 'object' && 'in' in id)
    return (id.in as string[]).includes(task.id);
  if ('parentTaskId' in where)
    return task.parentTaskId === where['parentTaskId'];
  return false;
}

describe('ported node and reference rules', () => {
  let registry: WorkItemTypeRegistryService;

  beforeAll(async () => {
    registry = await createWarmWorkItemTypeRegistry();
  });

  function projector() {
    const findMany = jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        ROWS.filter((task) => matches(task, where)).map(toRecord),
    );
    const findFirst = jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        ROWS.find((task) => matches(task, where)) ?? null,
    );
    const service = new WorkItemChangeSetProjectorService(
      {
        db: {
          task: { findMany, findFirst },
          service: { findMany: jest.fn().mockResolvedValue([]) },
        },
      } as unknown as PrismaService,
      registry,
      new WorkItemParentageValidator(registry),
      { findIncident: jest.fn().mockResolvedValue([]) } as never,
      () => 'service-token',
    );
    return {
      project: (
        request: WorkItemChangeSetValidationRequest,
        overlayNodes?: readonly ProjectedWorkItem[],
      ) =>
        service.project({ organizationId, projectId, request, overlayNodes }),
      findMany,
    };
  }

  describe('plan.stageChild', () => {
    it.each([
      ['temporary', 'description', '   ', true],
      ['temporary', 'acceptanceCriteria', '   ', true],
      ['temporary', 'description', 'Defined work.', false],
      ['temporary', 'acceptanceCriteria', 'Verifiable result.', false],
      ['existing', 'description', '   ', true],
      ['existing', 'acceptanceCriteria', '   ', true],
      ['existing', 'description', 'Defined work.', false],
      ['existing', 'acceptanceCriteria', 'Verifiable result.', false],
    ] as const)(
      'checks %s overlay-only task %s content %j (missing: %s)',
      async (refType, key, content, missing) => {
        const { project, findMany } = projector();
        const identity: WorkItemChangeSetIdentity =
          refType === 'temporary'
            ? { refType, tempId: 'overlay-task' }
            : { refType, id: MISSING };
        const parent: WorkItemChangeSetIdentity = {
          refType: 'temporary',
          tempId: 'overlay-stage',
        };
        const projected = await project(
          {
            root: identity,
            operations: [
              { op: 'section.replace', ref: identity, key, content },
            ],
          },
          [
            {
              identity: parent,
              label: 'Stage',
              name: 'Stage',
              type: 'PLAN_STAGE',
              sections: [],
              deleted: false,
            },
            {
              identity,
              parent,
              label: 'Task',
              name: 'Task',
              type: 'STANDARD',
              sections: [],
              deleted: false,
            },
          ],
        );

        const issues = projected.issues.filter(
          (issue) => issue.code === 'missing_required_section',
        );
        expect(issues).toEqual(
          missing
            ? [
                expect.objectContaining({
                  field: `nodes.${refType}:${refType === 'temporary' ? 'overlay-task' : MISSING}.sections.${key}`,
                  reason: `A direct STANDARD child of PLAN_STAGE requires ${key}.`,
                }),
              ]
            : [],
        );
        // Only named existing identities are hydrated; no parent is loaded.
        expect(findMany).toHaveBeenCalledTimes(refType === 'existing' ? 1 : 0);
      },
    );

    it('checks the written key using the joined parent type without loading the Plan Stage', async () => {
      const { project, findMany } = projector();

      const projected = await project({
        root: { refType: 'existing', id: TASK },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: TASK },
            key: 'acceptanceCriteria',
            content: '   ',
          },
        ],
      });

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            parentTask: { select: { type: true } },
          }),
        }),
      );
      expect(
        projected.issues.filter(
          (issue) => issue.code === 'missing_required_section',
        ),
      ).toEqual([
        expect.objectContaining({
          field: `nodes.existing:${TASK}.sections.acceptanceCriteria`,
          code: 'missing_required_section',
          reason:
            'A direct STANDARD child of PLAN_STAGE requires acceptanceCriteria.',
        }),
      ]);
    });

    it('does not run on an update that neither reparents nor writes its sections', async () => {
      const { project } = projector();

      const projected = await project({
        root: { refType: 'existing', id: TASK },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: TASK },
            name: 'Renamed',
          },
        ],
      });

      expect(
        projected.issues.some(
          (issue) => issue.code === 'missing_required_section',
        ),
      ).toBe(false);
    });
  });

  describe('node.parentage', () => {
    it('reports an existing node reparented to an unavailable existing parent', async () => {
      const { project } = projector();

      // Before declared loads both ends being existing and the parent being
      // absent from projected state skipped this check.
      const projected = await project({
        root: { refType: 'existing', id: SUBTASK },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: SUBTASK },
            parent: { refType: 'existing', id: MISSING },
          },
        ],
      });

      const field = `nodes.existing:${SUBTASK}.parent`;
      expect(projected.issues.filter((issue) => issue.field === field)).toEqual(
        [
          expect.objectContaining({ code: 'dangling_reference' }),
          expect.objectContaining({ code: 'invalid_parent' }),
        ],
      );
      expect(projected.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: `references.${MISSING}`,
            code: 'dangling_reference',
          }),
        ]),
      );
    });
  });

  describe('identity.boundary', () => {
    it('places a deep descendant inside the root graph from its ancestor chain', async () => {
      const { project } = projector();

      const projected = await project({
        root: { refType: 'existing', id: STAGE },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: LEAF },
            key: 'description',
            content: 'Leaf detail.',
          },
        ],
      });

      expect(
        projected.issues.filter(
          (issue) => issue.code === 'cross_root_reference',
        ),
      ).toEqual([]);
    });

    it('rejects a reference whose ancestor chain does not reach the root', async () => {
      const { project } = projector();

      const projected = await project({
        root: { refType: 'existing', id: TASK },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: STAGE },
            key: 'description',
            content: 'Stage detail.',
          },
        ],
      });

      expect(projected.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'operations[0].ref',
            code: 'cross_root_reference',
          }),
        ]),
      );
    });
  });

  describe('name.collision', () => {
    it('finds a same-named stored sibling under a parent that is not the root', async () => {
      const { project } = projector();

      const projected = await project({
        root: { refType: 'temporary', tempId: 'task' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'task' },
            name: SUBTASK,
            type: 'STANDARD',
            parent: { refType: 'existing', id: TASK },
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'task' },
            key: 'description',
            content: 'Duplicate.',
          },
        ],
      });

      expect(projected.warnings).toEqual([
        expect.objectContaining({
          field: 'operations[0].name',
          code: 'work_item_name_collision',
          suggestion: expect.any(String),
        }),
      ]);
      expect(projected.issues).not.toContainEqual(
        expect.objectContaining({ code: 'work_item_name_collision' }),
      );
    });

    it('does not warn when the same-named sibling is a different type', async () => {
      const { project } = projector();

      const projected = await project({
        root: { refType: 'temporary', tempId: 'task' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'task' },
            name: SUBTASK,
            type: 'BUG',
            parent: { refType: 'existing', id: TASK },
          },
        ],
      });

      expect(projected.warnings).toEqual([]);
      expect(projected.issues).not.toContainEqual(
        expect.objectContaining({ code: 'work_item_name_collision' }),
      );
    });
  });
});
