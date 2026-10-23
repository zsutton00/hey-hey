import {
  CliReadErrorCode,
  CliReadProviderUsageGetSuccessResponseDto,
  CliReadProviderUsageGetErrorResponseDto,
  CliReadRuntimeModelCatalogGetErrorResponseDto,
  CliReadRuntimeModelCatalogGetSuccessResponseDto,
  CliReadRequestDto,
} from '../../../generated';
import { CliReadEmitter } from '../cli-read-emitter.service';
import { SESSION_CLI_READ_OPERATIONS } from '../cli-read-operation-registry';

jest.mock('../websocket.gateway', () => ({ WebsocketGateway: class {} }));

const runId = '11111111-1111-4111-8111-111111111111';
const machineId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const projectId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';

const runRequest: CliReadRequestDto = {
  operation: 'run.changed_files.count',
  runId,
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const runChangedFileDetailRequest: CliReadRequestDto = {
  operation: 'run.changed_files.detail',
  runId,
  file: {
    serviceId: '66666666-6666-4666-8666-666666666666',
    repoPath: '/tmp/repository',
    filePath: 'src/example.ts',
  },
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const runChangedFilesInventoryRequest: CliReadRequestDto = {
  operation: 'run.changed_files.inventory',
  runId,
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const runContextUsageRequest: CliReadRequestDto = {
  operation: 'run.context_usage.get',
  runId,
  providerSessionId: 'provider-session-1',
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const runSkillsListRequest: CliReadRequestDto = {
  operation: 'run.skills.list',
  runId,
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const runToolCallsLatestTurnRequest: CliReadRequestDto = {
  operation: 'run.tool_calls.latest_turn',
  runId,
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const projectSessionCostsRequest: CliReadRequestDto = {
  operation: 'project.session_costs.list',
  projectId,
  activityFrom: '2026-07-01T00:00:00.000Z',
  activityTo: '2026-07-28T23:59:59.000Z',
  minKnownCostUsd: 0.25,
  limit: 25,
  cursor: 'next-page',
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const providerUsageRequest: CliReadRequestDto = {
  operation: 'provider.usage.get',
  authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
};

const requestsByOperation = {
  'run.changed_files.count': runRequest,
  'run.changed_files.inventory': runChangedFilesInventoryRequest,
  'run.changed_files.detail': runChangedFileDetailRequest,
  'run.context_usage.get': runContextUsageRequest,
  'run.skills.list': runSkillsListRequest,
  'run.tool_calls.latest_turn': runToolCallsLatestTurnRequest,
  'project.session_costs.list': projectSessionCostsRequest,
  'provider.usage.get': providerUsageRequest,
} satisfies Record<CliReadRequestDto['operation'], CliReadRequestDto>;

const unusableAuthorityStates = [
  'unresolved',
  'denied',
  'expired',
  'revoked',
  'mismatched',
  'widened',
  'unknown',
  'stale prior authority',
] as const;

const createSubject = (request: CliReadRequestDto = runRequest) => {
  const signer: any = {
    signCliRead: jest.fn((event) => ({
      event,
      machineId,
      userId,
      nonce: 'nonce',
      timestampMs: Date.now(),
      signature: 'signature',
    })),
    signCliReadAuthorized: jest.fn((event, machine, owner, authorization) => ({
      ...signer.signCliRead(event, machine, owner),
      protocolVersion: 2,
      authorization,
    })),
  };
  const gateway = { emitCliReadWithAck: jest.fn() };
  const authorization = {
    resolveSelectedAuthorization: jest.fn().mockResolvedValue({
      kind: 'bounded_grant',
      grantId: 'grant-1',
    }),
  };
  const subject = new CliReadEmitter(
    signer as any,
    gateway as any,
    authorization as any,
  );
  const read = (options?: { timeoutMs?: number }) =>
    subject.read({
      request,
      machineId: machineId as any,
      userId: userId as any,
      organizationId: '66666666-6666-4666-8666-666666666666' as any,
      projectId: projectId as any,
      conversationId,
      agentSessionId: runId,
      admission: {
        authorizationId: '77777777-7777-4777-8777-777777777777',
        envelopeAuthorization: {
          kind: 'bounded_grant',
          grantId: 'grant-1',
        },
        actionPayloadHash: 'a'.repeat(64),
      },
      ...options,
    });

  return { authorization, gateway, read, signer, subject };
};

const collectionResult = (
  sourceAvailability: 'available' | 'partial' | 'unavailable',
) => {
  const costReadAt = '2026-07-28T20:00:00.000Z';
  const providerSessions =
    sourceAvailability === 'unavailable'
      ? [
          {
            providerId: 'claude',
            providerSessionId: 'provider-session-1',
            providerConversationId: null,
            providerSessionAgentId: null,
            observedAt: costReadAt,
            cost: {
              state: 'unavailable',
              reason: 'cost_source_unavailable',
              message: 'ccusage is unavailable',
            },
          },
        ]
      : [
          {
            providerId: 'claude',
            providerSessionId: 'provider-session-1',
            providerConversationId: null,
            providerSessionAgentId: null,
            observedAt: costReadAt,
            cost: {
              state: 'available',
              amountUsd: 1.5,
              currency: 'USD',
              source: 'ccusage',
            },
          },
          ...(sourceAvailability === 'partial'
            ? [
                {
                  providerId: 'codex',
                  providerSessionId: 'provider-session-2',
                  providerConversationId: null,
                  providerSessionAgentId: null,
                  observedAt: costReadAt,
                  cost: {
                    state: 'unavailable',
                    reason: 'session_not_found',
                  },
                },
              ]
            : []),
        ];

  return {
    items: [
      {
        agentSessionId: runId,
        conversationId,
        context: {
          entityType: 'TASK',
          entityId: null,
          entityTitle: null,
          promptType: 'start_run',
        },
        providerSessions,
        knownCostUsd: sourceAvailability === 'unavailable' ? null : 1.5,
        completeness:
          sourceAvailability === 'available' ? 'complete' : sourceAvailability,
        latestActivityAt: costReadAt,
        costReadAt,
      },
    ],
    nextCursor: sourceAvailability === 'available' ? 'next-page' : null,
    sourceAvailability,
    costReadAt,
  };
};

describe('CliReadEmitter', () => {
  it('returns provider usage with zeroes, nulls and per-provider failures unchanged', async () => {
    const { gateway, read } = createSubject(providerUsageRequest);
    let response: CliReadProviderUsageGetSuccessResponseDto;
    gateway.emitCliReadWithAck.mockImplementation(async (event) => {
      response = {
        requestId: event.envelope.event.requestId,
        operation: 'provider.usage.get',
        status: 'success',
        result: {
          providers: [
            {
              provider: 'codex',
              status: 'reported',
              observedAt: '2026-10-12T21:12:42.000Z',
              fiveHour: {
                usedPercent: 0,
                resetsAt: '2026-10-13T02:00:00.000Z',
              },
              weekly: { usedPercent: 45, resetsAt: null },
            },
            {
              provider: 'claude',
              status: 'unreported',
              observedAt: null,
              fiveHour: null,
              weekly: null,
            },
            {
              provider: 'opencode',
              status: 'error',
              observedAt: null,
              fiveHour: null,
              weekly: null,
            },
          ],
        },
      } satisfies CliReadProviderUsageGetSuccessResponseDto;
      return { kind: 'ack', value: response };
    });

    const result = await read();
    expect(result).toEqual(response!);
  });

  it.each([
    ['malformed', CliReadErrorCode.MalformedAck],
    ['mismatched', CliReadErrorCode.CorrelationMismatch],
  ] as const)(
    'rejects a %s provider usage acknowledgement',
    async (kind, code) => {
      const { gateway, read } = createSubject(providerUsageRequest);
      gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
        kind: 'ack',
        value: {
          requestId:
            kind === 'mismatched' ? runId : event.envelope.event.requestId,
          operation: 'provider.usage.get',
          status: 'success',
          result: { providers: kind === 'malformed' ? null : [] },
        },
      }));

      await expect(read()).resolves.toMatchObject({
        operation: 'provider.usage.get',
        status: 'error',
        error: { code },
      });
    },
  );

  it('preserves a correlated provider usage error', async () => {
    const { gateway, read } = createSubject(providerUsageRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'provider.usage.get',
        status: 'error',
        error: {
          code: CliReadErrorCode.ReadFailed,
          message: 'Usage read failed',
        },
      } satisfies CliReadProviderUsageGetErrorResponseDto,
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'provider.usage.get',
      status: 'error',
      error: {
        code: CliReadErrorCode.ReadFailed,
        message: 'Usage read failed',
      },
    });
  });

  it.each(
    SESSION_CLI_READ_OPERATIONS.flatMap((operation) =>
      unusableAuthorityStates.map((state) => [operation, state] as const),
    ),
  )('denies %s before signing for %s', async (operation) => {
    const { authorization, gateway, read, signer } = createSubject(
      requestsByOperation[operation],
    );
    authorization.resolveSelectedAuthorization.mockResolvedValue(null);

    await expect(read()).resolves.toMatchObject({
      operation,
      status: 'error',
      error: { code: CliReadErrorCode.NoRecipient },
    });
    expect(signer.signCliReadAuthorized).not.toHaveBeenCalled();
    expect(gateway.emitCliReadWithAck).not.toHaveBeenCalled();
  });

  it.each([
    [runRequest, 5_000],
    [runChangedFileDetailRequest, 5_000],
    [runSkillsListRequest, 5_000],
    [providerUsageRequest, 5_000],
    [projectSessionCostsRequest, 30_000],
    [runContextUsageRequest, 30_000],
  ] as const)(
    'selects the operation-specific default timeout',
    async (request, timeoutMs) => {
      const { gateway, read } = createSubject(request);
      gateway.emitCliReadWithAck.mockResolvedValue({ kind: 'timeout' });

      await read();

      expect(gateway.emitCliReadWithAck).toHaveBeenCalledWith(
        expect.any(Object),
        timeoutMs,
      );
    },
  );

  it('preserves a caller-supplied timeout override', async () => {
    const { gateway, read } = createSubject(projectSessionCostsRequest);
    gateway.emitCliReadWithAck.mockResolvedValue({ kind: 'timeout' });

    await read({ timeoutMs: 1_250 });

    expect(gateway.emitCliReadWithAck).toHaveBeenCalledWith(
      expect.any(Object),
      1_250,
    );
  });

  it('returns a delayed correlated Costs acknowledgement unchanged', async () => {
    let resolveAcknowledgement: (value: {
      kind: 'ack';
      value: unknown;
    }) => void;
    const acknowledgementPromise = new Promise<{
      kind: 'ack';
      value: unknown;
    }>((resolve) => {
      resolveAcknowledgement = resolve;
    });
    const { gateway, read } = createSubject(projectSessionCostsRequest);
    gateway.emitCliReadWithAck.mockReturnValue(acknowledgementPromise);

    const resultPromise = read();
    await Promise.resolve();
    const event = gateway.emitCliReadWithAck.mock.calls[0]?.[0];
    resolveAcknowledgement!({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: event.envelope.event.operation,
        status: 'success',
        result: collectionResult('partial'),
      },
    });

    await expect(resultPromise).resolves.toMatchObject({
      operation: 'project.session_costs.list',
      status: 'success',
      result: collectionResult('partial'),
    });
    expect(gateway.emitCliReadWithAck).toHaveBeenCalledWith(
      expect.any(Object),
      30_000,
    );
  });

  it.each([
    ['no_recipient', CliReadErrorCode.NoRecipient],
    ['timeout', CliReadErrorCode.Timeout],
  ] as const)(
    'returns a typed %s transport error for cost collection',
    async (kind, code) => {
      const { gateway, read } = createSubject(projectSessionCostsRequest);
      gateway.emitCliReadWithAck.mockResolvedValue({ kind });

      await expect(read()).resolves.toMatchObject({
        operation: 'project.session_costs.list',
        status: 'error',
        error: { code },
      });
    },
  );

  it('does not inspect or surface a late acknowledgement after timeout', async () => {
    const { gateway, read } = createSubject(projectSessionCostsRequest);
    gateway.emitCliReadWithAck.mockResolvedValue({
      kind: 'timeout',
      value: {
        status: 'success',
        operation: 'project.session_costs.list',
        result: collectionResult('available'),
      },
    });

    const result = await read();

    expect(result).toMatchObject({
      operation: 'project.session_costs.list',
      status: 'error',
      error: { code: CliReadErrorCode.Timeout },
    });
    expect(gateway.emitCliReadWithAck).toHaveBeenCalledTimes(1);
  });

  it('does not retain a telemetry acknowledgement across a retry', async () => {
    const { gateway, read } = createSubject(projectSessionCostsRequest);
    let callCount = 0;
    gateway.emitCliReadWithAck.mockImplementation(async (event) => {
      callCount += 1;
      const result = collectionResult('available');
      result.items[0]!.knownCostUsd = callCount;
      return {
        kind: 'ack',
        value: {
          requestId: event.envelope.event.requestId,
          operation: event.envelope.event.operation,
          status: 'success',
          result,
        },
      };
    });

    const first = await read();
    const second = await read();

    expect(first).toMatchObject({
      status: 'success',
      result: { items: [{ knownCostUsd: 1 }] },
    });
    expect(second).toMatchObject({
      status: 'success',
      result: { items: [{ knownCostUsd: 2 }] },
    });
    expect(gateway.emitCliReadWithAck).toHaveBeenCalledTimes(2);
    expect(
      gateway.emitCliReadWithAck.mock.calls[0]![0].envelope.event.requestId,
    ).not.toBe(
      gateway.emitCliReadWithAck.mock.calls[1]![0].envelope.event.requestId,
    );
  });

  it('rejects a malformed cost collection acknowledgement', async () => {
    const { gateway, read } = createSubject(projectSessionCostsRequest);
    gateway.emitCliReadWithAck.mockResolvedValue({
      kind: 'ack',
      value: {
        requestId: '77777777-7777-4777-8777-777777777777',
        operation: 'project.session_costs.list',
        status: 'success',
        result: { items: [] },
      },
    });

    await expect(read()).resolves.toMatchObject({
      operation: 'project.session_costs.list',
      status: 'error',
      error: { code: CliReadErrorCode.MalformedAck },
    });
  });

  it('rejects a mismatched cost collection acknowledgement', async () => {
    const { gateway, read } = createSubject(projectSessionCostsRequest);
    gateway.emitCliReadWithAck.mockResolvedValue({
      kind: 'ack',
      value: {
        requestId: '77777777-7777-4777-8777-777777777777',
        operation: 'project.session_costs.list',
        status: 'success',
        result: collectionResult('available'),
      },
    });

    await expect(read()).resolves.toMatchObject({
      operation: 'project.session_costs.list',
      status: 'error',
      error: { code: CliReadErrorCode.CorrelationMismatch },
    });
  });

  it.each(['available', 'partial', 'unavailable'] as const)(
    'preserves a %s cost collection outcome',
    async (sourceAvailability) => {
      const { gateway, read, signer } = createSubject(
        projectSessionCostsRequest,
      );
      gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
        kind: 'ack',
        value: {
          requestId: event.envelope.event.requestId,
          operation: event.envelope.event.operation,
          status: 'success',
          result: collectionResult(sourceAvailability),
        },
      }));

      await expect(read()).resolves.toMatchObject({
        operation: 'project.session_costs.list',
        status: 'success',
        result: {
          sourceAvailability,
          items: [
            {
              completeness:
                sourceAvailability === 'available'
                  ? 'complete'
                  : sourceAvailability,
            },
          ],
        },
      });

      const forwardedRequest = signer.signCliRead.mock.calls[0]?.[0];
      expect(forwardedRequest).toEqual({
        requestId: expect.any(String),
        agentSessionId: runId,
        operation: 'project.session_costs.list',
        projectId,
        activityFrom: '2026-07-01T00:00:00.000Z',
        activityTo: '2026-07-28T23:59:59.000Z',
        minKnownCostUsd: 0.25,
        limit: 25,
        cursor: 'next-page',
      });
    },
  );

  it('preserves a typed collection error from the CLI', async () => {
    const { gateway, read } = createSubject(projectSessionCostsRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: event.envelope.event.operation,
        status: 'error',
        error: {
          code: 'READ_FAILED',
          message: 'Cost source returned an error.',
        },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'project.session_costs.list',
      status: 'error',
      error: {
        code: 'READ_FAILED',
        message: 'Cost source returned an error.',
      },
    });
  });

  it('returns a pathless Skill catalog acknowledgement', async () => {
    const { gateway, read } = createSubject(runSkillsListRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: event.envelope.event.operation,
        status: 'success',
        result: {
          runId,
          provider: 'codex',
          skills: [
            {
              provider: 'codex',
              name: 'release-check',
              catalogScope: 'repo',
              description: 'Checks a release.',
              shortDescription: null,
              enabled: true,
              interface: { displayName: 'Release Check' },
              dependencies: {
                tools: [{ type: 'command', value: 'git', command: 'git' }],
              },
            },
          ],
          errors: [],
        },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.skills.list',
      status: 'success',
      result: {
        runId,
        provider: 'codex',
        skills: [{ name: 'release-check', catalogScope: 'repo' }],
        errors: [],
      },
    });
  });

  it('preserves a provider-unavailable Skill catalog error', async () => {
    const { gateway, read } = createSubject(runSkillsListRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: event.envelope.event.operation,
        status: 'error',
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Codex is not installed.',
        },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.skills.list',
      status: 'error',
      error: {
        code: CliReadErrorCode.ProviderUnavailable,
        message: 'Codex is not installed.',
      },
    });
  });

  it('returns a correlated changed-files acknowledgement', async () => {
    const { gateway, read } = createSubject();
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: event.envelope.event.operation,
        status: 'success',
        result: { runId, changedFilesCount: 2 },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.changed_files.count',
      status: 'success',
      result: { runId, changedFilesCount: 2 },
    });
  });

  it('returns correlated changed-file detail', async () => {
    const { gateway, read } = createSubject(runChangedFileDetailRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: event.envelope.event.operation,
        status: 'success',
        result: {
          runId,
          file: {
            serviceId: '66666666-6666-4666-8666-666666666666',
            repoPath: '/tmp/repository',
            filePath: 'src/example.ts',
            status: 'modify',
            diff: '@@ -1 +1 @@\n-before\n+after',
            preContent: 'before',
            postContent: 'after',
          },
        },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.changed_files.detail',
      status: 'success',
      result: {
        runId,
        file: expect.objectContaining({ filePath: 'src/example.ts' }),
      },
    });
  });

  it('returns a correlated cohesive context-usage result', async () => {
    const { gateway, read } = createSubject(runContextUsageRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'run.context_usage.get',
        status: 'success',
        result: {
          runId,
          providerSessionId: 'provider-session-1',
          contextData: {
            categories: [],
            totalTokens: 10,
            maxTokens: 100,
            rawMaxTokens: 100,
            percentage: 10,
            gridRows: [],
            model: 'model-1',
            memoryFiles: [],
            mcpTools: [],
            agents: [],
            isAutoCompactEnabled: false,
            apiUsage: null,
          },
          cost: { state: 'unavailable', reason: 'session_not_found' },
        },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.context_usage.get',
      status: 'success',
      result: { runId, providerSessionId: 'provider-session-1' },
    });
  });

  it('returns the disabled latest-Turn tool-call result', async () => {
    const { gateway, read } = createSubject(runToolCallsLatestTurnRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'success',
        result: { state: 'disabled', runId },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.tool_calls.latest_turn',
      status: 'success',
      result: { state: 'disabled', runId },
    });
  });

  it('returns available latest-Turn tool calls with truncated detail', async () => {
    const { gateway, read } = createSubject(runToolCallsLatestTurnRequest);
    const result = {
      state: 'available',
      runId,
      turnId: 'turn-1',
      toolCalls: [
        {
          entryId: 'entry-1',
          toolUseId: 'tool-use-1',
          toolName: 'Bash',
          summary: 'Bash: ls',
          status: 'completed',
          exitCode: 0,
          lane: {
            subagentTurnId: null,
            providerThreadId: null,
            parentToolUseId: null,
          },
          createdAt: '2026-10-21T00:00:00.000Z',
          updatedAt: '2026-10-21T00:00:01.000Z',
          detail: {
            input: { text: '{"command":"ls"}', truncated: false },
            output: null,
            result: { text: 'a\nb', truncated: true },
          },
        },
      ],
      omittedEarlierCount: 0,
      evictedCount: 3,
    };
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'success',
        result,
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.tool_calls.latest_turn',
      status: 'success',
      result,
    });
  });

  it('preserves a typed latest-Turn tool-call error', async () => {
    const { gateway, read } = createSubject(runToolCallsLatestTurnRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'error',
        error: { code: 'RUN_NOT_FOUND', message: 'Run not found.' },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.tool_calls.latest_turn',
      status: 'error',
      error: { code: CliReadErrorCode.RunNotFound },
    });
  });

  it('rejects latest-Turn tool calls for a different Run', async () => {
    const { gateway, read } = createSubject(runToolCallsLatestTurnRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'run.tool_calls.latest_turn',
        status: 'success',
        result: {
          state: 'disabled',
          runId: '99999999-9999-4999-8999-999999999999',
        },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      status: 'error',
      error: { code: CliReadErrorCode.CorrelationMismatch },
    });
  });

  it('rejects context usage for a different selected provider session', async () => {
    const { gateway, read } = createSubject(runContextUsageRequest);
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'run.context_usage.get',
        status: 'success',
        result: {
          runId,
          providerSessionId: 'provider-session-2',
          contextData: {
            categories: [],
            totalTokens: 10,
            maxTokens: 100,
            rawMaxTokens: 100,
            percentage: 10,
            gridRows: [],
            model: 'model-1',
            memoryFiles: [],
            mcpTools: [],
            agents: [],
            isAutoCompactEnabled: false,
            apiUsage: null,
          },
          cost: { state: 'unavailable', reason: 'session_not_found' },
        },
      },
    }));

    await expect(read()).resolves.toMatchObject({
      operation: 'run.context_usage.get',
      status: 'error',
      error: { code: CliReadErrorCode.CorrelationMismatch },
    });
  });
});

