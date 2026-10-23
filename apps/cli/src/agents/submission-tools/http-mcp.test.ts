import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { SubmissionToolsHttpController } from './http-mcp';
import { SubmissionToolRegistry } from './registry';
import { stampCreateBody, type MessagePoster } from '../../run/message-poster';
import type { MessagePosterCreateOutOfBandArgs, PendingTurnCompletion } from '../../run/types';
import type { Run } from '../../run/run';
import { createTestRun } from '../../run/run.test-support';
import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';
import type { CreateSystemMessage } from '../../shared/api/index';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { Turn } from '../../turn/turn';
import type { PromptTypeHandler } from '../prompt-type-handler';
import {
  SubmissionToolCorrectableError,
  type PassThroughSubmissionToolDeclaration,
  type SubmissionToolDeclaration,
} from './types';
import { createTestMessagePoster, createTestRunRegistry } from '../../run/run.test-support';
import { FEATURE_SYNC_ACTIONS, submitReadinessTool } from '../feature-sync/submission-tools';
import { IncludeExistingProposalsInCurrentMessageTool } from './include-existing-proposals-in-current-message-tool';

/**
 * Action tools no longer post inline — they record the completion on the
 * active Run, which flushes it at turn-end. The HTTP handler resolves the Run
 * via `deps.getRun`, so action-tool tests configure a concrete Run owner and
 * spy on `recordPendingCompletion` while using real Run/Turn state for stamps.
 */
interface TestRunOptions {
  runId?: string;
  organizationId?: string;
  projectId?: string;
  conversationId?: string;
  providerSessionId?: string;
  activeHandler?: {
    promptType: PromptTypeHandler<unknown>['promptType'];
    submissionTools?: SubmissionToolDeclaration[];
  };
  setLastSubmissionAction?: Run['setLastSubmissionAction'];
  isBaseSubmissionTool?: Run['isBaseSubmissionTool'];
  poster?: MessagePoster;
}

const makePromptTypeHandler = (
  promptType: PromptTypeHandler<unknown>['promptType'],
  submissionTools?: SubmissionToolDeclaration[],
): PromptTypeHandler<unknown> => ({
  id: `test-${promptType}`,
  promptType,
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  reports: [],
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  buildPrompt: () => '',
  ...(submissionTools ? { submissionTools } : {}),
});

const setActiveTurn = (
  run: Run,
  activeHandler: NonNullable<TestRunOptions['activeHandler']>,
): void => {
  run.setActiveTurn(
    new Turn({
      turnId: 'test-turn-id',
      runId: run.runId,
      resolvedPrompt: '',
      handler: makePromptTypeHandler(activeHandler.promptType, activeHandler.submissionTools),
      externalAgentNodeId: null,
      triggerMessageId: null,
      runner: { run: async () => undefined },
      platformMcpProxy: null,
      abortController: new AbortController(),
      logger: NOOP_LOGGER,
      owner: run,
      effectiveModel: null,
      effectiveReasoningEffort: null,
    }),
  );
};

const makeRun = (
  recordPendingCompletion?: (completion: PendingTurnCompletion) => void,
  options: TestRunOptions = {},
): Run => {
  const run = createTestRun(
    {
      runId: options.runId ?? 'test-run-id',
      organizationId: options.organizationId ?? 'test-org-id',
      projectId: options.projectId ?? 'test-project-id',
      conversationId: options.conversationId ?? 'test-conversation-id',
    },
    options.poster ? { poster: options.poster } : {},
  );
  run.session.contextMetadata.agentSessionId = 'test-agent-session-id';
  if (options.providerSessionId !== undefined) {
    run.session.provider_session_id = options.providerSessionId;
  }
  if (recordPendingCompletion) {
    vi.spyOn(run, 'recordPendingCompletion').mockImplementation(recordPendingCompletion);
  }
  vi.spyOn(run, 'setLastSubmissionAction').mockImplementation(
    options.setLastSubmissionAction ?? (() => undefined),
  );
  if (options.isBaseSubmissionTool) {
    vi.spyOn(run, 'isBaseSubmissionTool').mockImplementation(options.isBaseSubmissionTool);
  }
  if (options.activeHandler) {
    setActiveTurn(run, options.activeHandler);
  }
  return run;
};

const makePoster = (): MessagePoster => {
  const poster = createTestMessagePoster();
  vi.mocked(poster.createOutOfBand).mockImplementation(
    async (args: MessagePosterCreateOutOfBandArgs) => {
      args.dto = stampCreateBody(args.dto, args.stamp);
      return 'opener-1';
    },
  );
  return poster;
};

interface OutOfBandCall {
  dto: CreateSystemMessage;
}

const outOfBandCall = (poster: MessagePoster, idx = 0): OutOfBandCall => {
  const call = (poster.createOutOfBand as ReturnType<typeof vi.fn>).mock.calls[idx]!;
  return {
    dto: (call[0] as MessagePosterCreateOutOfBandArgs).dto as CreateSystemMessage,
  };
};

