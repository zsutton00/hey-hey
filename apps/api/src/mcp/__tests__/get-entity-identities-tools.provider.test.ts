import {
  GetEntityIdentitiesToolsProvider,
  getEntityIdentitiesParameters,
} from '../tools/get-entity-identities-tools.provider';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000f1';
const PROJECT = '00000000-0000-4000-8000-000000000002';
const OTHER_PROJECT = '00000000-0000-4000-8000-0000000000f2';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Row {
  id: string;
  name: string;
  organizationId: string;
  projectId: string;
  archivedAt: Date | null;
  status: string;
  type?: string;
  template?: string;
}

type Where = {
  id: { in: string[] };
  organizationId: string;
  projectId: string;
  archivedAt: null;
  status: { not: string };
};

/** In-memory tables that honour the scoping filters the provider sends. */
function createFakeDb(tables: {
  registry: {
    entityId: string;
    entityType: string;
    entityName: string | null;
    organizationId: string;
    deletedAt: Date | null;
  }[];
  task: Row[];
  designDoc: Row[];
  service: Row[];
}) {
  const scoped = (rows: Row[]) =>
    jest.fn(async ({ where }: { where: Where }) =>
      rows.filter(
        (row) =>
          where.id.in.includes(row.id) &&
          row.organizationId === where.organizationId &&
          row.projectId === where.projectId &&
          row.archivedAt === where.archivedAt &&
          row.status !== where.status.not,
      ),
    );
  const db = {
    entityRegistry: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            organizationId: string;
            deletedAt: null;
            OR: { entityId: string; entityType: string }[];
          };
        }) =>
          tables.registry.filter(
            (row) =>
              row.organizationId === where.organizationId &&
              row.deletedAt === where.deletedAt &&
              where.OR.some(
                (pair) =>
                  pair.entityId === row.entityId &&
                  pair.entityType === row.entityType,
              ),
          ),
      ),
    },
    task: { findMany: scoped(tables.task) },
    designDoc: { findMany: scoped(tables.designDoc) },
    service: { findMany: scoped(tables.service) },
  };
  return db;
}

const registryRow = (
  entityId: string,
  entityType: string,
  entityName: string | null,
  overrides: { organizationId?: string; deletedAt?: Date | null } = {},
) => ({
  entityId,
  entityType,
  entityName,
  organizationId: overrides.organizationId ?? ORG,
  deletedAt: overrides.deletedAt ?? null,
});

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
  id: id(n),
  name: `Name ${n}`,
  organizationId: ORG,
  projectId: PROJECT,
  archivedAt: null,
  status: 'ACTIVE',
  ...overrides,
});

const request = {
  headers: { authorization: 'Bearer tok', 'x-project-id': PROJECT },
  cookies: {},
  user: { userId: 'u1', email: 'a@b.c', currentOrgId: ORG, orgMemberships: [] },
} as never;

const registry = {
  getRulesForProject: (key: string, projectId: string) =>
    projectId === PROJECT && ['FEATURE', 'BUG', 'PLAN', 'custom'].includes(key)
      ? {}
      : undefined,
} as unknown as WorkItemTypeRegistryService;

async function lookup(
  db: ReturnType<typeof createFakeDb>,
  entities: { entityType: string; entityId: string }[],
) {
  const provider = new GetEntityIdentitiesToolsProvider(
    { db } as unknown as PrismaService,
    registry,
  );
  const result = await provider.getEntityIdentities(
    getEntityIdentitiesParameters.parse({ entities }),
    {} as never,
    request,
  );
  return result as { isError?: boolean; content: { text: string }[] };
}

const parsed = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0]!.text) as Record<string, unknown>;

