import { ReportType as PrismaReportType } from '@prisma/client';
import { ReadRestriction } from '../../generated';
import type {
  EntityNeighborhoodResponse,
  IncidentEdgesResponse,
  SearchRequest,
  StructuredGraphReadResponse,
} from '../../generated/graphs';
import { GraphReadScope } from '../graph-read-scope';
import { ReadPolicyContext, readPolicyFor } from '../read-policy';
import { ReadVisibilityService } from '../read-visibility.service';
import {
  scopeEmbeddingsRequest,
  assertSearchCanCarryReadPolicy,
} from '../embeddings-read-scope';

const SEED = 'seed-feature';
const EVAL_CASE = 'eval-case-with-grading-answers';
const EVAL_REPORT = 'eval-attempt-report';
const PERMITTED_TASK = 'permitted-standard-task';
const PERMITTED_REPORT = 'permitted-review-report';

/** A project with a protected Eval Case and attempt report next to ordinary records. */
const projectRecords = {
  tasks: [
    { id: SEED, type: 'FEATURE' },
    { id: EVAL_CASE, type: 'EVAL_CASE' },
    { id: PERMITTED_TASK, type: 'STANDARD' },
  ],
  reports: [
    { id: EVAL_REPORT, reportType: PrismaReportType.EVAL_ATTEMPT },
    { id: PERMITTED_REPORT, reportType: PrismaReportType.REVIEW },
  ],
};

const prismaOverProject = () => ({
  db: {
    task: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { id: { in: string[] }; type: { in: string[] } };
        }) =>
          Promise.resolve(
            projectRecords.tasks.filter(
              (task) =>
                where.id.in.includes(task.id) &&
                where.type.in.includes(task.type),
            ),
          ),
      ),
    },
    report: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { id: { in: string[] }; reportType: { in: string[] } };
        }) =>
          Promise.resolve(
            projectRecords.reports.filter(
              (report) =>
                where.id.in.includes(report.id) &&
                where.reportType.in.includes(report.reportType),
            ),
          ),
      ),
    },
  },
});

const scopeOver = (prisma = prismaOverProject()) =>
  new GraphReadScope(new ReadVisibilityService(prisma as never));

const asEvaluatedAttempt = <T>(read: () => T): T =>
  ReadPolicyContext.run(readPolicyFor(ReadRestriction.EvalTarget), read);