const dataAsRecord = (dto: CreateSystemMessage): Record<string, unknown> =>
  dto.data as unknown as Record<string, unknown>;

const makeLogger = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as ServerLogger;

const submissionToolRegistry = new SubmissionToolRegistry();

const createSubmissionToolsHttpHandler = (deps: {
  poster: MessagePoster;
  logger: ServerLogger;
  getRun?: (runId: string) => Run | null;
}) => {
  const runRegistry = createTestRunRegistry();
  vi.spyOn(runRegistry, 'get').mockImplementation(deps.getRun ?? (() => null));
  return new SubmissionToolsHttpController(
    submissionToolRegistry,
    runRegistry,
    deps.poster,
    deps.logger,
  ).handle;
};

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

const makeReqRes = (
  token: string,
  body: unknown,
): { req: Request; res: Response; captured: CapturedResponse } => {
  const captured: CapturedResponse = { statusCode: 200, body: null };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as Response;

  const req = {
    params: { token },
    body,
  } as unknown as Request;

  return { req, res, captured };
};

const TOOL: SubmissionToolDeclaration = {
  name: 'submit_no_discrepancy',
  description: 'Submit a no-discrepancy verdict.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: () => ({ action: 'NO_DISCREPANCY' }),
};

const TOOL_WITH_PAYLOAD: SubmissionToolDeclaration = {
  name: 'submit_discrepancies',
  description: 'Submit a list of discrepancies.',
  inputSchema: {
    type: 'object',
    properties: { discrepancies: { type: 'array' } },
    required: ['discrepancies'],
  },
  execute: ({ args }) => ({
    action: 'DISCREPANCY',
    payload: { discrepancies: args['discrepancies'] },
  }),
};