describe('machine-addressed Skill catalog acknowledgements', () => {
  const params: Parameters<CliReadEmitter['readWorkspace']>[0] = {
    request: {
      operation: 'workspace.skills.list',
      provider: 'codex',
      catalogContext: { policy: 'non_repository' },
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
    },
    organizationId: '66666666-6666-4666-8666-666666666666' as Parameters<
      CliReadEmitter['readWorkspace']
    >[0]['organizationId'],
    projectId: projectId as Parameters<
      CliReadEmitter['readWorkspace']
    >[0]['projectId'],
    machineId: machineId as Parameters<
      CliReadEmitter['readWorkspace']
    >[0]['machineId'],
    userId: userId as Parameters<CliReadEmitter['readWorkspace']>[0]['userId'],
    authorizationRequestId: runId,
    admission: {
      authorizationId: runId,
      envelopeAuthorization: { kind: 'bounded_grant', grantId: 'grant-1' },
      actionPayloadHash: 'a'.repeat(64),
    },
  };
  it('signs the exact project, machine and catalog context without a session', async () => {
    const { subject, signer, gateway, authorization } = createSubject();
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: [
        {
          requestId: event.envelope.event.requestId,
          operation: 'workspace.skills.list',
          status: 'success',
          result: { provider: 'codex', skills: [], errors: [] },
        },
      ],
    }));
    expect(await subject.readWorkspace(params)).toMatchObject({
      status: 'success',
    });
    const [body] = signer.signCliReadAuthorized.mock.calls[0]!;
    expect(body).toEqual(
      expect.objectContaining({
        operation: 'workspace.skills.list',
        organizationId: params.organizationId,
        projectId,
        machineId,
        catalogContext: { policy: 'non_repository' },
        authorizationRequestId: runId,
      }),
    );
    expect(body).not.toHaveProperty('agentSessionId');
    expect(authorization.resolveSelectedAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'CLI_READ', id: machineId, revision: null },
        agentSessionId: null,
      }),
    );
  });
  it.each([
    'TIMEOUT',
    'PROVIDER_FAILURE',
    'CATALOG_BUSY',
    'INVALID_WORKSPACE',
    'RESULT_TOO_LARGE',
  ])('preserves the typed %s response', async (code) => {
    const { subject, gateway } = createSubject();
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: [
        {
          requestId: event.envelope.event.requestId,
          operation: 'workspace.skills.list',
          status: 'error',
          error: { code, message: 'Catalog read failed' },
        },
      ],
    }));
    expect(await subject.readWorkspace(params)).toMatchObject({
      operation: 'workspace.skills.list',
      status: 'error',
      error: { code },
    });
  });
  it('rejects acknowledgements from a different provider', async () => {
    const { subject, gateway } = createSubject();
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: [
        {
          requestId: event.envelope.event.requestId,
          operation: 'workspace.skills.list',
          status: 'success',
          result: { provider: 'claude', skills: [], errors: [] },
        },
      ],
    }));
    expect(await subject.readWorkspace(params)).toMatchObject({
      status: 'error',
      error: { code: 'CORRELATION_MISMATCH' },
    });
  });
});