describe('graph reads under a read restriction', () => {
  const search: SearchRequest = {
    seedEntityIds: [SEED],
    filters: {
      taskTypes: ['EVAL_CASE', 'STANDARD'],
      excludeTaskTypes: ['BUG'],
    },
  };

  it('carries the exclusions into the graph query, beside whatever the caller excluded', () => {
    const scoped = asEvaluatedAttempt(() => scopeOver().scopeSearch(search));

    expect(scoped.filters?.excludeTaskTypes).toEqual([
      'BUG',
      'EVAL',
      'EVAL_CASE',
    ]);
    expect(scoped.filters?.excludeReportTypes).toEqual([
      'EVAL_RUN',
      'EVAL_ATTEMPT',
      'EVAL_HUMAN_REVIEW',
    ]);
    // Asking for a protected type leaves the request as asked; the query still excludes it.
    expect(scoped.filters?.taskTypes).toEqual(['EVAL_CASE', 'STANDARD']);
  });

  it('leaves an ordinary search exactly as it was', () => {
    expect(scopeOver().scopeSearch(search)).toBe(search);
  });

  it('removes protected endpoints and the edges that reach them from incident edges', async () => {
    const response = {
      groups: [
        {
          seedEntityId: SEED,
          neighborTotal: 3,
          endpoints: [
            {
              entityId: EVAL_CASE,
              entityType: 'TASK',
              displayName: 'Retry eval',
              taskType: 'EVAL_CASE',
            },
            {
              entityId: PERMITTED_TASK,
              entityType: 'TASK',
              displayName: 'Permitted',
            },
            {
              entityId: EVAL_REPORT,
              entityType: 'REPORT',
              displayName: 'Attempt',
            },
          ],
          relationships: [
            { id: 'r1', sourceNodeId: SEED, targetNodeId: EVAL_CASE },
            { id: 'r2', sourceNodeId: SEED, targetNodeId: PERMITTED_TASK },
            { id: 'r3', sourceNodeId: EVAL_REPORT, targetNodeId: SEED },
          ],
        },
        {
          seedEntityId: EVAL_CASE,
          neighborTotal: 1,
          endpoints: [],
          relationships: [],
        },
      ],
    } as unknown as IncidentEdgesResponse;

    const scoped = await asEvaluatedAttempt(() =>
      scopeOver().scopeIncidentEdges(response),
    );

    expect(
      scoped.groups[0]?.endpoints.map((endpoint) => endpoint.entityId),
    ).toEqual([PERMITTED_TASK]);
    expect(scoped.groups[0]?.relationships.map((edge) => edge.id)).toEqual([
      'r2',
    ]);
    // A protected seed reads as a seed with no edges at all.
    expect(scoped.groups[1]).toMatchObject({
      neighborTotal: 0,
      endpoints: [],
      relationships: [],
    });
    expect(JSON.stringify(scoped)).not.toContain('Retry eval');
  });

  it('keeps every endpoint for an ordinary session and for the judge’s task reads', async () => {
    const response = {
      groups: [
        {
          seedEntityId: SEED,
          neighborTotal: 1,
          endpoints: [
            {
              entityId: EVAL_CASE,
              entityType: 'TASK',
              displayName: 'Retry eval',
            },
          ],
          relationships: [
            { id: 'r1', sourceNodeId: SEED, targetNodeId: EVAL_CASE },
          ],
        },
      ],
    } as unknown as IncidentEdgesResponse;

    expect(await scopeOver().scopeIncidentEdges(response)).toBe(response);
    await expect(
      ReadPolicyContext.run(readPolicyFor(ReadRestriction.EvalJudge), () =>
        scopeOver().scopeIncidentEdges(response),
      ),
    ).resolves.toBe(response);
  });

  it('removes protected entities from neighborhoods, including pivot hops that pass through them', async () => {
    const response = {
      relatedEntities: [
        {
          entityId: EVAL_CASE,
          entityType: 'TASK',
          displayName: 'Retry eval',
          relationship: 'related',
        },
        {
          entityId: PERMITTED_TASK,
          entityType: 'TASK',
          displayName: 'Permitted',
          relationship: 'sibling',
          via: [
            {
              entityId: EVAL_CASE,
              entityType: 'TASK',
              displayName: 'Retry eval',
            },
          ],
        },
        {
          entityId: SEED,
          entityType: 'TASK',
          displayName: 'Seed',
          relationship: 'related',
        },
      ],
      agentSessions: [],
      nodeCatalog: [
        { entityId: EVAL_CASE, entityType: 'TASK', displayName: 'Retry eval' },
        { entityId: SEED, entityType: 'TASK', displayName: 'Seed' },
      ],
    } as unknown as EntityNeighborhoodResponse;

    const scoped = await asEvaluatedAttempt(() =>
      scopeOver().scopeNeighborhood(response),
    );

    expect(scoped.relatedEntities.map((entity) => entity.entityId)).toEqual([
      SEED,
    ]);
    expect(scoped.nodeCatalog?.map((node) => node.entityId)).toEqual([SEED]);
  });

  it('drops structured-read targets and paths that touch protected entities', async () => {
    const identity = (entityId: string) => ({ entityId, entityType: 'TASK' });
    const response = {
      directEdges: [],
      expansions: [
        {
          key: 'children',
          targets: [
            {
              identity: identity(EVAL_CASE),
              paths: [{ identities: [identity(SEED), identity(EVAL_CASE)] }],
            },
            {
              identity: identity(PERMITTED_TASK),
              paths: [
                {
                  identities: [
                    identity(SEED),
                    identity(EVAL_CASE),
                    identity(PERMITTED_TASK),
                  ],
                },
                { identities: [identity(SEED), identity(PERMITTED_TASK)] },
              ],
            },
          ],
        },
      ],
    } as unknown as StructuredGraphReadResponse;

    const scoped = await asEvaluatedAttempt(() =>
      scopeOver().scopeStructuredRead(response),
    );

    expect(scoped.expansions[0]?.targets).toHaveLength(1);
    expect(scoped.expansions[0]?.targets[0]?.paths).toEqual([
      { identities: [identity(SEED), identity(PERMITTED_TASK)] },
    ]);
  });

  it('never queries the database for an unrestricted read', async () => {
    const prisma = prismaOverProject();

    await scopeOver(prisma).scopeNeighborhood({
      relatedEntities: [],
      agentSessions: [],
    } as EntityNeighborhoodResponse);

    expect(prisma.db.task.findMany).not.toHaveBeenCalled();
    expect(prisma.db.report.findMany).not.toHaveBeenCalled();
  });

  it('reports a permitted report next to a protected one only for the judge-visible type', async () => {
    const hidden = await asEvaluatedAttempt(() =>
      new ReadVisibilityService(prismaOverProject() as never).hiddenIds([
        { entityType: 'REPORT', entityId: EVAL_REPORT },
        { entityType: 'REPORT', entityId: PERMITTED_REPORT },
      ]),
    );

    expect([...hidden]).toEqual([EVAL_REPORT]);
  });
});

