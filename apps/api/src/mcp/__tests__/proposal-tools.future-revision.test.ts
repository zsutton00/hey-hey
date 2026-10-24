import { BadRequestException } from '@nestjs/common';
import type { Context } from '@rekog/mcp-nest';
import type { Request } from 'express';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import type { LintRecoveryStore } from '../tools/lint-recovery.store';
import { ProposalToolsProvider } from '../tools/proposal-tools.provider';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';
import { TOOL_GUIDANCE } from '../tools/tool-guidance';
import {
  materializeFutureRevision,
  type FutureRevisionMaterializerPorts,
  type FutureTarget,
} from '../../services/proposal/future-revision-materializer';
import type { FutureRevisionAuthoring } from '../../generated';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '10000000-0000-4000-8000-000000000002';
const TARGET_ID = '10000000-0000-4000-8000-000000000003';
const FUTURE_ID = '10000000-0000-4000-8000-000000000004';
const WORK_ID = '10000000-0000-4000-8000-000000000005';
const PROPOSAL_ID = '10000000-0000-4000-8000-000000000006';

let registry: WorkItemTypeRegistryService;

beforeAll(async () => {
  registry = await createWarmWorkItemTypeRegistry();
});

const content = {
  id: TARGET_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  name: 'Live',
  type: 'STANDARD',
  status: 'BACKLOG',
  source: 'user',
  sections: [],
};

const liveContent = {
  ...content,
  sections: [
    {
      id: '10000000-0000-4000-8000-000000000007',
      key: 'description',
      order: 0,
      materializedMarkdown: 'Live',
      materializedProposalId: '10000000-0000-4000-8000-000000000008',
    },
  ],
};

/** Stored (complete) shape, as get_future_revision returns it. */
function storedMutation() {
  return {
    operation: 'REVISE',
    futureId: FUTURE_ID,
    expectedRevision: 0,
    baseline: { kind: 'LIVE', revision: 'live-1', content },
    result: { ...content, name: 'Tomorrow' },
    dependencies: [],
  };
}

/** Authored delta, as propose_future_revision accepts it. */
function mutation(overrides: Record<string, unknown> = {}) {
  return {
    operation: 'REVISE',
    futureId: FUTURE_ID,
    expectedRevision: 0,
    changes: { name: 'Tomorrow' },
    dependencies: [
      {
        edgeType: 'DEPENDS_ON',
        targetEntityType: 'TASK',
        targetEntityId: WORK_ID,
      },
    ],
    ...overrides,
  };
}

function makeRequest() {
  return {
    headers: { authorization: 'Bearer token', 'x-project-id': PROJECT_ID },
    cookies: {},
    user: {
      userId: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      currentOrgId: ORGANIZATION_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    ip: '127.0.0.1',
  } as unknown as Request;
}

function createProvider(create = jest.fn()) {
  create.mockImplementation(
    async (_o: string, _p: string, _u: string, dto: { action: string }) => ({
      id: PROPOSAL_ID,
      action: dto.action,
      status: 'DRAFT',
      targetEntityId: TARGET_ID,
      targetEntityType: 'TASK',
      createdAt: '2026-10-01T00:00:00.000Z',
    }),
  );
  // The real materializer runs against a live read so the test sees the
  // complete mutation that persistence receives.
  const ports: FutureRevisionMaterializerPorts = {
    projectGraph: jest.fn(),
    readLiveContent: jest.fn().mockResolvedValue(liveContent),
    readLiveRevision: jest.fn().mockResolvedValue('live-1'),
    renderTaskSections: (_projectId, _type, sections) =>
      sections.map((section) => {
        if (section.key !== 'description')
          throw new BadRequestException(
            `Unsupported task section key: ${section.key}`,
          );
        return { key: section.key, content: String(section.content) };
      }),
    renderRequirementOps: jest.fn(),
  };
  const tx = {
    task: { findFirst: jest.fn().mockResolvedValue({ archivedAt: null }) },
    proposalFuture: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const materialize = jest.fn(
    (target: FutureTarget, authoring: FutureRevisionAuthoring) =>
      materializeFutureRevision(tx as never, ports, target, authoring),
  );
  const proposalService = {
    create,
    createBatch: jest.fn(),
    findOne: jest.fn(),
    materializeFutureRevision: materialize,
  } as unknown as ProposalService;
  const provider = new ProposalToolsProvider(
    proposalService,
    { findOne: jest.fn() } as unknown as TaskService,
    {
      markNeedsRevision: jest.fn(),
      consumeRecovery: jest.fn().mockResolvedValue(false),
    } as unknown as LintRecoveryStore,
    registry,
    { db: {} } as unknown as PrismaService,
  );
  return { provider, create, materialize };
}

function call(
  provider: ProposalToolsProvider,
  params: Record<string, unknown>,
) {
  return provider.proposeFutureRevision(
    {
      eli5: 'Stages the future version of this task.',
      targetEntityType: 'TASK',
      targetEntityId: TARGET_ID,
      authoringRootProof: AUTHORING_ROOT_PROOF,
      ...params,
    } as never,
    {} as Context,
    makeRequest(),
  );
}

function errorText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]!.text;
}

