import {
  OrganizationClosureExecutionStage,
  OrganizationClosureProjectionConsumer,
  OrganizationClosureProjectionOutcome,
} from '@prisma/client';
import type {
  ProjectionDeletionIdentityConflictResponse,
  ProjectionDeletionRetryableFailureResponse,
} from 'src/generated/graphs';
import { OrganizationProjectionDeletionCoordinatorService } from '../organization-projection-deletion-coordinator.service';

const ORGANIZATION_ID = 'organization-id';
const MARKER_ID = 'marker-id';
const IRREVERSIBLE_CLOSURE_AT = new Date('2026-08-19T12:00:00.000Z');
const DELETION_DEADLINE = new Date('2026-09-18T12:00:00.000Z');

function execution(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    markerId: MARKER_ID,
    effectiveClosureAt: IRREVERSIBLE_CLOSURE_AT,
    deletionDeadline: DELETION_DEADLINE,
    stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
    attemptCount: 1,
    attemptId: 'attempt-id',
    claimToken: 'claim-token',
    claimedAt: new Date('2026-08-19T12:01:00.000Z'),
    ...overrides,
  };
}

function projectionCommand(
  consumer: OrganizationClosureProjectionConsumer,
  overrides: Record<string, unknown> = {},
) {
  return {
    organizationId: ORGANIZATION_ID,
    markerId: MARKER_ID,
    irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT,
    deletionDeadline: DELETION_DEADLINE,
    consumer,
    attemptCount: 0,
    nextRetryAt: new Date('2026-08-19T12:00:00.000Z'),
    claimToken: null,
    claimedAt: null,
    leaseExpiresAt: null,
    lastAttemptedAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureAt: null,
    acknowledgedAt: null,
    verifiedOutcome: null,
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    markerId: MARKER_ID,
    irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT.toISOString(),
    deletionDeadline: DELETION_DEADLINE.toISOString(),
    tombstoneRecorded: true,
    contentVerificationCompleted: true,
    ...overrides,
  };
}

