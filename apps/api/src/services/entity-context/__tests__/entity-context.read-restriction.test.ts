import { NotFoundException } from '@nestjs/common';
import { ReadRestriction } from '../../../generated';
import { EntityType } from '../../../generated/model/entityType';
import {
  ReadPolicyContext,
  readPolicyFor,
} from '../../../read-restriction/read-policy';
import { EntityContextService } from '../entity-context.service';

const ORG = 'org-1' as never;
const PROJECT = 'project-1' as never;
const FEATURE = 'feature-agent-evaluations';
const EVAL_CASE = 'eval-case-with-grading-answers';

const records = [
  {
    id: FEATURE,
    name: 'Agent Evaluations',
    type: 'FEATURE',
    createdAt: new Date('2026-10-01'),
  },
  {
    id: EVAL_CASE,
    name: 'Retry failed attempts',
    type: 'EVAL_CASE',
    createdAt: new Date('2026-10-02'),
  },
];

const matchesType = (
  record: { type: string },
  filter: { in?: string[]; notIn?: string[] } | undefined,
) =>
  !filter ||
  ((filter.in?.includes(record.type) ?? true) &&
    !(filter.notIn?.includes(record.type) ?? false));

const buildService = () => {
  const taskFindMany = jest.fn(
    ({
      where,
    }: {
      where: {
        id?: { in: string[] };
        type?: { in?: string[]; notIn?: string[] };
      };
    }) =>
      Promise.resolve(
        records.filter(
          (record) =>
            (!where.id || where.id.in.includes(record.id)) &&
            matchesType(record, where.type),
        ),
      ),
  );
  const prisma = {
    db: {
      task: {
        findMany: taskFindMany,
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            records.find((record) => record.id === where.id) ?? null,
          ),
        ),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      proposal: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    },
  };
  const registry = { getHierarchyNodeTypes: () => ['FEATURE'] };
  const service = new EntityContextService(
    {} as never,
    prisma as never,
    {} as never,
    registry as never,
    {} as never,
  );

  return { service, prisma };
};

const asEvaluatedAttempt = <T>(read: () => T): T =>
  ReadPolicyContext.run(readPolicyFor(ReadRestriction.EvalTarget), read);

const quietly = { includeProposals: false, includeAvailableMcpTools: false };

describe('entity context under a read restriction', () => {
  it('answers a read of a protected Eval Case exactly like a record that does not exist', async () => {
    const { service } = buildService();

    await expect(
      asEvaluatedAttempt(() =>
        service.getEntityContext(ORG, EntityType.Task, EVAL_CASE, quietly),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still reads the Feature the Eval Case belongs to, and the Eval Case for ordinary sessions', async () => {
    const { service } = buildService();

    await expect(
      asEvaluatedAttempt(() =>
        service.getEntityContext(ORG, EntityType.Task, FEATURE, quietly),
      ),
    ).resolves.toMatchObject({ entityId: FEATURE, taskType: 'FEATURE' });
    await expect(
      service.getEntityContext(ORG, EntityType.Task, EVAL_CASE, quietly),
    ).resolves.toMatchObject({ entityId: EVAL_CASE, taskType: 'EVAL_CASE' });
  });

  it('never consults protected targets when it gathers proposal history', async () => {
    const { service, prisma } = buildService();

    await asEvaluatedAttempt(() =>
      service.getEntityContext(
        ORG,
        EntityType.Task,
        FEATURE,
        {
          includeProposals: true,
          includeAvailableMcpTools: false,
        },
        [FEATURE, EVAL_CASE],
      ),
    ).catch(() => undefined);

    const proposalQueries = prisma.db.proposal.findMany.mock.calls.map(
      ([args]: [{ where: { targetEntityId: { in: string[] } } }]) =>
        args.where.targetEntityId.in,
    );
    expect(proposalQueries).toEqual([[FEATURE]]);
  });

  it('refuses feature-sync context for a protected item before reading its ancestry', async () => {
    const { service, prisma } = buildService();

    await expect(
      asEvaluatedAttempt(() =>
        service.getFeatureSyncContext(ORG, PROJECT, EVAL_CASE as never),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps protected work items out of feature listings and their direct-task counts', async () => {
    const { service, prisma } = buildService();

    await asEvaluatedAttempt(() => service.listFeatures(ORG, PROJECT, 50, 0));
    await service.listFeatures(ORG, PROJECT, 50, 0);

    const [restricted, ordinary] = prisma.db.task.findMany.mock.calls.map(
      ([args]) => args.where,
    );
    expect(JSON.stringify(restricted)).toContain(
      '"notIn":["EVAL","EVAL_CASE"]',
    );
    expect(JSON.stringify(ordinary)).not.toContain('EVAL_CASE');
  });
});