describe('propose_future_revision guidance', () => {
  it('names every eligible knowledge type and keeps immediate changes ordinary', () => {
    const { description } = TOOL_GUIDANCE.propose_future_revision;
    const body = TOOL_GUIDANCE.propose_future_revision.body.replace(
      /\s+/g,
      ' ',
    );
    for (const text of [description, body]) {
      expect(text).toMatch(/Feature, Contract, Diagram, Mockup or Design Doc/);
      expect(text).not.toMatch(/task or design doc/i);
    }
    expect(body).toContain('outcome of implementation');
    expect(body).toContain("implementation task's own instructions");
    expect(body).toContain('editorial');
    expect(body).toContain('never replaces declaring it as a dependency');
  });
});

describe('propose_future_revision', () => {
  it('materializes the delta into one complete VERSIONED_UPDATE proposal', async () => {
    const { provider, create, materialize } = createProvider();

    const result = await call(provider, { mutation: mutation() });

    expect(result).toMatchObject({
      status: 'proposed',
      proposalId: PROPOSAL_ID,
      futureId: FUTURE_ID,
      operation: 'REVISE',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][3]).toMatchObject({
      action: 'VERSIONED_UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: TARGET_ID,
      updates: {
        operation: 'REVISE',
        futureId: FUTURE_ID,
        expectedRevision: 0,
        baseline: { kind: 'LIVE', revision: 'live-1', content: liveContent },
        result: { ...liveContent, name: 'Tomorrow' },
        dependencies: [{ targetEntityId: WORK_ID }],
      },
    });
    expect(create.mock.calls[0][3].updates).not.toHaveProperty('changes');
    expect(create.mock.calls[0][3]).not.toHaveProperty('edges');
    expect(materialize).toHaveBeenCalledWith(
      {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        targetEntityType: 'TASK',
        targetEntityId: TARGET_ID,
      },
      expect.objectContaining({ changes: { name: 'Tomorrow' } }),
    );
  });

  it('rejects a delta the materializer cannot apply before creating a proposal', async () => {
    const { provider, create } = createProvider();

    const result = await call(provider, {
      mutation: mutation({
        changes: { sections: [{ key: 'unknown', content: 'x' }] },
      }),
    });

    expect(errorText(result)).toContain(
      'mutation/changes/sections: Unsupported task section key: unknown',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a mutation that violates the contract without creating a proposal', async () => {
    const { provider, create } = createProvider();

    const result = await call(provider, {
      mutation: { ...mutation(), changes: undefined },
    });

    expect(errorText(result)).toContain('FutureRevisionAuthoring');
    expect(create).not.toHaveBeenCalled();
  });

  it('requires the work-item guidance token when the change touches sections', async () => {
    const { provider, create } = createProvider();
    const changed = mutation({
      changes: { sections: [{ key: 'description', content: 'Future' }] },
    });

    const rejected = await call(provider, { mutation: changed });
    expect(errorText(rejected)).toContain('guidanceToken');
    expect(create).not.toHaveBeenCalled();

    const accepted = await call(provider, {
      mutation: changed,
      guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
    });
    expect(accepted).toMatchObject({ status: 'proposed' });
    expect(create.mock.calls[0][3].updates.result.sections).toEqual([
      { ...liveContent.sections[0], materializedMarkdown: 'Future' },
    ]);
  });

  it('surfaces service-side future validation as a diagnostic', async () => {
    const create = jest.fn();
    const { provider } = createProvider(create);
    create.mockRejectedValueOnce(
      new BadRequestException(
        'Complete future content must match the proposal target and project.',
      ),
    );

    const result = await call(provider, { mutation: mutation() });

    expect(errorText(result)).toContain('must match the proposal target');
  });
});

describe('get_future_revision', () => {
  function createReader(future: unknown) {
    const db = {
      proposalFuture: { findFirst: jest.fn().mockResolvedValue(future) },
      proposal: { findMany: jest.fn().mockResolvedValue([]) },
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: WORK_ID,
            type: 'STANDARD',
            status: 'ACTIVE',
            archivedAt: null,
          },
        ]),
      },
    };
    const provider = new ProposalToolsProvider(
      { findOne: jest.fn() } as unknown as ProposalService,
      { findOne: jest.fn() } as unknown as TaskService,
      {} as unknown as LintRecoveryStore,
      registry,
      { db } as unknown as PrismaService,
    );
    return { provider, db };
  }

  it('returns the one selected future with its completion blockers', async () => {
    const { provider, db } = createReader({
      id: FUTURE_ID,
      targetEntityType: 'TASK',
      targetEntityId: TARGET_ID,
      revision: 1,
      outcome: 'REVISE',
      originatingProposalId: PROPOSAL_ID,
      latestProposalId: PROPOSAL_ID,
      baseline: storedMutation().baseline,
      result: storedMutation().result,
      dependencies: [{ targetEntityId: WORK_ID }],
      history: [],
      appliedAt: null,
      appliedRevision: null,
      cancelledAt: null,
    });

    const result = (await provider.getFutureRevision(
      { futureId: FUTURE_ID },
      {} as Context,
      makeRequest(),
    )) as { future: Record<string, unknown> };

    expect(db.proposalFuture.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: FUTURE_ID,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
        },
      }),
    );
    expect(result.future).toMatchObject({
      id: FUTURE_ID,
      revision: 1,
      result: { name: 'Tomorrow' },
      completionEligibility: {
        eligible: false,
        blockers: [expect.objectContaining({ reason: 'INCOMPLETE' })],
      },
    });
  });

  it('returns an error for a future outside the project', async () => {
    const { provider } = createReader(null);

    const result = await provider.getFutureRevision(
      { futureId: FUTURE_ID },
      {} as Context,
      makeRequest(),
    );

    expect(errorText(result)).toContain('Future not found');
  });

  it('requires the authoring root proof when the future carries dependencies', async () => {
    const { provider, create } = createProvider();

    const result = await call(provider, {
      mutation: mutation(),
      authoringRootProof: undefined,
    });

    expect(errorText(result)).toContain('requires authoringRootProof');
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a dependency-free future without the authoring root proof', async () => {
    const { provider, create } = createProvider();

    await call(provider, {
      mutation: mutation({ dependencies: [] }),
      authoringRootProof: undefined,
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a work item type change as outside the change shape', async () => {
    const { provider, create } = createProvider();

    const result = await call(provider, {
      mutation: mutation({ changes: { type: 'BUG' } }),
    });

    expect(errorText(result)).toContain('mutation/changes');
    expect(create).not.toHaveBeenCalled();
  });
});
