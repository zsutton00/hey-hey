import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConversationWorkflowService } from '../../workflows/conversation-workflow.service';
import { WorkflowTypeRegistryService } from '../../workflows/workflow-type-registry.service';
import type { CreateAgentSessionConversationDto } from 'src/generated';
import { AgentSessionService } from '../../agent-session.service';
import { EvalRunService } from '../eval-run.service';
import { EvalRunController } from 'src/controllers/eval-run.controller';

const ORG = 'org-1' as never;
const PROJECT = 'project-1' as never;
const USER = 'user-1' as never;
const EVAL_ID = '44444444-4444-4444-8444-444444444444';
const CASE_ID = '55555555-5555-4555-8555-555555555555';
const CONFIG_A = {
  id: '66666666-6666-4666-8666-666666666666',
  target: { provider: 'claude', model: 'opus' },
};
const CONFIG_B = {
  id: '77777777-7777-4777-8777-777777777777',
  target: { provider: 'codex', model: 'gpt' },
};
const JUDGE = { provider: 'claude', model: 'sonnet' };

const caseRecord = {
  id: CASE_ID,
  name: 'A case',
  sections: [
    { key: 'situation', materializedMarkdown: 'Situation' },
    { key: 'request', materializedMarkdown: 'Do the thing' },
    { key: 'handler', materializedMarkdown: 'entity_conversation' },
    {
      key: 'items',
      materializedMarkdown:
        '@[task:88888888-8888-4888-8888-888888888888|Focal]',
    },
  ],
};

function build() {
  const tx = {};
  const prisma = {
    db: {
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: EVAL_ID, name: 'Eval' }),
        findMany: jest.fn().mockResolvedValue([caseRecord]),
      },
      report: { findFirst: jest.fn(), findMany: jest.fn() },
      agentSession: { findUnique: jest.fn() },
      agentOperation: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
    },
  };
  const reports = {
    createWithIdInTransaction: jest.fn((_tx, _org, id, dto) =>
      Promise.resolve({ id, ...dto }),
    ),
  };
  let sessionCount = 0;
  const sessions = {
    createInTransaction: jest.fn(() => {
      sessionCount += 1;
      return Promise.resolve({ id: `session-${sessionCount}` });
    }),
    createConversationForSession: jest.fn(
      (_org, _project, sessionId, _dto: CreateAgentSessionConversationDto) =>
        Promise.resolve({
          conversation: {
            id: String(sessionId).replace('session', 'conversation'),
          },
        }),
    ),
    rollbackEvalLaunchSession: jest.fn().mockResolvedValue(undefined),
  };
  const service = new EvalRunService(
    prisma as never,
    reports as never,
    sessions as never,
  );
  return { service, prisma, reports, sessions };
}

const request = {
  evalCaseIds: [CASE_ID],
  configurations: [CONFIG_A, CONFIG_B],
  judgeSetup: JUDGE,
};