describe('createSubmissionToolsHttpHandler', () => {
  afterEach(() => {
    submissionToolRegistry.clearAll();
    vi.clearAllMocks();
  });

  it('returns 404 when the token is unknown', async () => {
    const poster = makePoster();
    const handler = createSubmissionToolsHttpHandler({ poster, logger: makeLogger() });

    const { req, res, captured } = makeReqRes('bogus', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    await handler(req, res);

    expect(captured.statusCode).toBe(404);
    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32001 },
    });
  });

  it('responds to initialize with protocolVersion + tools capability', async () => {
    const poster = makePoster();
    const reg = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [TOOL],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger: makeLogger() });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    });
    await handler(req, res);

    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'heyhey-submission-tools' },
      },
    });
  });

  it('lists registered tools', async () => {
    const poster = makePoster();
    const reg = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-list-1',
      tools: [TOOL, TOOL_WITH_PAYLOAD],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger: makeLogger() });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    await handler(req, res);

    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [{ name: 'submit_no_discrepancy' }, { name: 'submit_discrepancies' }],
      },
    });
  });

  it('records a no-payload completion on the Run for turn-end flush rather than posting inline', async () => {
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const reg = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-analyze-1',
      triggerMessageId: 'trigger-analyze-1',
      tools: [TOOL],
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => makeRun(recordPendingCompletion),
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'submit_no_discrepancy', arguments: {} },
    });
    await handler(req, res);

    // Nothing posts inline; the completion is recorded for the Run to flush.
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(recordPendingCompletion).toHaveBeenCalledTimes(1);
    expect(recordPendingCompletion).toHaveBeenCalledWith({
      action: { action: 'NO_DISCREPANCY' },
      externalAgentNodeId: 'node-analyze-1',
      triggerMessageId: 'trigger-analyze-1',
      stamp: null,
    });

    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text' }] },
    });
  });

  it('records a stamp derived from the active Run/Turn so the turn-end flush attributes the completion (tool-terminated turn)', async () => {
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const reg = submissionToolRegistry.register({
      runId: 'run-stamp-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-stamp-1',
      triggerMessageId: 'trigger-stamp-1',
      tools: [TOOL],
    });
    const run = makeRun(recordPendingCompletion, {
      providerSessionId: 'sess-stamp-1',
      activeHandler: { promptType: LocalPromptType.FeatureSyncAnalyze },
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });

    const { req, res } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'submit_no_discrepancy', arguments: {} },
    });
    await handler(req, res);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(recordPendingCompletion).toHaveBeenCalledTimes(1);
    expect(recordPendingCompletion.mock.calls[0]![0]).toMatchObject({
      stamp: { providerSessionId: 'sess-stamp-1', promptHandler: 'feature_sync_analyze' },
    });
  });

  it('records the action on the owning Run before assistant_complete', async () => {
    const poster = makePoster();
    const setLastSubmissionAction = vi.fn();
    const reg = submissionToolRegistry.register({
      runId: 'run-cb-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-analyze-cb',
      triggerMessageId: 'trigger-cb-1',
      tools: [TOOL],
    });
    const run = makeRun(vi.fn(), {
      setLastSubmissionAction,
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });

    const { req, res } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'submit_no_discrepancy', arguments: {} },
    });
    await handler(req, res);

    expect(setLastSubmissionAction).toHaveBeenCalledWith({ action: 'NO_DISCREPANCY' });
  });

  it('returns a JSON-RPC error when an action tool cannot resolve the active Run to record onto', async () => {
    const poster = makePoster();
    const logger = makeLogger();
    const reg = submissionToolRegistry.register({
      runId: 'run-no-run',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-no-run',
      triggerMessageId: 'trigger-no-run',
      tools: [TOOL],
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger,
      getRun: () => null,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'submit_no_discrepancy', arguments: {} },
    });
    await handler(req, res);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 12,
      error: { code: -32603 },
    });
    expect(logger.error).toHaveBeenCalledWith(
      'local.submission_tools.action_no_run',
      expect.objectContaining({ toolName: 'submit_no_discrepancy' }),
    );
  });

  it('records a payload-bearing completion (action + payload) on the Run rather than posting inline', async () => {
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const reg = submissionToolRegistry.register({
      runId: 'run-2',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-analyze-2',
      triggerMessageId: 'trigger-analyze-2',
      tools: [TOOL_WITH_PAYLOAD],
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => makeRun(recordPendingCompletion),
    });

    const discrepancies = [{ summary: 'X', rationale: 'Y' }];
    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'submit_discrepancies',
        arguments: { discrepancies },
      },
    });
    await handler(req, res);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(recordPendingCompletion).toHaveBeenCalledWith({
      action: { action: 'DISCREPANCY', payload: { discrepancies } },
      externalAgentNodeId: 'node-analyze-2',
      triggerMessageId: 'trigger-analyze-2',
      stamp: null,
    });
    expect((captured.body as { error?: unknown }).error).toBeUndefined();
  });

  it('rejects calls missing required arguments before invoking execute', async () => {
    const poster = makePoster();
    const executeSpy = vi.fn();
    const reg = submissionToolRegistry.register({
      runId: 'run-3',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-iterate-1',
      triggerMessageId: 'trigger-iterate-1',
      tools: [
        {
          ...TOOL_WITH_PAYLOAD,
          execute: executeSpy,
        },
      ],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger: makeLogger() });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'submit_discrepancies', arguments: {} },
    });
    await handler(req, res);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 5,
      result: {
        isError: true,
        structuredContent: {
          status: 'correctable_rejection',
          findings: [
            expect.objectContaining({
              field: '/discrepancies',
              code: 'required',
              correction: expect.stringContaining('retry'),
            }),
          ],
        },
      },
    });
  });

  it('identifies the exact unexpected property in schema findings', async () => {
    const poster = makePoster();
    const executeSpy = vi.fn();
    const reg = submissionToolRegistry.register({
      runId: 'run-additional-property',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-additional-property',
      triggerMessageId: 'trigger-additional-property',
      tools: [
        {
          ...TOOL,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
          execute: executeSpy,
        },
      ],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger: makeLogger() });
    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 50,
      method: 'tools/call',
      params: {
        name: TOOL.name,
        arguments: { 'unexpected/path~segment': true },
      },
    });

    await handler(req, res);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          status: 'correctable_rejection',
          findings: [
            expect.objectContaining({
              field: '/unexpected~1path~0segment',
              code: 'additionalProperties',
              correction: expect.stringContaining('/unexpected~1path~0segment'),
            }),
          ],
        },
      },
    });
  });

  it('rejects an invalid nested shape without completing the workflow and accepts a corrected retry', async () => {
    const poster = makePoster();
    const executeSpy = vi.fn(() => ({ action: 'DONE' }));
    const tool: SubmissionToolDeclaration = {
      name: 'submit_nested',
      description: 'Submit a nested payload.',
      inputSchema: {
        type: 'object',
        required: ['plan'],
        additionalProperties: false,
        properties: {
          plan: {
            type: 'object',
            required: ['steps'],
            additionalProperties: false,
            properties: {
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['acceptanceCriteria'],
                  additionalProperties: false,
                  properties: {
                    acceptanceCriteria: { type: 'string', minLength: 1 },
                  },
                },
              },
            },
          },
        },
      },
      execute: executeSpy,
      hidden: true,
    };
    const reg = submissionToolRegistry.register({
      runId: 'run-nested-retry',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-nested-retry',
      triggerMessageId: 'trigger-nested-retry',
      tools: [tool],
    });
    const run = makeRun(undefined, {
      runId: 'run-nested-retry',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      poster,
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });

    const invalid = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: tool.name,
        arguments: { plan: { steps: [{ acceptanceCriteria: ['Done'] }] } },
      },
    });
    await handler(invalid.req, invalid.res);

    expect(invalid.captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 51,
      result: {
        isError: true,
        content: [
          expect.objectContaining({
            text: expect.stringContaining('/plan/steps/0/acceptanceCriteria'),
          }),
        ],
        structuredContent: {
          status: 'correctable_rejection',
          findings: [
            {
              field: '/plan/steps/0/acceptanceCriteria',
              code: 'type',
              reason: 'must be string',
              correction: 'Set /plan/steps/0/acceptanceCriteria to a string, then retry.',
            },
          ],
        },
      },
    });
    expect(executeSpy).not.toHaveBeenCalled();
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();

    const corrected = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 52,
      method: 'tools/call',
      params: {
        name: tool.name,
        arguments: { plan: { steps: [{ acceptanceCriteria: '- Done' }] } },
      },
    });
    await handler(corrected.req, corrected.res);

    expect((corrected.captured.body as { error?: unknown }).error).toBeUndefined();
    expect(executeSpy).toHaveBeenCalledTimes(1);
    await run.flushPendingCompletion();
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          workflowNodeId: 'node-nested-retry',
          pendingTriggerMessageId: 'trigger-nested-retry',
          action: 'DONE',
        }),
      }),
    );
  });

  it('keeps a malformed readiness trigger pending and advances after a corrected CLEAR retry', async () => {
    const poster = makePoster();
    const reg = submissionToolRegistry.register({
      runId: 'run-readiness-retry',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-readiness-retry',
      triggerMessageId: 'trigger-readiness-retry',
      tools: [submitReadinessTool],
    });
    const run = makeRun(undefined, {
      runId: 'run-readiness-retry',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      poster,
    });
    vi.spyOn(run, 'normalizeImplementationReadinessForSubmission').mockImplementation(
      (disposition) => disposition,
    );
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });
    const sourceSnapshot = {
      runId: 'run-readiness-retry',
      focalEntityId: 'task-123',
      focalEntityType: 'TASK',
      sourceRevision: 'sha256:source-1',
      capturedAt: '2026-09-18T20:00:00.000Z',
    };

    const malformed = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 54,
      method: 'tools/call',
      params: {
        name: submitReadinessTool.name,
        arguments: {
          disposition: {
            state: 'CLEAR',
            sourceSnapshot,
            finding: null,
            resolution: { kind: 'INVALID' },
          },
        },
      },
    });
    await handler(malformed.req, malformed.res);

    expect(malformed.captured.body).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          status: 'correctable_rejection',
          reason: `${submitReadinessTool.name} input did not match its declared schema.`,
        },
      },
    });
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();

    const corrected = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 55,
      method: 'tools/call',
      params: {
        name: submitReadinessTool.name,
        arguments: {
          disposition: {
            state: 'CLEAR',
            sourceSnapshot,
            finding: null,
            resolution: { kind: 'NONE' },
          },
        },
      },
    });
    await handler(corrected.req, corrected.res);

    expect((corrected.captured.body as { error?: unknown }).error).toBeUndefined();
    await run.flushPendingCompletion();
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          workflowNodeId: 'node-readiness-retry',
          pendingTriggerMessageId: 'trigger-readiness-retry',
          action: FEATURE_SYNC_ACTIONS.READINESS_CLEAR,
          payload: {
            disposition: {
              state: 'CLEAR',
              sourceSnapshot,
              finding: null,
              resolution: { kind: 'NONE' },
            },
          },
        }),
      }),
    );
  });

  it('states the concrete readiness resolution when it is omitted and completes once after the corrected retry', async () => {
    const poster = makePoster();
    const reg = submissionToolRegistry.register({
      runId: 'run-readiness-omitted',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-readiness-omitted',
      triggerMessageId: 'trigger-readiness-omitted',
      tools: [submitReadinessTool],
    });
    const run = makeRun(undefined, {
      runId: 'run-readiness-omitted',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      poster,
    });
    vi.spyOn(run, 'normalizeImplementationReadinessForSubmission').mockImplementation(
      (disposition) => disposition,
    );
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });
    const sourceSnapshot = {
      runId: 'run-readiness-omitted',
      focalEntityId: 'task-123',
      focalEntityType: 'TASK',
      sourceRevision: 'sha256:source-1',
      capturedAt: '2026-09-18T20:00:00.000Z',
    };

    const omitted = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 56,
      method: 'tools/call',
      params: {
        name: submitReadinessTool.name,
        arguments: { disposition: { state: 'CLEAR', sourceSnapshot, finding: null } },
      },
    });
    await handler(omitted.req, omitted.res);

    const result = (
      omitted.captured.body as {
        result: {
          content: Array<{ text: string }>;
          structuredContent: {
            findings: Array<{ field: string; reason: string; correction: string }>;
          };
        };
      }
    ).result;
    expect(result.structuredContent.findings).toEqual([
      expect.objectContaining({
        field: '/disposition/resolution',
        code: 'required',
        correction: expect.stringContaining('{ "kind": "NONE" }'),
      }),
    ]);
    const [finding] = result.structuredContent.findings;
    expect(finding!.correction).not.toContain('DISMISSED');
    expect(result.content[0]!.text).toContain(
      `${finding!.field}: ${finding!.reason} ${finding!.correction}`,
    );
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();

    const corrected = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 57,
      method: 'tools/call',
      params: {
        name: submitReadinessTool.name,
        arguments: {
          disposition: {
            state: 'CLEAR',
            sourceSnapshot,
            finding: null,
            resolution: { kind: 'NONE' },
          },
        },
      },
    });
    await handler(corrected.req, corrected.res);

    expect((corrected.captured.body as { error?: unknown }).error).toBeUndefined();
    await run.flushPendingCompletion();
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          pendingTriggerMessageId: 'trigger-readiness-omitted',
          action: FEATURE_SYNC_ACTIONS.READINESS_CLEAR,
        }),
      }),
    );
  });

  it('states allowed enum values and required object shapes from the declared schema', async () => {
    const poster = makePoster();
    const executeSpy = vi.fn();
    const reg = submissionToolRegistry.register({
      runId: 'run-expected-shape',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-expected-shape',
      triggerMessageId: 'trigger-expected-shape',
      tools: [
        {
          ...TOOL,
          inputSchema: {
            type: 'object',
            required: ['mode', 'target'],
            additionalProperties: false,
            properties: {
              mode: { type: 'string', enum: ['FAST', 'SAFE'] },
              target: {
                type: 'object',
                required: ['kind', 'id'],
                properties: { kind: { const: 'TASK' }, id: { type: 'string' } },
              },
            },
          },
          execute: executeSpy,
        },
      ],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger: makeLogger() });
    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 58,
      method: 'tools/call',
      params: { name: TOOL.name, arguments: { mode: 'SLOW' } },
    });
    await handler(req, res);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          status: 'correctable_rejection',
          findings: expect.arrayContaining([
            expect.objectContaining({
              field: '/target',
              code: 'required',
              correction: 'Set /target to { "kind": "TASK", "id": a string }, then retry.',
            }),
            expect.objectContaining({
              field: '/mode',
              code: 'enum',
              correction: 'Set /mode to one of "FAST", "SAFE", then retry.',
            }),
          ]),
        },
      },
    });
  });

  it('returns semantic validation failures to the agent without posting an ERROR completion', async () => {
    const poster = makePoster();
    const recordPendingCompletion = vi.fn();
    const tool: SubmissionToolDeclaration = {
      name: 'submit_semantic_validation',
      description: 'Submit a semantically validated payload.',
      inputSchema: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      execute: () => {
        throw new SubmissionToolCorrectableError({
          reason: 'Submission conflicts with the active phase.',
          findings: [
            {
              identity: 'phase:active',
              code: 'phase_conflict',
              reason: 'value conflicts with the active phase',
              correction: 'Use the active phase value and retry.',
            },
          ],
        });
      },
      hidden: true,
    };
    const reg = submissionToolRegistry.register({
      runId: 'run-semantic-validation',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-semantic-validation',
      triggerMessageId: 'trigger-semantic-validation',
      tools: [tool],
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => makeRun(recordPendingCompletion),
    });
    const call = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 53,
      method: 'tools/call',
      params: { name: tool.name, arguments: { value: 'valid JSON shape' } },
    });

    await handler(call.req, call.res);

    expect(call.captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 53,
      result: {
        isError: true,
        structuredContent: {
          status: 'correctable_rejection',
          reason: 'Submission conflicts with the active phase.',
          findings: [
            {
              identity: 'phase:active',
              code: 'phase_conflict',
              reason: 'value conflicts with the active phase',
              correction: 'Use the active phase value and retry.',
            },
          ],
        },
      },
    });
    expect(recordPendingCompletion).not.toHaveBeenCalled();
    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  // Design doc Step 3: multi-turn flow. The Claude SDK caches the MCP URL
  // (including its token-bearing path) at session start and does not refresh
  // on resume. Turn 1 mints the token; Turn 2 mutates the per-Turn fields
  // via update() while keeping that token stable. A tool call on Turn 2 —
  // which carries Turn 1's cached token — must still resolve, pick up Turn
  // 2's parentMessageId / externalAgentNodeId, and post the completion.
  //
  // Under the broken pre-fix behavior, Turn 2's register() rotated the
  // token, orphaning Turn 1's cached URL and surfacing as "MCP offline."
  it('routes a Turn 2 tool call through the Turn 1 token after update()', async () => {
    const poster = makePoster();
    const setLastSubmissionAction = vi.fn();

    // Turn 1 — register mints the token. The SDK would cache the URL
    // containing reg.token now.
    const reg = submissionToolRegistry.register({
      runId: 'run-multi-turn',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-analyze',
      triggerMessageId: 'trigger-multi-turn-1',
      tools: [TOOL],
    });

    // Turn 2 — the handler swaps submission tools and rebinds the per-Turn
    // fields. Token stays stable; the dictionary entry rotates.
    const updated = submissionToolRegistry.update('run-multi-turn', {
      tools: [TOOL_WITH_PAYLOAD],
      externalAgentNodeId: 'node-analyze-followup',
      triggerMessageId: 'trigger-multi-turn-2',
    });
    expect(updated.token).toBe(reg.token);

    const recordPendingCompletion = vi.fn();
    const run = makeRun(recordPendingCompletion, {
      setLastSubmissionAction,
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });

    // The SDK, using its cached URL with reg.token, calls the Turn 2 tool.
    const discrepancies = [{ summary: 'X', rationale: 'Y' }];
    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'submit_discrepancies', arguments: { discrepancies } },
    });
    await handler(req, res);

    // The call resolved — no MCP-offline 404.
    expect(captured.statusCode).toBe(200);
    expect((captured.body as { error?: unknown }).error).toBeUndefined();

    // It used Turn 2's dictionary entry: new externalAgentNodeId, new
    // triggerMessageId, new tool. The completion is recorded (not posted) with
    // Turn 2's routing identity for the Run to flush at turn-end.
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(recordPendingCompletion).toHaveBeenCalledWith({
      action: { action: 'DISCREPANCY', payload: { discrepancies } },
      externalAgentNodeId: 'node-analyze-followup',
      triggerMessageId: 'trigger-multi-turn-2',
      stamp: null,
    });

    expect(setLastSubmissionAction).toHaveBeenCalledWith({
      action: 'DISCREPANCY',
      payload: { discrepancies },
    });
  });

  it('synthesizes an ERROR completion when an action tool execute() throws, and still surfaces the JSON-RPC error', async () => {
    const poster = makePoster();
    const throwingTool: SubmissionToolDeclaration = {
      name: 'submit_throws',
      description: 'A tool whose execute() always throws.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: () => {
        throw new Error('execute exploded');
      },
    };
    const reg = submissionToolRegistry.register({
      runId: 'run-error-synth',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-error-synth',
      triggerMessageId: 'trigger-error-synth',
      tools: [throwingTool],
    });
    const run = makeRun(undefined, {
      runId: 'run-error-synth',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      poster,
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 200,
      method: 'tools/call',
      params: { name: 'submit_throws', arguments: {} },
    });
    await handler(req, res);

    expect(poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
    await handler(req, res);
    expect(captured.body).toMatchObject({ result: { isError: true } });
    await run.flushPendingCompletion();
    await handler(req, res);
    await run.flushPendingCompletion();

    // The synthesized ERROR completion uses the typed authority boundary,
    // carrying the exception message as the user-facing response and 'ERROR'
    // as the action discriminator. It never falls back to generic creation.
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: run.agentSessionId,
      effectId: expect.any(String),
      request: {
        conversationId: 'conv-1',
        workflowNodeId: 'node-error-synth',
        pendingTriggerMessageId: 'trigger-error-synth',
        action: 'ERROR',
        response: 'execute exploded',
      },
    });

    // A replacement trigger can complete independently after the old turn ends.
    submissionToolRegistry.update(reg.runId, { triggerMessageId: 'replacement-trigger' });
    await handler(req, res);
    expect(captured.body).toMatchObject({ error: { message: 'execute exploded' } });
    await run.flushPendingCompletion();
    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(2);
  });

  it('refuses an action tool on a null-context (non-agent turn) registration with an agent-readable result, posting nothing and logging at info', async () => {
    const poster = makePoster();
    const logger = makeLogger();
    const reg = submissionToolRegistry.register({
      runId: 'run-non-agent',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      // Sanctioned non-agent turn: the atomic pair is fully null.
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [TOOL],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 300,
      method: 'tools/call',
      params: { name: 'submit_no_discrepancy', arguments: {} },
    });
    await handler(req, res);

    // Nothing is posted to the conversation.
    expect(poster.createOutOfBand).not.toHaveBeenCalled();

    // The agent reads a refusal it can act on, marked as a tool error so it
    // never believes a completion was posted.
    const body = captured.body as {
      error?: unknown;
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    };
    expect(body.error).toBeUndefined();
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toMatch(/no workflow node is awaiting a completion/i);

    // The sanctioned case logs at info, not error.
    expect(logger.info).toHaveBeenCalledWith(
      'local.submission_tools.completion_refused_non_agent_turn',
      expect.objectContaining({
        toolName: 'submit_no_discrepancy',
        classification: 'non_agent_turn',
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs at error level when an action tool registration carries a half-populated completion pair', async () => {
    const poster = makePoster();
    const logger = makeLogger();
    const reg = submissionToolRegistry.register({
      runId: 'run-partial-context',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      // Broken atomic-pair invariant: node id present, trigger id null.
      externalAgentNodeId: 'node-partial',
      triggerMessageId: null,
      tools: [TOOL],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 301,
      method: 'tools/call',
      params: { name: 'submit_no_discrepancy', arguments: {} },
    });
    await handler(req, res);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    const body = captured.body as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      'local.submission_tools.completion_context_partial',
      expect.objectContaining({ classification: 'partial_context' }),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'local.submission_tools.completion_refused_non_agent_turn',
      expect.anything(),
    );
  });

  it('returns a tool-surface mismatch JSON-RPC error for unknown tool names', async () => {
    const poster = makePoster();
    const logger = makeLogger();
    const reg = submissionToolRegistry.register({
      runId: 'run-4',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [TOOL],
    });
    const handler = createSubmissionToolsHttpHandler({ poster, logger });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'does_not_exist', arguments: {} },
    });
    await handler(req, res);

    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 6,
      error: {
        code: -32602,
        message: expect.stringContaining('tool-surface mismatch'),
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'local.submission_tools.tool_surface_mismatch',
      expect.objectContaining({
        runId: 'run-4',
        toolName: 'does_not_exist',
        classification: 'tool_surface_mismatch',
        availability: 'absent',
        activeToolSetSource: 'active_run_unavailable',
        mountedToolNames: ['submit_no_discrepancy'],
        activeSubmissionToolNames: [],
      }),
    );
  });

  // ===== Pass-through tool dispatch =======================================
  // Plan step 7(c): the HTTP MCP layer must route a pass-through tool's
  // call to its execute function, return the platform content unchanged,
  // skip postSubmissionAction, and surface execute() failures as JSON-RPC
  // errors.

  const PASS_THROUGH_TOOL: PassThroughSubmissionToolDeclaration = {
    kind: 'pass_through',
    name: 'create_report_wrapped',
    description: 'Pass-through to a platform tool.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: () => ({
      content: [{ type: 'text', text: 'platform response verbatim' }],
    }),
  };

  it('routes a pass-through tool: execute is called with ctx.run, content is returned verbatim, no action posted', async () => {
    const poster = makePoster();
    const executeSpy = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'platform response verbatim' }],
    });
    const run = createTestRun({
      runId: 'run-pass-through',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      organizationId: 'org-1',
    });
    const getRun = vi.fn().mockReturnValue(run);

    const reg = submissionToolRegistry.register({
      runId: 'run-pass-through',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      // Pass-through tools do not require EXTERNAL_AGENT context.
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [{ ...PASS_THROUGH_TOOL, execute: executeSpy }],
    });

    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: { name: 'create_report_wrapped', arguments: { foo: 'bar' } },
    });
    await handler(req, res);

    expect(getRun).toHaveBeenCalledWith('run-pass-through');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith({
      runId: 'run-pass-through',
      args: { foo: 'bar' },
      run,
    });

    // No action posted for pass-through.
    expect(poster.createOutOfBand).not.toHaveBeenCalled();

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 100,
      result: { content: [{ type: 'text', text: 'platform response verbatim' }] },
    });
  });

  it('returns a JSON-RPC error when a pass-through tool execute() throws', async () => {
    const poster = makePoster();
    const executeSpy = vi.fn().mockRejectedValue(new Error('platform 503'));
    const run = createTestRun({
      runId: 'run-pass-through-err',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      organizationId: 'org-1',
    });

    const reg = submissionToolRegistry.register({
      runId: 'run-pass-through-err',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [{ ...PASS_THROUGH_TOOL, execute: executeSpy }],
    });

    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: { name: 'create_report_wrapped', arguments: {} },
    });
    await handler(req, res);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 101,
      error: { code: -32603, message: 'platform 503' },
    });
  });

  it('returns a pass-through admission error to the agent for correction', async () => {
    const poster = makePoster();
    const run = createTestRun({
      runId: 'run-pass-through-correctable',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      organizationId: 'org-1',
    });
    const reg = submissionToolRegistry.register({
      runId: 'run-pass-through-correctable',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [
        {
          ...PASS_THROUGH_TOOL,
          execute: () => {
            throw new SubmissionToolCorrectableError({
              reason: 'Source binding is stale.',
              findings: [
                {
                  field: '/disposition/sourceSnapshot',
                  reason: 'Source binding is stale.',
                  correction: 'Use the active Run binding and retry.',
                },
              ],
            });
          },
        },
      ],
    });
    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });
    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: { name: 'create_report_wrapped', arguments: {} },
    });
    await handler(req, res);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          status: 'correctable_rejection',
          findings: [{ field: '/disposition/sourceSnapshot' }],
        },
      },
    });
  });

  it('returns a JSON-RPC error when pass-through invoked but no Run resolves for runId', async () => {
    const poster = makePoster();

    const reg = submissionToolRegistry.register({
      runId: 'run-missing',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [PASS_THROUGH_TOOL],
    });

    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => null,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: { name: 'create_report_wrapped', arguments: {} },
    });
    await handler(req, res);

    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 102,
      error: { code: -32603 },
    });
  });

  // ===== Handler tool boundary enforcement =================================
  // Each handler can only call tools declared in its own submissionTools.
  // A mounted tool owned by a different handler may be visible to the SDK,
  // but calling one while a
  // different handler is active returns an agent-readable isError result
  // without invoking execute().

  it("allows a base submission tool call even when it is not in the active handler's submissionTools", async () => {
    const poster = makePoster();
    const executeSpy = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    const BASE_TOOL: SubmissionToolDeclaration = {
      kind: 'pass_through',
      name: 'create_report',
      description: 'Universal create_report wrapper.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: executeSpy,
    } as unknown as SubmissionToolDeclaration;

    const HANDLER_TOOL: SubmissionToolDeclaration = {
      name: 'submit_no_discrepancy',
      description: 'Handler completion tool.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    };

    const reg = submissionToolRegistry.register({
      runId: 'run-base-tool',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [BASE_TOOL, HANDLER_TOOL],
    });

    // Active handler only declares the handler tool, not the base tool.
    const run = makeRun(vi.fn(), {
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      activeHandler: {
        promptType: LocalPromptType.FeatureSyncAnalyze,
        submissionTools: [HANDLER_TOOL],
      },
      isBaseSubmissionTool: (name: string) => name === 'create_report',
    });

    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger: makeLogger(),
      getRun: () => run,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 450,
      method: 'tools/call',
      params: { name: 'create_report', arguments: {} },
    });
    await handler(req, res);

    // execute IS reached — base tools bypass the handler boundary check.
    expect(executeSpy).toHaveBeenCalledTimes(1);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      result?: { isError?: boolean };
    };
    expect(body.result?.isError).toBeUndefined();
  });

  it('classifies a mounted but inactive handler tool call as a tool-surface mismatch with an agent-readable result', async () => {
    const poster = makePoster();
    const logger = makeLogger();
    const executeSpy = vi.fn();

    const ANALYZE_TOOL: SubmissionToolDeclaration = {
      name: 'submit_discrepancies',
      description: 'Analyze completion tool.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    };
    const ITERATE_TOOL: SubmissionToolDeclaration = {
      name: 'submit_revised',
      description: 'Iterate completion tool.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: executeSpy,
    };

    // Both tools are in registration.tools (seeded at mint for the session).
    const reg = submissionToolRegistry.register({
      runId: 'run-boundary',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-boundary',
      triggerMessageId: 'trigger-boundary',
      tools: [ANALYZE_TOOL, ITERATE_TOOL],
    });

    // Active handler is analyze — only owns submit_discrepancies.
    const run = makeRun(vi.fn(), {
      activeHandler: {
        promptType: LocalPromptType.PlanShapingFeatureSyncAnalyze,
        submissionTools: [ANALYZE_TOOL],
      },
    });

    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger,
      getRun: () => run,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 400,
      method: 'tools/call',
      params: { name: 'submit_revised', arguments: {} },
    });
    await handler(req, res);

    // execute is never reached.
    expect(executeSpy).not.toHaveBeenCalled();
    expect(poster.createOutOfBand).not.toHaveBeenCalled();

    // HTTP 200 with an isError result, not a JSON-RPC error.
    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      error?: unknown;
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    };
    expect(body.error).toBeUndefined();
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain('submit_revised');
    expect(body.result?.content?.[0]?.text).toContain('plan_shaping_feature_sync_analyze');
    expect(body.result?.content?.[0]?.text).toContain('not a user rejection');
    expect(logger.warn).toHaveBeenCalledWith(
      'local.submission_tools.tool_surface_mismatch',
      expect.objectContaining({
        runId: 'run-boundary',
        toolName: 'submit_revised',
        classification: 'tool_surface_mismatch',
        availability: 'mounted_but_inactive',
        activeHandlerPromptType: 'plan_shaping_feature_sync_analyze',
        activeToolSetSource: 'active_turn_handler_submissionTools',
        mountedToolNames: ['submit_discrepancies', 'submit_revised'],
        activeSubmissionToolNames: ['submit_discrepancies'],
      }),
    );
  });

  it('rejects Proposal inclusion when a non-visual handler is active', async () => {
    const poster = makePoster();
    const logger = makeLogger();
    const includeExistingProposalsTool = new IncludeExistingProposalsInCurrentMessageTool();
    const reg = submissionToolRegistry.register({
      runId: 'run-proposal-inclusion-boundary',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [includeExistingProposalsTool],
    });
    const run = makeRun(vi.fn(), {
      activeHandler: {
        promptType: LocalPromptType.PlanShapingFinalize,
        submissionTools: [TOOL],
      },
    });
    const includeSpy = vi.spyOn(run.activeTurn!, 'includeExistingProposals');

    const handler = createSubmissionToolsHttpHandler({
      poster,
      logger,
      getRun: () => run,
    });

    const { req, res, captured } = makeReqRes(reg.token, {
      jsonrpc: '2.0',
      id: 401,
      method: 'tools/call',
      params: {
        name: 'include_existing_proposals_in_current_message',
        arguments: { proposalIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'] },
      },
    });
    await handler(req, res);

    expect(includeSpy).not.toHaveBeenCalled();
    expect(captured.body).toMatchObject({
      jsonrpc: '2.0',
      id: 401,
      result: {
        isError: true,
        content: [{ type: 'text' }],
      },
    });
    expect(
      (captured.body as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]
        ?.text,
    ).toContain('include_existing_proposals_in_current_message');
    expect(logger.warn).toHaveBeenCalledWith(
      'local.submission_tools.tool_surface_mismatch',
      expect.objectContaining({
        runId: 'run-proposal-inclusion-boundary',
        availability: 'mounted_but_inactive',
        activeHandlerPromptType: 'plan_shaping_finalize',
      }),
    );
  });
});