function setup(
  commands: Map<OrganizationClosureProjectionConsumer, any>,
  responseByConsumer: Record<string, unknown>,
) {
  const marker = {
    organizationId: ORGANIZATION_ID,
    id: MARKER_ID,
    effectiveClosureAt: IRREVERSIBLE_CLOSURE_AT,
    deletionDeadline: DELETION_DEADLINE,
  };
  const commandRepository = {
    findFirst: jest.fn(({ where }: any) => {
      const command = commands.get(where.consumer);
      if (command && where.claimToken) {
        command.claimToken = where.claimToken;
        command.attemptCount += 1;
      }
      return Promise.resolve(command ?? null);
    }),
    create: jest.fn(({ data }: any) => {
      const command = projectionCommand(data.consumer, data);
      commands.set(data.consumer, command);
      return Promise.resolve(command);
    }),
    updateMany: jest.fn(({ where, data }: any) => {
      const command = commands.get(where.consumer);
      if (command) {
        Object.assign(command, data);
        if (
          data.verifiedOutcome === OrganizationClosureProjectionOutcome.VERIFIED
        ) {
          command.acknowledgedAt = data.acknowledgedAt;
        }
      }
      return Promise.resolve({ count: command ? 1 : 0 });
    }),
  };
  const executionRepository = {
    findUniqueOrThrow: jest.fn().mockResolvedValue(execution()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    db: {
      organizationDeletionMarker: {
        findUnique: jest.fn().mockResolvedValue(marker),
      },
      organizationClosureProjectionCommand: commandRepository,
      organizationClosureExecution: executionRepository,
    },
    $queryRaw: jest.fn(),
  };
  const dueWork = {
    releaseClaim: jest.fn().mockResolvedValue(undefined),
    failClaim: jest.fn().mockResolvedValue(undefined),
    materializeReachedSnapshot: jest.fn(),
    claimNext: jest.fn(),
  };
  const deletionOwner = {
    execute: jest.fn().mockResolvedValue(undefined),
    executeAfterProjectionDeletion: jest.fn().mockResolvedValue(undefined),
  };
  const jwtKeys = {
    getProjectionDeletionToken: jest.fn(
      (_context: unknown, provider: string) =>
        `${provider.toLowerCase()}-token`,
    ),
  };
  const graphsClient = {
    deleteOrganizationProjection: jest
      .fn()
      .mockResolvedValue(response(responseByConsumer.GRAPH as any)),
  };
  const embeddingsClient = {
    deleteOrganizationProjection: jest
      .fn()
      .mockResolvedValue(response(responseByConsumer.EMBEDDINGS as any)),
  };
  const service = new OrganizationProjectionDeletionCoordinatorService(
    prisma as any,
    dueWork as any,
    deletionOwner as any,
    jwtKeys as any,
    graphsClient as any,
    embeddingsClient as any,
  );
  return {
    service,
    prisma,
    dueWork,
    deletionOwner,
    jwtKeys,
    graphsClient,
    embeddingsClient,
    commandRepository,
  };
}

describe('OrganizationProjectionDeletionCoordinatorService', () => {
  it('revokes authority before creating commands and delegates only after both projections verify', async () => {
    const commands = new Map<OrganizationClosureProjectionConsumer, any>();
    const {
      service,
      prisma,
      deletionOwner,
      graphsClient,
      embeddingsClient,
      commandRepository,
    } = setup(commands, {});
    prisma.db.organizationClosureExecution.findUniqueOrThrow.mockResolvedValue(
      execution(),
    );
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.GRAPH,
          claimToken: 'graph-claim',
        },
      ])
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
          claimToken: 'embeddings-claim',
        },
      ]);

    await service.execute(
      execution({ stage: OrganizationClosureExecutionStage.PENDING }) as any,
    );

    expect(deletionOwner.execute).toHaveBeenCalledTimes(1);
    expect(commandRepository.create).toHaveBeenCalledTimes(2);
    expect(
      Math.max(...commandRepository.create.mock.invocationCallOrder),
    ).toBeLessThan(
      graphsClient.deleteOrganizationProjection.mock.invocationCallOrder[0]!,
    );
    expect(
      Math.max(...commandRepository.create.mock.invocationCallOrder),
    ).toBeLessThan(
      embeddingsClient.deleteOrganizationProjection.mock
        .invocationCallOrder[0]!,
    );
    expect(deletionOwner.executeAfterProjectionDeletion).toHaveBeenCalledTimes(
      1,
    );
  });

  it('calls both consumers with the committed identity and delegates once after verified outcomes', async () => {
    const commands = new Map([
      [
        OrganizationClosureProjectionConsumer.GRAPH,
        projectionCommand(OrganizationClosureProjectionConsumer.GRAPH),
      ],
      [
        OrganizationClosureProjectionConsumer.EMBEDDINGS,
        projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
      ],
    ]);
    const {
      service,
      prisma,
      deletionOwner,
      jwtKeys,
      graphsClient,
      embeddingsClient,
    } = setup(commands, {});
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.GRAPH,
          claimToken: 'graph-claim',
        },
      ])
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
          claimToken: 'embeddings-claim',
        },
      ]);

    await service.execute(execution() as any);

    const expectedCommand = {
      organizationId: ORGANIZATION_ID,
      markerId: MARKER_ID,
      irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT.toISOString(),
      deletionDeadline: DELETION_DEADLINE.toISOString(),
    };
    expect(graphsClient.deleteOrganizationProjection).toHaveBeenCalledWith(
      expectedCommand,
      'graph-token',
    );
    expect(embeddingsClient.deleteOrganizationProjection).toHaveBeenCalledWith(
      expectedCommand,
      'embeddings-token',
    );
    expect(jwtKeys.getProjectionDeletionToken).toHaveBeenNthCalledWith(
      1,
      {
        organizationId: ORGANIZATION_ID,
        markerId: MARKER_ID,
        irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT,
        deletionDeadline: DELETION_DEADLINE,
      },
      OrganizationClosureProjectionConsumer.GRAPH,
    );
    expect(jwtKeys.getProjectionDeletionToken).toHaveBeenNthCalledWith(
      2,
      {
        organizationId: ORGANIZATION_ID,
        markerId: MARKER_ID,
        irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT,
        deletionDeadline: DELETION_DEADLINE,
      },
      OrganizationClosureProjectionConsumer.EMBEDDINGS,
    );
    expect(deletionOwner.executeAfterProjectionDeletion).toHaveBeenCalledTimes(
      1,
    );
    expect(dueWorkNotCalled({ service, deletionOwner })).toBe(true);
  });

  it('accepts equivalent RFC 3339 timestamp representations from a provider', async () => {
    const commands = new Map([
      [
        OrganizationClosureProjectionConsumer.GRAPH,
        projectionCommand(OrganizationClosureProjectionConsumer.GRAPH),
      ],
      [
        OrganizationClosureProjectionConsumer.EMBEDDINGS,
        projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
      ],
    ]);
    const { service, prisma, dueWork, deletionOwner } = setup(commands, {
      EMBEDDINGS: {
        irreversibleClosureAt: '2026-08-19T12:00:00.000000Z',
        deletionDeadline: '2026-09-18T14:00:00.000000+02:00',
      },
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.GRAPH,
          claimToken: 'graph-claim',
        },
      ])
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
          claimToken: 'embeddings-claim',
        },
      ]);

    await service.execute(execution() as any);

    expect(dueWork.failClaim).not.toHaveBeenCalled();
    expect(deletionOwner.executeAfterProjectionDeletion).toHaveBeenCalledTimes(
      1,
    );
  });

  it('retains a genuinely different submillisecond provider timestamp as an identity conflict', async () => {
    const commands = new Map([
      [
        OrganizationClosureProjectionConsumer.GRAPH,
        projectionCommand(OrganizationClosureProjectionConsumer.GRAPH),
      ],
      [
        OrganizationClosureProjectionConsumer.EMBEDDINGS,
        projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
      ],
    ]);
    const { service, prisma, dueWork, deletionOwner, commandRepository } =
      setup(commands, {
        EMBEDDINGS: {
          irreversibleClosureAt: '2026-08-19T12:00:00.000001Z',
        },
      });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.GRAPH,
          claimToken: 'graph-claim',
        },
      ])
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
          claimToken: 'embeddings-claim',
        },
      ]);

    await service.execute(execution() as any);

    expect(commandRepository.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastFailureCode: 'IDENTITY_CONFLICT',
          nextRetryAt: null,
        }),
      }),
    );
    expect(dueWork.failClaim).toHaveBeenCalledTimes(1);
    expect(deletionOwner.executeAfterProjectionDeletion).not.toHaveBeenCalled();
  });

  it('does not delegate again after persisted closure completion', async () => {
    const commands = new Map([
      [
        OrganizationClosureProjectionConsumer.GRAPH,
        projectionCommand(OrganizationClosureProjectionConsumer.GRAPH),
      ],
      [
        OrganizationClosureProjectionConsumer.EMBEDDINGS,
        projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
      ],
    ]);
    const { service, prisma, deletionOwner } = setup(commands, {});
    const persisted = execution() as any;
    prisma.db.organizationClosureExecution.findUniqueOrThrow.mockResolvedValue(
      persisted,
    );
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.GRAPH,
          claimToken: 'graph-claim',
        },
      ])
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
          claimToken: 'embeddings-claim',
        },
      ]);
    deletionOwner.executeAfterProjectionDeletion.mockImplementation(
      async () => {
        persisted.stage = OrganizationClosureExecutionStage.COMPLETED;
      },
    );

    await service.execute(execution() as any);
    await service.execute(execution() as any);

    expect(deletionOwner.executeAfterProjectionDeletion).toHaveBeenCalledTimes(
      1,
    );
  });

  it('does not recall an acknowledged consumer after a partial failure and restart', async () => {
    const commands = new Map([
      [
        OrganizationClosureProjectionConsumer.GRAPH,
        projectionCommand(OrganizationClosureProjectionConsumer.GRAPH, {
          acknowledgedAt: new Date('2026-08-19T12:02:00.000Z'),
          verifiedOutcome: OrganizationClosureProjectionOutcome.VERIFIED,
        }),
      ],
      [
        OrganizationClosureProjectionConsumer.EMBEDDINGS,
        projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
      ],
    ]);
    const {
      service,
      prisma,
      dueWork,
      deletionOwner,
      graphsClient,
      embeddingsClient,
    } = setup(commands, {});
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
        claimToken: 'embeddings-claim-1',
      },
    ]);
    embeddingsClient.deleteOrganizationProjection.mockRejectedValueOnce(
      new Error('Embeddings unavailable'),
    );

    await service.execute(execution() as any);
    expect(graphsClient.deleteOrganizationProjection).not.toHaveBeenCalled();
    expect(deletionOwner.executeAfterProjectionDeletion).not.toHaveBeenCalled();
    expect(dueWork.releaseClaim).toHaveBeenCalledTimes(1);

    const embeddingsCommand = commands.get(
      OrganizationClosureProjectionConsumer.EMBEDDINGS,
    )!;
    (embeddingsCommand as any).nextRetryAt = null;
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
        claimToken: 'embeddings-claim-2',
      },
    ]);
    embeddingsClient.deleteOrganizationProjection.mockResolvedValueOnce(
      response(),
    );

    await service.execute(execution() as any);
    expect(graphsClient.deleteOrganizationProjection).not.toHaveBeenCalled();
    expect(embeddingsClient.deleteOrganizationProjection).toHaveBeenCalledTimes(
      2,
    );
    expect(deletionOwner.executeAfterProjectionDeletion).toHaveBeenCalledTimes(
      1,
    );
  });

  it('retains identity conflicts and prevents lifecycle completion', async () => {
    const commands = new Map([
      [
        OrganizationClosureProjectionConsumer.GRAPH,
        projectionCommand(OrganizationClosureProjectionConsumer.GRAPH),
      ],
      [
        OrganizationClosureProjectionConsumer.EMBEDDINGS,
        projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
      ],
    ]);
    const {
      service,
      prisma,
      dueWork,
      deletionOwner,
      graphsClient,
      commandRepository,
    } = setup(commands, {});
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.GRAPH,
          claimToken: 'graph-claim',
        },
      ])
      .mockResolvedValueOnce([
        {
          consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
          claimToken: 'embeddings-claim',
        },
      ]);
    graphsClient.deleteOrganizationProjection.mockResolvedValueOnce(
      response({ markerId: 'different-marker' }),
    );

    await service.execute(execution() as any);

    expect(commandRepository.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastFailureCode: 'IDENTITY_CONFLICT',
          nextRetryAt: null,
        }),
      }),
    );
    expect(dueWork.failClaim).toHaveBeenCalledTimes(1);
    expect(deletionOwner.executeAfterProjectionDeletion).not.toHaveBeenCalled();
  });

  it.each([
    OrganizationClosureProjectionConsumer.GRAPH,
    OrganizationClosureProjectionConsumer.EMBEDDINGS,
  ])(
    'retains the generated identity-conflict outcome for %s',
    async (consumer) => {
      const commands = new Map([
        [
          OrganizationClosureProjectionConsumer.GRAPH,
          projectionCommand(OrganizationClosureProjectionConsumer.GRAPH),
        ],
        [
          OrganizationClosureProjectionConsumer.EMBEDDINGS,
          projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
        ],
      ]);
      const {
        service,
        prisma,
        dueWork,
        deletionOwner,
        graphsClient,
        embeddingsClient,
        commandRepository,
      } = setup(commands, {});
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            consumer: OrganizationClosureProjectionConsumer.GRAPH,
            claimToken: 'graph-claim',
          },
        ])
        .mockResolvedValueOnce([
          {
            consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
            claimToken: 'embeddings-claim',
          },
        ]);
      const conflict: ProjectionDeletionIdentityConflictResponse = {
        errorCode: 'PROJECTION_DELETION_IDENTITY_CONFLICT',
        message: 'retained identity differs',
        retainedIdentity: {
          organizationId: ORGANIZATION_ID,
          markerId: 'different-marker',
          irreversibleClosureAt: IRREVERSIBLE_CLOSURE_AT.toISOString(),
          deletionDeadline: DELETION_DEADLINE.toISOString(),
        },
      };
      const failure = Object.assign(new Error(conflict.message), {
        isAxiosError: true,
        response: { status: 409, data: conflict },
      });
      const client =
        consumer === OrganizationClosureProjectionConsumer.GRAPH
          ? graphsClient
          : embeddingsClient;
      client.deleteOrganizationProjection.mockRejectedValueOnce(failure);

      await service.execute(execution() as any);

      expect(commandRepository.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastFailureCode: 'IDENTITY_CONFLICT',
            nextRetryAt: null,
          }),
        }),
      );
      expect(dueWork.failClaim).toHaveBeenCalledTimes(1);
      expect(
        deletionOwner.executeAfterProjectionDeletion,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    OrganizationClosureProjectionConsumer.GRAPH,
    OrganizationClosureProjectionConsumer.EMBEDDINGS,
  ])(
    'retains the generated retryable-failure outcome for %s',
    async (consumer) => {
      const commands = new Map([
        [
          OrganizationClosureProjectionConsumer.GRAPH,
          projectionCommand(OrganizationClosureProjectionConsumer.GRAPH),
        ],
        [
          OrganizationClosureProjectionConsumer.EMBEDDINGS,
          projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS),
        ],
      ]);
      const {
        service,
        prisma,
        dueWork,
        graphsClient,
        embeddingsClient,
        commandRepository,
      } = setup(commands, {});
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            consumer: OrganizationClosureProjectionConsumer.GRAPH,
            claimToken: 'graph-claim',
          },
        ])
        .mockResolvedValueOnce([
          {
            consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
            claimToken: 'embeddings-claim',
          },
        ]);
      const retryable: ProjectionDeletionRetryableFailureResponse = {
        errorCode: 'PROJECTION_DELETION_RETRYABLE_FAILURE',
        message: 'projection is temporarily unavailable',
        retryable: true,
      };
      const failure = Object.assign(new Error(retryable.message), {
        isAxiosError: true,
        response: { status: 503, data: retryable },
      });
      const client =
        consumer === OrganizationClosureProjectionConsumer.GRAPH
          ? graphsClient
          : embeddingsClient;
      client.deleteOrganizationProjection.mockRejectedValueOnce(failure);

      await service.execute(execution() as any);

      const retryCall = commandRepository.updateMany.mock.calls.find(
        ([args]) =>
          args.data.lastFailureCode === 'PROJECTION_DELETION_RETRYABLE_FAILURE',
      );
      if (!retryCall) {
        throw new Error('Expected generated retryable failure to be retained');
      }
      expect(retryCall[0].data.nextRetryAt).toBeInstanceOf(Date);
      expect(dueWork.releaseClaim).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds retry failure metadata and uses exponential retry timing', async () => {
    const commands = new Map([
      [
        OrganizationClosureProjectionConsumer.GRAPH,
        projectionCommand(OrganizationClosureProjectionConsumer.GRAPH, {
          attemptCount: 1,
        }),
      ],
      [
        OrganizationClosureProjectionConsumer.EMBEDDINGS,
        projectionCommand(OrganizationClosureProjectionConsumer.EMBEDDINGS, {
          acknowledgedAt: new Date('2026-08-19T12:02:00.000Z'),
          verifiedOutcome: OrganizationClosureProjectionOutcome.VERIFIED,
        }),
      ],
    ]);
    const { service, prisma, graphsClient, commandRepository } = setup(
      commands,
      {},
    );
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        consumer: OrganizationClosureProjectionConsumer.GRAPH,
        claimToken: 'graph-claim',
      },
    ]);
    graphsClient.deleteOrganizationProjection.mockRejectedValueOnce(
      new Error('x'.repeat(4000)),
    );

    await service.execute(execution() as any);

    const failureCall = commandRepository.updateMany.mock.calls.find(
      ([args]) => args.data.lastFailureCode === 'RETRYABLE_FAILURE',
    );
    if (!failureCall) {
      throw new Error('Expected a retryable command failure update');
    }
    expect(failureCall[0].data.lastFailureMessage).toHaveLength(2000);
    expect(failureCall[0].data.nextRetryAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
});

function dueWorkNotCalled({ service, deletionOwner }: any): boolean {
  return service && deletionOwner.execute.mock.calls.length === 0;
}