describe('EvalRunService.launch', () => {
  it('subjects every attempt conversation to its recorded focal item', async () => {
    const { service, prisma, sessions } = build();
    const focalItemIds = [
      '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999',
    ];
    const cases = focalItemIds.map((focalItemId, index) => ({
      ...caseRecord,
      id: crypto.randomUUID(),
      sections: [
        ...caseRecord.sections.filter((s) => s.key !== 'items'),
        {
          key: 'items',
          materializedMarkdown: `@[${index === 0 ? 'feature' : 'project'}:${focalItemId}|Focal item]`,
        },
      ],
    }));
    prisma.db.task.findMany.mockResolvedValue(cases);
    const inserted: unknown[] = [];
    const bindings = new Map<string, string>();
    const workflow = new ConversationWorkflowService(
      {
        createConversation: async (
          dto: unknown,
          _organizationId: unknown,
          options: {
            onCreatedInTx?: (
              tx: unknown,
              conversation: { id: string },
            ) => Promise<void>;
          },
        ) => {
          const id = `conversation-${inserted.length + 1}`;
          await options?.onCreatedInTx?.(
            {
              agentSession: {
                updateMany: async ({
                  where,
                  data,
                }: {
                  where: { id: string };
                  data: { conversationId: string };
                }) => {
                  bindings.set(where.id, data.conversationId);
                  return { count: 1 };
                },
              },
            },
            { id },
          );
          inserted.push(dto);
          return { id, ...(dto as object) };
        },
      } as never,
      new WorkflowTypeRegistryService({} as never),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    sessions.createConversationForSession.mockImplementation(
      async (
        _org,
        _project,
        sessionId,
        dto: CreateAgentSessionConversationDto,
      ) => {
        const subject = {
          prisma: {
            db: {
              agentSession: {
                findFirst: async () => ({
                  id: sessionId,
                  userId: USER,
                  conversationId: null,
                }),
                findFirstOrThrow: async () => ({
                  id: sessionId,
                  conversationId: bindings.get(sessionId),
                }),
              },
            },
          },
          logger: { log: jest.fn() },
          assertProjectOwnership: async () => {},
          conversationWorkflowService: workflow,
          buildSelectedServiceRelationsInclude: () => ({}),
          toDto: (value: unknown) => value,
          toCurrentStateIdentity: () => ({}),
          enrichAgentSessionDto: async (value: unknown) => value,
        };
        return AgentSessionService.prototype.createConversationForSession.call(
          subject as never,
          ORG,
          PROJECT,
          sessionId,
          dto,
        ) as never;
      },
    );

    await new EvalRunController(service).launch(ORG, PROJECT, EVAL_ID, USER, {
      ...request,
      evalCaseIds: cases.map((item) => item.id),
    });

    expect(bindings.size).toBe(5);
    expect(inserted).toHaveLength(5);
    expect(bindings.get('session-1')).toBe('conversation-1');
    expect(sessions.createConversationForSession).toHaveBeenNthCalledWith(
      1,
      ORG,
      PROJECT,
      'session-1',
      { workflowType: 'agent-session', title: 'Eval run' },
    );

    for (const [index, focalItemId] of focalItemIds
      .flatMap((id) => [id, id])
      .entries()) {
      expect(sessions.createConversationForSession).toHaveBeenNthCalledWith(
        index + 2,
        ORG,
        PROJECT,
        `session-${index + 2}`,
        expect.objectContaining({
          workflowType: 'agent-entity-conversation',
          workflowAboutType: index < 2 ? 'task' : 'project',
          workflowAboutId: focalItemId,
        }),
      );
    }
  });

  it('accepts the app launch shape with UUID configuration ids through the controller', async () => {
    const { service, prisma, reports } = build();
    const cases = Array.from({ length: 4 }, () => ({
      ...caseRecord,
      id: crypto.randomUUID(),
    }));
    prisma.db.task.findMany.mockResolvedValue(cases);
    const configuration = {
      id: crypto.randomUUID(),
      target: {
        provider: 'claude',
        model: 'claude-opus-5-5',
        reasoningEffort: 'medium',
      },
    };
    const body = {
      evalCaseIds: cases.map((item) => item.id),
      configurations: [configuration],
      judgeSetup: {
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        reasoningEffort: 'medium',
      },
      settings: { maxConcurrentAttempts: 3 },
    };
    await new EvalRunController(service).launch(
      ORG,
      PROJECT,
      EVAL_ID,
      USER,
      body,
    );
    const calls = reports.createWithIdInTransaction.mock.calls;
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call[3].ragEnabled).toBe(false);
    }
    expect(calls[0]![3].payload).toMatchObject({
      configurations: body.configurations,
      judgeSetup: body.judgeSetup,
      settings: body.settings,
    });
    expect(calls[0]![3].payload.cases).toHaveLength(4);
    expect(calls.slice(1).map((call) => call[3].payload.configuration)).toEqual(
      cases.map(() => configuration),
    );
  });

  it('records one run and an attempt per case and setup without starting an agent', async () => {
    const { service, reports, sessions } = build();

    const run = await service.launch(
      ORG,
      PROJECT,
      USER,
      EVAL_ID,
      request as never,
    );

    const calls = reports.createWithIdInTransaction.mock.calls;
    expect(calls).toHaveLength(3);
    const [, , runId, runDto] = calls[0]!;
    expect(run.id).toBe(runId);
    expect(runDto).toMatchObject({
      reportType: 'EVAL_RUN',
      neverExpires: true,
      entities: [{ entityType: 'TASK', entityId: EVAL_ID }],
      payload: {
        evalId: EVAL_ID,
        status: 'QUEUED',
        judgeSetup: JUDGE,
        configurations: [CONFIG_A, CONFIG_B],
        settings: { maxConcurrentAttempts: 3 },
        coordinatorAgentSessionId: 'session-1',
        coordinatorConversationId: 'conversation-1',
      },
    });
    expect(runDto.payload.cases).toHaveLength(1);
    const caseInputId = runDto.payload.cases[0].id;
    for (const [, , , attemptDto] of calls.slice(1)) {
      expect(attemptDto).toMatchObject({
        reportType: 'EVAL_ATTEMPT',
        neverExpires: true,
        parentReportId: runId,
        payload: { caseInputId, status: 'QUEUED' },
      });
    }
    expect(
      calls.slice(1).map(([, , , dto]) => {
        const payload = (
          dto as {
            payload: { targetSessionId: string; targetConversationId: string };
          }
        ).payload;
        return [payload.targetSessionId, payload.targetConversationId];
      }),
    ).toEqual([
      ['session-2', 'conversation-2'],
      ['session-3', 'conversation-3'],
    ]);
    expect(
      calls
        .slice(1)
        .map(
          ([, , , dto]) =>
            (dto as { payload: { configuration: { id: string } } }).payload
              .configuration.id,
        ),
    ).toEqual([CONFIG_A.id, CONFIG_B.id]);
    expect(sessions.createConversationForSession).toHaveBeenCalledTimes(3);
    expect(sessions.createConversationForSession).toHaveBeenNthCalledWith(
      2,
      ORG,
      PROJECT,
      'session-2',
      {
        workflowType: 'agent-entity-conversation',
        title: 'Eval attempt',
        workflowAboutType: 'task',
        workflowAboutId: '88888888-8888-4888-8888-888888888888',
      },
    );
  });

  it('records the run settings the person chose, leaving unset limits absent', async () => {
    const { service, reports } = build();
    await service.launch(ORG, PROJECT, USER, EVAL_ID, {
      ...request,
      settings: { maxConcurrentAttempts: 5, attemptTokenLimit: 20000 },
    } as never);
    const [, , , runDto] = reports.createWithIdInTransaction.mock.calls[0]!;
    expect(runDto.payload.settings).toEqual({
      maxConcurrentAttempts: 5,
      attemptTokenLimit: 20000,
    });
  });

  it('removes every prepared session when the run cannot be recorded', async () => {
    const { service, reports, sessions } = build();
    reports.createWithIdInTransaction.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.launch(ORG, PROJECT, USER, EVAL_ID, request as never),
    ).rejects.toThrow('boom');
    expect(sessions.rollbackEvalLaunchSession.mock.calls).toEqual([
      [ORG, 'session-1'],
      [ORG, 'session-2'],
      [ORG, 'session-3'],
    ]);
  });

  it('removes the sessions prepared so far when a target session cannot be prepared', async () => {
    const { service, reports, sessions } = build();
    sessions.createInTransaction
      .mockResolvedValueOnce({ id: 'session-1' })
      .mockRejectedValueOnce(new Error('no session'));
    await expect(
      service.launch(ORG, PROJECT, USER, EVAL_ID, request as never),
    ).rejects.toThrow('no session');
    expect(sessions.rollbackEvalLaunchSession.mock.calls).toEqual([
      [ORG, 'session-1'],
    ]);
    expect(reports.createWithIdInTransaction).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    'removes the failing session when conversation %s fails',
    async (failure) => {
      const { service, sessions, reports } = build();
      sessions.createConversationForSession.mockImplementation(
        async (_org, _project, sessionId) => {
          if (sessionId === `session-${failure}`) {
            throw new Error('conversation failed');
          }
          return { conversation: { id: 'conversation-1' } };
        },
      );
      await expect(
        service.launch(ORG, PROJECT, USER, EVAL_ID, request as never),
      ).rejects.toThrow('conversation failed');
      expect(
        sessions.rollbackEvalLaunchSession.mock.calls
          .map((call) => call[1])
          .sort(),
      ).toEqual(
        Array.from({ length: failure }, (_, index) => `session-${index + 1}`),
      );
      expect(reports.createWithIdInTransaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a case that is not an approved case of this Eval before recording anything', async () => {
    const { service, prisma, reports, sessions } = build();
    prisma.db.task.findMany.mockResolvedValue([]);

    await expect(
      service.launch(ORG, PROJECT, USER, EVAL_ID, request as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          parentTaskId: EVAL_ID,
          type: 'EVAL_CASE',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(reports.createWithIdInTransaction).not.toHaveBeenCalled();
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a case naming an unevaluable handler before preparing or recording anything', async () => {
    const { service, prisma, reports, sessions } = build();
    prisma.db.task.findMany.mockResolvedValue([
      {
        ...caseRecord,
        sections: [
          ...caseRecord.sections.filter((s) => s.key !== 'handler'),
          { key: 'handler', materializedMarkdown: 'run_eval' },
        ],
      },
    ]);

    await expect(
      service.launch(ORG, PROJECT, USER, EVAL_ID, request as never),
    ).rejects.toThrow(/handler "run_eval" is not evaluable/);
    expect(reports.createWithIdInTransaction).not.toHaveBeenCalled();
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });

  it('records the handler and consumer keys of a Project Assistant case in the run', async () => {
    const { service, prisma, reports } = build();
    prisma.db.task.findMany.mockResolvedValue([
      {
        ...caseRecord,
        sections: [
          ...caseRecord.sections.filter((s) => s.key !== 'handler'),
          { key: 'handler', materializedMarkdown: 'project_assistant' },
          {
            key: 'consumerHandler',
            materializedMarkdown: 'entity_conversation',
          },
        ],
      },
    ]);

    await service.launch(ORG, PROJECT, USER, EVAL_ID, request as never);

    const [, , , runDto] = reports.createWithIdInTransaction.mock.calls[0]!;
    expect(runDto.payload.cases[0].target).toMatchObject({
      targetHandler: 'project_assistant',
      consumerHandler: 'entity_conversation',
    });
  });

  describe('run-level handler', () => {
    const attemptPayloads = (
      reports: ReturnType<typeof build>['reports'],
    ): Array<{ execution: unknown }> =>
      reports.createWithIdInTransaction.mock.calls
        .slice(1)
        .map(([, , , dto]) => dto.payload);

    it('runs the chosen handler for every case without editing the case, and records what ran', async () => {
      const { service, reports, sessions } = build();
      const chosen = {
        id: CONFIG_A.id,
        target: {
          ...CONFIG_A.target,
          handlerConfig: {
            handler: 'feature_sync_analyze',
            projectAssistant: { enabled: false },
          },
        },
      };

      await service.launch(ORG, PROJECT, USER, EVAL_ID, {
        ...request,
        configurations: [chosen],
      } as never);

      const [, , , runDto] = reports.createWithIdInTransaction.mock.calls[0]!;
      expect(runDto.payload.cases[0].target.targetHandler).toBe(
        'entity_conversation',
      );
      expect(attemptPayloads(reports)).toEqual([
        expect.objectContaining({
          execution: {
            handler: 'feature_sync_analyze',
            projectAssistantPrepares: false,
            assessedOutput: 'HANDLER_REPLY',
          },
        }),
      ]);
      expect(sessions.createConversationForSession).toHaveBeenLastCalledWith(
        ORG,
        PROJECT,
        'session-2',
        expect.objectContaining({ workflowType: 'agent-session' }),
      );
    });

    it('has Project Assistant prepare the chosen handler unless the setup turns it off', async () => {
      const { service, reports } = build();
      const chosen = {
        id: CONFIG_A.id,
        target: {
          ...CONFIG_A.target,
          handlerConfig: { handler: 'entity_conversation' },
        },
      };

      await service.launch(ORG, PROJECT, USER, EVAL_ID, {
        ...request,
        configurations: [chosen],
      } as never);

      expect(attemptPayloads(reports)[0]!.execution).toMatchObject({
        handler: 'entity_conversation',
        projectAssistantPrepares: true,
      });
    });

    it('runs research alone under entity conversation policy when Project Assistant alone is chosen', async () => {
      const { service, reports, sessions } = build();
      const chosen = {
        id: CONFIG_A.id,
        target: {
          ...CONFIG_A.target,
          handlerConfig: { handler: 'project_assistant' },
        },
      };

      await service.launch(ORG, PROJECT, USER, EVAL_ID, {
        ...request,
        configurations: [chosen],
      } as never);

      expect(attemptPayloads(reports)[0]!.execution).toEqual({
        handler: 'project_assistant',
        consumerHandler: 'entity_conversation',
        projectAssistantPrepares: false,
        assessedOutput: 'RESEARCH_REPORT',
      });
      expect(sessions.createConversationForSession).toHaveBeenLastCalledWith(
        ORG,
        PROJECT,
        'session-2',
        expect.objectContaining({ workflowType: 'agent-entity-conversation' }),
      );
    });

    it('rejects a run-level handler that is not evaluable before preparing or recording anything', async () => {
      const { service, reports, sessions } = build();

      await expect(
        service.launch(ORG, PROJECT, USER, EVAL_ID, {
          ...request,
          configurations: [
            {
              id: CONFIG_A.id,
              target: {
                ...CONFIG_A.target,
                handlerConfig: { handler: 'run_eval' },
              },
            },
          ],
        } as never),
      ).rejects.toThrow(/handler "run_eval" is not evaluable/);
      expect(reports.createWithIdInTransaction).not.toHaveBeenCalled();
      expect(sessions.createInTransaction).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['no cases', { ...request, evalCaseIds: [] }],
    ['no setups', { ...request, configurations: [] }],
    [
      'a model key instead of a configuration UUID',
      {
        ...request,
        configurations: [{ ...CONFIG_A, id: 'claude:claude-opus-5-5:medium' }],
      },
    ],
    [
      'a configuration without a target',
      { ...request, configurations: [{ id: CONFIG_A.id }] },
    ],
    ['a repeated case', { ...request, evalCaseIds: [CASE_ID, CASE_ID] }],
    [
      'repeated setup ids',
      { ...request, configurations: [CONFIG_A, CONFIG_A] },
    ],
    [
      'zero attempts at once',
      { ...request, settings: { maxConcurrentAttempts: 0 } },
    ],
    [
      'a fractional time limit',
      { ...request, settings: { attemptTimeLimitSeconds: 1.5 } },
    ],
  ])('rejects %s', async (_name, body) => {
    const { service, reports, sessions } = build();
    await expect(
      service.launch(ORG, PROJECT, USER, EVAL_ID, body as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(reports.createWithIdInTransaction).not.toHaveBeenCalled();
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });
});

describe('EvalRunService.assertStartRun', () => {
  const SESSION = 'session-1';
  const CONVERSATION = 'conversation-1';
  const SETTINGS = { maxConcurrentAttempts: 3, attemptTimeLimitSeconds: 600 };
  const attemptId = '88888888-8888-4888-8888-888888888888';
  const caseInput = { id: 'case-input-1', title: 'A case' };
  const runRow = {
    id: 'run-1',
    projectId: PROJECT,
    payload: {
      evalId: EVAL_ID,
      status: 'QUEUED',
      judgeSetup: JUDGE,
      settings: SETTINGS,
      cases: [caseInput],
      coordinatorAgentSessionId: SESSION,
      coordinatorConversationId: CONVERSATION,
    },
  };
  const execution = {
    handler: 'entity_conversation',
    projectAssistantPrepares: true,
    assessedOutput: 'HANDLER_REPLY',
  };
  const recordedAttempt = {
    attemptId,
    caseInput,
    configuration: CONFIG_A,
    execution,
    targetSessionId: 'target-session-1',
    targetConversationId: 'target-conversation-1',
  };
  const startRequest = (overrides: Record<string, unknown> = {}) =>
    ({
      agentSessionId: SESSION,
      operationId: 'op-1',
      operationFingerprint: 'fp-1',
      handlerPromptType: 'run_eval',
      payload: {
        promptType: 'run_eval',
        entity: { entityType: 'TASK', entityId: EVAL_ID },
        evalRunId: 'run-1',
        judgeSetup: JUDGE,
        settings: SETTINGS,
        attempts: [recordedAttempt],
        ...overrides,
      },
    }) as never;

  function recorded() {
    const built = build();
    built.prisma.db.report.findFirst.mockResolvedValue(runRow);
    built.prisma.db.report.findMany.mockResolvedValue([
      {
        id: attemptId,
        payload: {
          caseInputId: caseInput.id,
          configuration: CONFIG_A,
          execution,
          targetSessionId: 'target-session-1',
          targetConversationId: 'target-conversation-1',
        },
      },
    ]);
    built.prisma.db.agentSession.findUnique.mockResolvedValue({
      userId: USER,
    });
    return built;
  }
  const input = (requestDto: never) => ({
    organizationId: ORG,
    projectId: PROJECT,
    userId: USER,
    conversationId: CONVERSATION,
    requestDto,
  });

  it('accepts the exact payload recorded at launch', async () => {
    const { service } = recorded();
    await expect(service.assertStartRun(input(startRequest()))).resolves.toBe(
      true,
    );
  });

  it('ignores starts of sessions that are not eval runs', async () => {
    const { service, prisma } = build();
    prisma.db.report.findFirst.mockResolvedValue(null);
    await expect(
      service.assertStartRun(
        input({
          agentSessionId: 'other',
          handlerPromptType: 'free_form',
        } as never),
      ),
    ).resolves.toBe(false);
  });

  it('rejects run_eval for a session with no recorded run', async () => {
    const { service, prisma } = build();
    prisma.db.report.findFirst.mockResolvedValue(null);
    await expect(
      service.assertStartRun(input(startRequest())),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    [
      'a different focal entity',
      { entity: { entityType: 'TASK', entityId: 'x' } },
    ],
    ['a different run id', { evalRunId: 'run-2' }],
    ['a different judge setup', { judgeSetup: { provider: 'x', model: 'y' } }],
    ['different settings', { settings: { maxConcurrentAttempts: 3 } }],
    ['missing attempts', { attempts: [] }],
    [
      'an altered attempt',
      { attempts: [{ ...recordedAttempt, configuration: CONFIG_B }] },
    ],
  ])('rejects a start with %s', async (_name, overrides) => {
    const { service } = recorded();
    await expect(
      service.assertStartRun(input(startRequest(overrides))),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a start once the run is no longer queued', async () => {
    const { service, prisma } = recorded();
    prisma.db.report.findFirst.mockResolvedValue({
      ...runRow,
      payload: { ...runRow.payload, status: 'RUNNING' },
    });
    await expect(
      service.assertStartRun(input(startRequest())),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts a replay of the start already accepted after the run moved on', async () => {
    const { service, prisma } = recorded();
    prisma.db.report.findFirst.mockResolvedValue({
      ...runRow,
      payload: { ...runRow.payload, status: 'RUNNING' },
    });
    prisma.db.agentOperation.findUnique.mockResolvedValue({
      agentSessionId: SESSION,
      fingerprint: 'fp-1',
    });
    await expect(service.assertStartRun(input(startRequest()))).resolves.toBe(
      true,
    );
  });

  it('rejects a start on another conversation', async () => {
    const { service } = recorded();
    await expect(
      service.assertStartRun({
        ...input(startRequest()),
        conversationId: 'other',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a start by someone other than the launcher', async () => {
    const { service, prisma } = recorded();
    prisma.db.agentSession.findUnique.mockResolvedValue({ userId: 'other' });
    await expect(
      service.assertStartRun(input(startRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects starting a run session with another handler', async () => {
    const { service } = recorded();
    await expect(
      service.assertStartRun(
        input({
          agentSessionId: SESSION,
          handlerPromptType: 'free_form',
          payload: { promptType: 'free_form' },
        } as never),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