describe('machine-addressed model catalog acknowledgements', () => {
  const params: Parameters<CliReadEmitter['readRuntimeModelCatalog']>[0] = {
    organizationId: '66666666-6666-4666-8666-666666666666' as Parameters<
      CliReadEmitter['readRuntimeModelCatalog']
    >[0]['organizationId'],
    projectId: projectId as Parameters<
      CliReadEmitter['readRuntimeModelCatalog']
    >[0]['projectId'],
    machineId: machineId as Parameters<
      CliReadEmitter['readRuntimeModelCatalog']
    >[0]['machineId'],
    userId: userId as Parameters<
      CliReadEmitter['readRuntimeModelCatalog']
    >[0]['userId'],
    authorizationRequestId: runId,
    admission: {
      authorizationId: runId,
      envelopeAuthorization: { kind: 'bounded_grant', grantId: 'grant-1' },
      actionPayloadHash: 'a'.repeat(64),
    },
  };

  it('signs the exact project and machine without a session', async () => {
    const { subject, signer, gateway, authorization } = createSubject();
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: [
        {
          requestId: event.envelope.event.requestId,
          operation: 'runtime.model_catalog.get',
          status: 'success',
          result: { providers: [] },
        },
      ],
    }));

    expect(await subject.readRuntimeModelCatalog(params)).toMatchObject({
      status: 'success',
    });
    const [body] = signer.signCliReadAuthorized.mock.calls[0]!;
    expect(body).toEqual({
      requestId: expect.any(String),
      operation: 'runtime.model_catalog.get',
      organizationId: params.organizationId,
      projectId,
      machineId,
      authorizationRequestId: runId,
    });
    expect(authorization.resolveSelectedAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'CLI_READ', id: machineId, revision: null },
        agentSessionId: null,
      }),
    );
  });

  it('returns the CLI model catalog and a zero-model notice unchanged', async () => {
    const { gateway, subject } = createSubject();
    let response: CliReadRuntimeModelCatalogGetSuccessResponseDto;
    gateway.emitCliReadWithAck.mockImplementation(async (event) => {
      response = {
        requestId: event.envelope.event.requestId,
        operation: 'runtime.model_catalog.get',
        status: 'success',
        result: {
          providers: [
            {
              provider: 'codex',
              models: [
                {
                  id: 'gpt-5',
                  label: 'GPT-5',
                  efforts: ['low', 'high'],
                  serviceTiers: ['priority'],
                },
              ],
            },
            {
              provider: 'opencode',
              models: [
                {
                  id: 'anthropic/claude',
                  label: 'Claude',
                  efforts: ['default'],
                  opencodeModelRef: {
                    providerID: 'anthropic',
                    modelID: 'claude',
                  },
                },
              ],
            },
            {
              provider: 'claude',
              models: [],
              notice: 'Claude Code reported zero models on this machine.',
            },
          ],
        },
      } as CliReadRuntimeModelCatalogGetSuccessResponseDto;
      return { kind: 'ack', value: response };
    });

    const result = await subject.readRuntimeModelCatalog(params);
    expect(result).toEqual(response!);
  });

  it.each([
    ['malformed', CliReadErrorCode.MalformedAck],
    ['mismatched', CliReadErrorCode.CorrelationMismatch],
  ] as const)(
    'rejects a %s model catalog acknowledgement',
    async (kind, code) => {
      const { gateway, subject } = createSubject();
      gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
        kind: 'ack',
        value: {
          requestId:
            kind === 'mismatched' ? runId : event.envelope.event.requestId,
          operation: 'runtime.model_catalog.get',
          status: 'success',
          result: { providers: kind === 'malformed' ? null : [] },
        },
      }));

      await expect(
        subject.readRuntimeModelCatalog(params),
      ).resolves.toMatchObject({
        operation: 'runtime.model_catalog.get',
        status: 'error',
        error: { code },
      });
    },
  );

  it('preserves a correlated model catalog RESULT_TOO_LARGE error', async () => {
    const { gateway, subject } = createSubject();
    gateway.emitCliReadWithAck.mockImplementation(async (event) => ({
      kind: 'ack',
      value: {
        requestId: event.envelope.event.requestId,
        operation: 'runtime.model_catalog.get',
        status: 'error',
        error: {
          code: CliReadErrorCode.ResultTooLarge,
          message: 'The model catalog exceeds the response size limit.',
        },
      } satisfies CliReadRuntimeModelCatalogGetErrorResponseDto,
    }));

    await expect(
      subject.readRuntimeModelCatalog(params),
    ).resolves.toMatchObject({
      operation: 'runtime.model_catalog.get',
      status: 'error',
      error: { code: CliReadErrorCode.ResultTooLarge },
    });
  });
});