describe('embeddings searches under a read restriction', () => {
  it('excludes protected task types inside the embeddings query alongside caller exclusions', () => {
    const scoped = asEvaluatedAttempt(() =>
      scopeEmbeddingsRequest({
        query: 'retry failed attempts',
        filters: { excludeTaskTypes: ['BUG'] },
      } as never),
    );

    expect(scoped.filters?.excludeTaskTypes).toEqual([
      'BUG',
      'EVAL',
      'EVAL_CASE',
    ]);
  });

  it('refuses the search endpoints that cannot carry exclusions, rather than answering unfiltered', () => {
    expect(() => asEvaluatedAttempt(assertSearchCanCarryReadPolicy)).toThrow(
      /unified search/,
    );
    expect(() => assertSearchCanCarryReadPolicy()).not.toThrow();
  });
});

describe('proposal history under a read restriction', () => {
  const visibility = () =>
    new ReadVisibilityService(prismaOverProject() as never);
  const proposals = [
    {
      id: 'edits-eval-case',
      targetEntityId: EVAL_CASE,
      targetEntityType: 'TASK',
      updates: {},
    },
    {
      id: 'creates-eval-case',
      targetEntityId: 'not-yet-a-task',
      targetEntityType: 'TASK',
      updates: { type: 'EVAL_CASE', name: 'New case with grading answers' },
    },
    {
      id: 'edits-feature',
      targetEntityId: SEED,
      targetEntityType: 'TASK',
      updates: { type: 'FEATURE' },
    },
    {
      id: 'edits-design-doc',
      targetEntityId: 'design-doc',
      targetEntityType: 'DESIGN_DOC',
      updates: {},
    },
  ];

  it('drops proposals that target, or would create, protected work items', async () => {
    const visible = await asEvaluatedAttempt(() =>
      visibility().filterVisibleProposals(proposals),
    );

    expect(visible.map((proposal) => proposal.id)).toEqual([
      'edits-feature',
      'edits-design-doc',
    ]);
  });

  it('keeps every proposal for an ordinary session and for eval authoring', async () => {
    expect(await visibility().filterVisibleProposals(proposals)).toHaveLength(
      4,
    );
  });

  it('answers a direct read of a protected record like one that does not exist', async () => {
    await expect(
      asEvaluatedAttempt(() => visibility().assertVisible('TASK', EVAL_CASE)),
    ).rejects.toThrow(/not found/);
    await expect(
      asEvaluatedAttempt(() =>
        visibility().assertVisible('TASK', PERMITTED_TASK),
      ),
    ).resolves.toBeUndefined();
    await expect(
      visibility().assertVisible('TASK', EVAL_CASE),
    ).resolves.toBeUndefined();
  });
});
