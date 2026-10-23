import { FeatureRequirementAuthoringService } from '../feature-requirement-authoring.service';

const FEATURE = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const PLAN = '44444444-4444-4444-8444-444444444444';
const CONTRACT = '55555555-5555-4555-8555-555555555555';
const DOC = '66666666-6666-4666-8666-666666666666';
const SUB_FEATURE = '88888888-8888-4888-8888-888888888888';
const MOCKUP = '99999999-9999-4999-8999-999999999999';

const registry = {
  getRulesForProject: (type: string) =>
    type === 'STANDARD' ? { role: 'work-item' } : { role: 'project-info' },
} as any;

function serviceWith(tasks: object[] = [], docs: object[] = []) {
  return {
    service: new FeatureRequirementAuthoringService(registry),
    context: {
      organizationId: 'org',
      projectId: 'project',
      workItemId: FEATURE,
      effectiveParentId: PARENT,
      db: {
        task: { findMany: jest.fn().mockResolvedValue(tasks) },
        designDoc: { findMany: jest.fn().mockResolvedValue(docs) },
      },
    },
  };
}

const record = (overrides: object = {}) => ({
  id: '77777777-7777-4777-8777-777777777777',
  statement: 'A requirement',
  designedBy: [],
  fulfilledBy: [],
  contracts: [],
  ...overrides,
});