describe('get_entity_identities', () => {
  it('returns exactly the five identity fields across work items, documents and services', async () => {
    const db = createFakeDb({
      registry: [
        registryRow(id(1), 'TASK', 'Search Tools'),
        registryRow(id(2), 'TASK', 'A bug'),
        registryRow(id(3), 'TASK', 'The plan'),
        registryRow(id(4), 'TASK', 'Custom thing'),
        registryRow(id(5), 'DESIGN_DOC', 'Doc title'),
        registryRow(id(6), 'SERVICE', 'API'),
      ],
      task: [
        row(1, { type: 'FEATURE' }),
        row(2, { type: 'BUG', status: 'BACKLOG' }),
        row(3, { type: 'PLAN' }),
        row(4, { type: 'custom' }),
      ],
      designDoc: [row(5, { template: 'ADR', status: 'ADR_CONTEXT' })],
      service: [row(6)],
    });

    const result = await lookup(db, [
      // Alias need not match the stored subtype.
      { entityType: 'TASK', entityId: id(1) },
      { entityType: 'BUG', entityId: id(2) },
      { entityType: 'PLAN', entityId: id(3) },
      { entityType: 'custom', entityId: id(4) },
      { entityType: 'DESIGN_DOC', entityId: id(5) },
      { entityType: 'SERVICE', entityId: id(6) },
    ]);

    expect(parsed(result)).toEqual({
      [id(1)]: {
        entityType: 'TASK',
        entityId: id(1),
        title: 'Search Tools',
        status: 'ACTIVE',
        itemType: 'FEATURE',
      },
      [id(2)]: {
        entityType: 'TASK',
        entityId: id(2),
        title: 'A bug',
        status: 'BACKLOG',
        itemType: 'BUG',
      },
      [id(3)]: {
        entityType: 'TASK',
        entityId: id(3),
        title: 'The plan',
        status: 'ACTIVE',
        itemType: null,
      },
      [id(4)]: {
        entityType: 'TASK',
        entityId: id(4),
        title: 'Custom thing',
        status: 'ACTIVE',
        itemType: 'custom',
      },
      [id(5)]: {
        entityType: 'DESIGN_DOC',
        entityId: id(5),
        title: 'Doc title',
        status: 'ADR_CONTEXT',
        itemType: 'ADR',
      },
      [id(6)]: {
        entityType: 'SERVICE',
        entityId: id(6),
        title: 'API',
        status: 'ACTIVE',
        itemType: null,
      },
    });
  });

  it('returns independent nulls for unknown, foreign, archived and deleted identities', async () => {
    const db = createFakeDb({
      registry: [
        registryRow(id(1), 'TASK', 'Visible'),
        registryRow(id(2), 'TASK', 'Other org', { organizationId: OTHER_ORG }),
        registryRow(id(3), 'TASK', 'Other project'),
        registryRow(id(4), 'TASK', 'Archived'),
        registryRow(id(5), 'TASK', 'Deleted', { deletedAt: new Date() }),
        registryRow(id(6), 'DESIGN_DOC', 'Foreign doc'),
        registryRow(id(7), 'SERVICE', 'Archived service'),
        registryRow(id(9), 'TASK', 'Archived by status'),
        registryRow(id(10), 'DESIGN_DOC', 'Archived doc by status'),
        registryRow(id(11), 'SERVICE', 'Archived service by status'),
      ],
      task: [
        row(1, { type: 'FEATURE' }),
        row(2, { organizationId: OTHER_ORG, type: 'FEATURE' }),
        row(3, { projectId: OTHER_PROJECT, type: 'FEATURE' }),
        row(4, { archivedAt: new Date(), type: 'FEATURE' }),
        row(5, { type: 'FEATURE' }),
        row(9, { type: 'FEATURE', status: 'ARCHIVED' }),
      ],
      designDoc: [
        row(6, { projectId: OTHER_PROJECT, template: 'ADR' }),
        row(10, { template: 'ADR', status: 'ARCHIVED' }),
      ],
      service: [
        row(7, { archivedAt: new Date() }),
        row(11, { status: 'ARCHIVED' }),
      ],
    });

    const result = await lookup(db, [
      ...[1, 2, 3, 4, 5, 8].map((n) => ({
        entityType: 'FEATURE',
        entityId: id(n),
      })),
      { entityType: 'DESIGN_DOC', entityId: id(6) },
      { entityType: 'SERVICE', entityId: id(7) },
      { entityType: 'FEATURE', entityId: id(9) },
      { entityType: 'DESIGN_DOC', entityId: id(10) },
      { entityType: 'SERVICE', entityId: id(11) },
    ]);

    const body = parsed(result);
    expect(body[id(1)]).toMatchObject({ title: 'Visible' });
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      expect(body[id(n)]).toBeNull();
    }
    expect(result.content[0]!.text).not.toMatch(
      /Other org|Other project|Archived|Deleted|Foreign/,
    );
  });

  it('uses one registry query and one narrow query per owning table, with no content selected', async () => {
    const db = createFakeDb({
      registry: [
        registryRow(id(1), 'TASK', 'One'),
        registryRow(id(2), 'TASK', 'Two'),
        registryRow(id(3), 'DESIGN_DOC', 'Three'),
      ],
      task: [row(1, { type: 'FEATURE' }), row(2, { type: 'BUG' })],
      designDoc: [row(3, { template: 'ADR' })],
      service: [],
    });

    await lookup(db, [
      { entityType: 'FEATURE', entityId: id(1) },
      { entityType: 'BUG', entityId: id(2) },
      { entityType: 'DESIGN_DOC', entityId: id(3) },
    ]);

    expect(db.entityRegistry.findMany).toHaveBeenCalledTimes(1);
    expect(db.task.findMany).toHaveBeenCalledTimes(1);
    expect(db.designDoc.findMany).toHaveBeenCalledTimes(1);
    expect(db.service.findMany).not.toHaveBeenCalled();
    for (const call of [
      ...db.task.findMany.mock.calls,
      ...db.designDoc.findMany.mock.calls,
    ]) {
      expect(call[0]).not.toHaveProperty('include');
    }
  });

  it('accepts 50 pairs, rejects 51, and rejects an empty batch', () => {
    const pairs = (count: number) =>
      Array.from({ length: count }, (_, n) => ({
        entityType: 'TASK',
        entityId: id(n + 1),
      }));

    expect(
      getEntityIdentitiesParameters.safeParse({ entities: pairs(50) }).success,
    ).toBe(true);
    expect(
      getEntityIdentitiesParameters.safeParse({ entities: pairs(51) }).success,
    ).toBe(false);
    expect(
      getEntityIdentitiesParameters.safeParse({ entities: [] }).success,
    ).toBe(false);
  });

  it('rejects an entity type that is neither canonical nor a registered work-item key', async () => {
    const db = createFakeDb({
      registry: [],
      task: [],
      designDoc: [],
      service: [],
    });

    const result = await lookup(db, [
      { entityType: 'NOT_A_TYPE', entityId: id(1) },
    ]);

    expect(result.isError).toBe(true);
    expect(db.entityRegistry.findMany).not.toHaveBeenCalled();
  });
});