describe('FeatureRequirementAuthoringService', () => {
  it.each(['DIAGRAM_ELEMENT', 'workflow_step'])(
    'accepts %s fulfillment without changing its identity',
    async (type) => {
      const { service, context } = serviceWith([
        { id: TASK, projectId: 'project', type },
      ]);
      const section = {
        records: [
          record({
            fulfilledBy: [
              { entityType: 'TASK', entityId: TASK, entityTitle: 'Cited' },
            ],
          }),
        ],
      };
      expect(await service.validate(section, context)).toMatchObject({
        success: true,
        section,
      });
    },
  );
  it('accepts typed same-project references and retains PLAN and FEATURE target identity', async () => {
    const { service, context } = serviceWith(
      [
        { id: TASK, projectId: 'project', type: 'STANDARD' },
        { id: PLAN, projectId: 'project', type: 'PLAN' },
        { id: CONTRACT, projectId: 'project', type: 'CONTRACT' },
        { id: SUB_FEATURE, projectId: 'project', type: 'FEATURE' },
      ],
      [{ id: DOC, projectId: 'project' }],
    );
    const section = {
      records: [
        record({
          designedBy: [
            { entityType: 'DESIGN_DOC', entityId: DOC, entityTitle: 'Cited' },
          ],
          fulfilledBy: [
            { entityType: 'TASK', entityId: TASK, entityTitle: 'Cited' },
            { entityType: 'TASK', entityId: SUB_FEATURE, entityTitle: 'Cited' },
            { entityType: 'PLAN', entityId: PLAN, entityTitle: 'Cited' },
          ],
          contracts: [
            {
              entityType: 'CONTRACT',
              entityId: CONTRACT,
              entityTitle: 'Cited',
            },
          ],
        }),
      ],
    };
    const result = await service.validate(section, context);
    expect(result).toMatchObject({ success: true, section });
  });

  it.each([
    ['missing', TASK, [], 'entity_not_found'],
    [
      'foreign project',
      TASK,
      [{ id: TASK, projectId: 'other', type: 'STANDARD' }],
      'foreign_project',
    ],
    [
      'self',
      FEATURE,
      [{ id: FEATURE, projectId: 'project', type: 'FEATURE' }],
      'excluded_reference',
    ],
    [
      'effective parent',
      PARENT,
      [{ id: PARENT, projectId: 'project', type: 'FEATURE' }],
      'excluded_reference',
    ],
    [
      'PLAN coerced to TASK',
      PLAN,
      [{ id: PLAN, projectId: 'project', type: 'PLAN' }],
      'wrong_type',
    ],
    [
      'CONTRACT in fulfillment',
      CONTRACT,
      [{ id: CONTRACT, projectId: 'project', type: 'CONTRACT' }],
      'wrong_slot',
    ],
    [
      'mockup in fulfillment',
      MOCKUP,
      [{ id: MOCKUP, projectId: 'project', type: 'mockup' }],
      'wrong_slot',
    ],
    [
      'DIAGRAM in fulfillment',
      TASK,
      [{ id: TASK, projectId: 'project', type: 'DIAGRAM' }],
      'wrong_slot',
    ],
    [
      'workflow in fulfillment',
      TASK,
      [{ id: TASK, projectId: 'project', type: 'workflow' }],
      'wrong_slot',
    ],
  ])('rejects %s references', async (_name, entityId, tasks, code) => {
    const { service, context } = serviceWith(tasks as object[]);
    const result = await service.validate(
      {
        records: [
          record({
            fulfilledBy: [
              { entityType: 'TASK', entityId, entityTitle: 'Cited' },
            ],
          }),
        ],
      },
      context,
    );
    expect(result).toMatchObject({ success: false, diagnostics: [{ code }] });
  });

  it.each([
    ['MOCKUP', 'mockup'],
    ['DIAGRAM', 'DIAGRAM'],
    ['DIAGRAM', 'workflow'],
  ])('accepts a same-project %s (%s) in designedBy', async (kind, type) => {
    const { service, context } = serviceWith([
      { id: MOCKUP, projectId: 'project', type },
    ]);
    const section = {
      records: [
        record({
          designedBy: [
            { entityType: kind, entityId: MOCKUP, entityTitle: 'Cited' },
          ],
        }),
      ],
    };
    expect(await service.validate(section, context)).toMatchObject({
      success: true,
      section,
    });
  });

  it.each([
    ['MOCKUP', 'missing', [], 'entity_not_found'],
    [
      'MOCKUP',
      'foreign project',
      [{ id: MOCKUP, projectId: 'other', type: 'mockup' }],
      'foreign_project',
    ],
    [
      'MOCKUP',
      'non-mockup',
      [{ id: MOCKUP, projectId: 'project', type: 'DIAGRAM' }],
      'wrong_type',
    ],
    ['DIAGRAM', 'missing', [], 'entity_not_found'],
    [
      'DIAGRAM',
      'foreign project',
      [{ id: MOCKUP, projectId: 'other', type: 'DIAGRAM' }],
      'foreign_project',
    ],
    [
      'DIAGRAM',
      'non-diagram',
      [{ id: MOCKUP, projectId: 'project', type: 'DIAGRAM_ELEMENT' }],
      'wrong_type',
    ],
  ])('rejects a %s design citation: %s', async (kind, _name, tasks, code) => {
    const { service, context } = serviceWith(tasks as object[]);
    const result = await service.validate(
      {
        records: [
          record({
            designedBy: [
              { entityType: kind, entityId: MOCKUP, entityTitle: 'Cited' },
            ],
          }),
        ],
      },
      context,
    );
    expect(result).toMatchObject({ success: false, diagnostics: [{ code }] });
  });

  it('rejects a persisted collection whose citation has no title', async () => {
    const { service, context } = serviceWith([
      { id: TASK, projectId: 'project', type: 'STANDARD' },
    ]);
    const result = await service.validate(
      {
        records: [
          record({ fulfilledBy: [{ entityType: 'TASK', entityId: TASK }] }),
        ],
      },
      context,
    );
    expect(result).toMatchObject({
      success: false,
      diagnostics: [{ code: 'invalid_structure' }],
    });
  });

  describe('citation titles', () => {
    const registryRow = (
      entityId: string,
      entityType: string,
      entityName: string | null,
      deletedAt: Date | null = null,
    ) => ({ entityId, entityType, entityName, deletedAt });

    function titleContext(rows: object[]) {
      const findMany = jest.fn().mockResolvedValue(rows);
      return {
        findMany,
        context: {
          organizationId: 'org',
          db: { entityRegistry: { findMany } } as any,
        },
      };
    }

    it('snapshots titles for every slot in one registry lookup', async () => {
      const { findMany, context } = titleContext([
        registryRow(DOC, 'DESIGN_DOC', 'Design'),
        registryRow(TASK, 'TASK', 'Build it'),
        registryRow(PLAN, 'TASK', 'The plan'),
        registryRow(CONTRACT, 'TASK', 'The contract'),
      ]);
      const service = new FeatureRequirementAuthoringService(registry);
      const result = await service.prepareInitialRequirements(
        [
          {
            statement: 'A requirement',
            designedBy: [{ entityType: 'DESIGN_DOC', entityId: DOC }],
            fulfilledBy: [
              { entityType: 'TASK', entityId: TASK },
              { entityType: 'PLAN', entityId: PLAN },
            ],
            contracts: [{ entityType: 'CONTRACT', entityId: CONTRACT }],
          },
        ],
        context,
        () => '77777777-7777-4777-8777-777777777777',
      );

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        success: true,
        section: {
          records: [
            {
              designedBy: [
                {
                  entityType: 'DESIGN_DOC',
                  entityId: DOC,
                  entityTitle: 'Design',
                },
              ],
              fulfilledBy: [
                { entityType: 'TASK', entityId: TASK, entityTitle: 'Build it' },
                { entityType: 'PLAN', entityId: PLAN, entityTitle: 'The plan' },
              ],
              contracts: [
                {
                  entityType: 'CONTRACT',
                  entityId: CONTRACT,
                  entityTitle: 'The contract',
                },
              ],
            },
          ],
        },
      });
    });

    it('keeps stored titles when the cited entity has since been renamed', async () => {
      const { findMany, context } = titleContext([
        registryRow(TASK, 'TASK', 'Renamed task'),
        registryRow(DOC, 'DESIGN_DOC', 'New doc'),
      ]);
      const service = new FeatureRequirementAuthoringService(registry);
      const current = {
        records: [
          record({
            fulfilledBy: [
              {
                entityType: 'TASK',
                entityId: TASK,
                entityTitle: 'Original task',
              },
            ],
          }),
        ],
      };
      const result = await service.prepareRequirementOperations(
        current,
        [
          {
            op: 'update',
            targetId: '77777777-7777-4777-8777-777777777777',
            designedBy: { add: [{ entityType: 'DESIGN_DOC', entityId: DOC }] },
          },
        ],
        context,
      );

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany.mock.calls[0][0].where.entityId.in).toEqual([DOC]);
      expect(result).toMatchObject({
        success: true,
        section: {
          records: [
            {
              designedBy: [{ entityId: DOC, entityTitle: 'New doc' }],
              fulfilledBy: [{ entityId: TASK, entityTitle: 'Original task' }],
            },
          ],
        },
      });
    });

    it('skips the lookup when every citation already has a title', async () => {
      const { findMany, context } = titleContext([]);
      const service = new FeatureRequirementAuthoringService(registry);
      const result = await service.prepareRequirementOperations(
        {
          records: [
            record({
              fulfilledBy: [
                { entityType: 'TASK', entityId: TASK, entityTitle: 'Stored' },
              ],
            }),
          ],
        },
        [
          {
            op: 'update',
            targetId: '77777777-7777-4777-8777-777777777777',
            statement: 'Reworded',
          },
        ],
        context,
      );
      expect(findMany).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it.each([
      ['missing from the registry', []],
      ['deleted', [registryRow(TASK, 'TASK', 'Gone', new Date())]],
      ['untitled', [registryRow(TASK, 'TASK', null)]],
    ])('rejects a citation whose target is %s', async (_name, rows) => {
      const { context } = titleContext(rows as object[]);
      const service = new FeatureRequirementAuthoringService(registry);
      const result = await service.prepareInitialRequirements(
        [
          {
            statement: 'A requirement',
            fulfilledBy: [{ entityType: 'TASK', entityId: TASK }],
          },
        ],
        context,
      );
      expect(result).toMatchObject({
        success: false,
        diagnostics: [
          {
            field: 'initialRequirements.records[0].fulfilledBy[0]',
            code: 'entity_not_found',
          },
        ],
      });
    });
  });
});
