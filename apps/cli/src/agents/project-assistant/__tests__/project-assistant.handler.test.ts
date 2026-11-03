import os from 'node:os';
import path from 'node:path';
import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { TasksApi } from '@hey-hey/contracts/api';
import { ProjectAssistantPreparationError } from '../nearest-parent-feature';
import {
  ProjectAssistantHandler,
  type ProjectAssistantPromptPayload,
} from '../project-assistant.handler';
import type { AgenticSession } from '../../../session/types';
import type { PromptTypeHandlerContext, PromptTypeHandlerDeps } from '../../prompt-type-handler';
import type { LocalResearchPromptPayload } from '../../../shared/agent-bridge-contract/index';
import {
  RunEntityReferenceEntityTypeEnum,
  LocalPromptTaskType,
  LocalPromptType,
} from '@hey-hey/contracts/agent-bridge';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';
import type { JevInput, JevResult } from '../../../jev/client';
import { createTestSessionRunnerFacade } from '../../../run/run.test-support';

const handler = new ProjectAssistantHandler(makeCreateReportProxy());

const makeLogger = (): PromptTypeHandlerDeps['logger'] =>
  ({
    info: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as PromptTypeHandlerDeps['logger'];

const makeRun = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    entity: { entityType: 'TASK', entityId: 'task-1' },
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'idle',
    serviceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      capturedAt: '2026-06-30T12:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'run-1',
      launchPlanId: 'plan-1',
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
      task: {
        id: 'task-1',
        name: 'Task one',
        type: 'STANDARD',
        sections: [],
      },
    },
    events: [],
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  }) as AgenticSession;

const makePayload = (
  workItemProposalMode: 'none' | 'create' | 'edit' | 'all' = 'all',
  policyOverrides: Partial<ProjectAssistantPromptPayload['projectAssistantHandoff']['policy']> = {},
): ProjectAssistantPromptPayload =>
  ({
    promptType: LocalPromptType.Research,
    entity: {
      entityType: RunEntityReferenceEntityTypeEnum.Task,
      entityId: 'task-1',
    },
    startupInput: {
      focalEntity: {
        entityType: RunEntityReferenceEntityTypeEnum.Task,

        entityId: 'task-1',
      },
      task: {
        id: 'task-1',
        title: 'Task one',
        taskType: LocalPromptTaskType.Standard,
        description: 'Do work.',
      },
      adjacentScopeTasks: [],
      evidenceItems: [],
    },
    userMessage: 'please start',
    projectAssistantHandoff: {
      consumerHandlerId: 'free_form',
      policy: {
        allowEdgeUpdates: false,
        notifyDiscrepancies: false,
        workItemProposalMode,
        ...policyOverrides,
      },
    },
  }) as ProjectAssistantPromptPayload;

const makeInput = () => ({
  promptType: LocalPromptType.ProjectAssistant,
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
});

const jsonResponse = (body: object, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makeDeps = (
  fetchImpl: typeof fetch,
  logger: PromptTypeHandlerDeps['logger'] = makeLogger(),
): PromptTypeHandlerDeps =>
  ({
    fetchImpl,
    auth: { getAccessToken: vi.fn().mockResolvedValue('token-1') },
    apiBaseUrl: 'http://platform.test',
    logger,
    taskMonitorDecisionStore: { bind: vi.fn() },
  }) as unknown as PromptTypeHandlerDeps;

/** Network-boundary Jev: every candidate gets the same relevance, or the whole call fails. */
const jevJudging = (relevance: number | 'fail') =>
  vi.fn(async (input: JevInput): Promise<JevResult> => {
    if (relevance === 'fail') {
      return { ok: false, failure: { code: 'PROVIDER_ERROR', message: 'jev down' } };
    }
    const answers: Extract<JevResult, { ok: true }>['answers'] = {};
    for (const [id, question] of Object.entries(input.questions)) {
      answers[id] =
        question.type === 'noul'
          ? { type: 'noul', noul: 0 }
          : {
              type: 'choice',
              choice: 'implements',
              confidence: 1,
              probabilities: {
                implements: relevance,
                informs: 0,
                same_feature_unrelated: 1 - relevance,
                other: 0,
              },
            };
    }
    return {
      ok: true,
      answers,
      model: input.model,
      usage: { inputTokens: 10, outputTokens: 10 },
      durationMs: 1,
    };
  });

describe('projectAssistantHandler — read-only by construction', () => {
  it('excludes shared uncertainty reporting while preserving its own research tools', () => {
    expect(handler.excludedBaseSubmissionTools).toContain('raise_uncertainty');
    expect(handler.submissionTools.map((tool) => tool.name)).toContain('create_coding_research');
  });

  it('runs under the research MCP use case (no mutation/edge/proposal tools in the base)', () => {
    expect(handler.mcpToolUseCase).toBe('research');
  });

  it('declares an empty builtinTools list so the agent has no file-reading surface', () => {
    expect(handler.builtinTools).toEqual([]);
  });

  it('uses the read-only reviewer policy only for its isolated research turn', () => {
    expect(handler.readOnlyFilesystem).toBe(true);
    expect(handler.providerSessionLifetime).toBe('turn');
  });

  it('does not contribute any platform mutation tool via additionalAllowedTools', () => {
    const extras = handler.additionalAllowedTools ?? [];
    const forbidden = [
      'create_work_item',
      'edit_work_item',
      'create_edge',
      'delete_edge',
      'update_edge',
      'update_proposal',
      'create_report',
      'create_implementation_hint',
      'edit_implementation_hint',
      'delete_implementation_hint',
    ];
    for (const tool of forbidden) {
      expect(extras).not.toContain(tool);
    }
  });

  it('allows the read-only report schema lookup required before CODING_RESEARCH submission', () => {
    expect(handler.additionalAllowedTools).toContain('get_report_schema');
  });

  it('allows the read-only single-session lookup required for source conversation continuity', () => {
    expect(handler.additionalAllowedTools).toContain('get_agent_session');
  });

  it('maps all mode to guidance plus both work-item operations', () => {
    expect(
      handler.resolveAdditionalAllowedTools?.({
        session: makeRun(),
        input: makeInput(),
        payload: makePayload(),
      }),
    ).toEqual(['get_tool_guidance', 'create_work_item', 'edit_work_item']);
  });

  it('maps create mode to guidance plus create_work_item only', () => {
    expect(
      handler.resolveAdditionalAllowedTools?.({
        session: makeRun(),
        input: makeInput(),
        payload: makePayload('create'),
      }),
    ).toEqual(['get_tool_guidance', 'create_work_item']);
  });

  it('maps edit mode to guidance plus edit_work_item only', () => {
    expect(
      handler.resolveAdditionalAllowedTools?.({
        session: makeRun(),
        input: makeInput(),
        payload: makePayload('edit'),
      }),
    ).toEqual(['get_tool_guidance', 'edit_work_item']);
  });

  it('maps none mode to no work-item guidance or proposal operations', () => {
    expect(
      handler.resolveAdditionalAllowedTools?.({
        session: makeRun(),
        input: makeInput(),
        payload: makePayload('none'),
      }),
    ).toEqual([]);
  });

  it('keeps edge authority independent from work-item proposal mode', () => {
    expect(
      handler.resolveAdditionalAllowedTools?.({
        session: makeRun(),
        input: makeInput(),
        payload: makePayload('none', { allowEdgeUpdates: true }),
      }),
    ).toEqual(['create_edge', 'delete_edge']);
  });

  it('does not expose mutation tools for discrepancy notices alone', () => {
    expect(
      handler.resolveAdditionalAllowedTools?.({
        session: makeRun(),
        input: makeInput(),
        payload: makePayload('none', { notifyDiscrepancies: true }),
      }),
    ).toEqual([]);
  });

  it('forwards builtinTools: [] through new-session runner wiring', async () => {
    const runPrompt = vi.fn().mockResolvedValue({
      providerSessionId: 'p-1',
      providerConversationId: null,
      errorCount: 0,
    });

    const { NewSessionRunner } = await import('../../../run/runners/new-session-runner');
    const ctx = {
      run: {
        session: { agentic_session_id: 'sess-1' },
        refreshSessionFields: vi.fn(),
        setHasProviderSession: vi.fn(),
      },
      handler,
      resolvedPrompt: 'prompt',
      input: { payload: makePayload() },
      effectiveModel: null,
      effectiveReasoningEffort: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const sessionRunnerFacade = createTestSessionRunnerFacade();
    vi.mocked(sessionRunnerFacade.runPrompt).mockImplementation(runPrompt);
    const runner = new NewSessionRunner(ctx, {
      sessionRunnerFacade,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    await runner.run(new AbortController().signal);

    expect(runPrompt).toHaveBeenCalledTimes(1);
    const args = runPrompt.mock.calls[0]![1];
    expect(args.builtinTools).toEqual([]);
    expect(args.readOnlyFilesystem).toBe(true);
    expect(args.mcpToolUseCase).toBe('research');
  });
});

describe('projectAssistantHandler — recent report startup context', () => {
  it('does not reconstruct or replace the startup task projection', async () => {
    const payload = makePayload();
    const startupInput = payload.startupInput;
    if (!startupInput) throw new Error('Expected the compatibility startupInput fixture.');
    startupInput.task.id = 'stale-task';

    const prepared = await handler.prepare!(
      makeRun(),
      payload,
      makeDeps(vi.fn(async () => jsonResponse({ data: [] })) as typeof fetch),
    );

    expect(prepared.payload.startupInput).toBe(payload.startupInput);
  });

  it('fails closed when the persisted Run entity is missing', async () => {
    await expect(
      handler.prepare!(
        makeRun({ entity: null }),
        makePayload(),
        makeDeps(vi.fn() as unknown as typeof fetch),
      ),
    ).rejects.toThrow(/requires a persisted Run entity/i);
  });

  it('loads task and launch-plan reports during prepare and renders the prior report block', async () => {
    const seenReportEntityIds: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (
        url.pathname.includes('/context') &&
        url.searchParams.get('includeProposals') !== 'true'
      ) {
        return jsonResponse({ data: { entityId: 'task-1', entityType: 'TASK' } });
      }
      if (url.pathname === '/organizations/org-1/reports') {
        const entityId = url.searchParams.get('entityId') ?? '';
        seenReportEntityIds.push(entityId);
        return jsonResponse({
          data:
            entityId === 'task-1'
              ? [
                  {
                    id: 'report-1',
                    reportType: 'CODING_RESEARCH',
                    createdAt: '2026-06-30T09:00:00.000Z',
                    payload: {
                      reportType: 'CODING_RESEARCH',
                      summary: 'Prior summary.',
                      analysis: 'Prior analysis.',
                      frame: { focalId: 'task-1', nodes: [] },
                      provenance: { discoveryCalls: [], edgesTraversed: [] },
                    },
                    entities: [{ entityType: 'TASK', entityId: 'task-1' }],
                    linkedEntities: [{ entityType: 'PLAN', entityId: 'plan-1' }],
                  },
                ]
              : [],
        });
      }
      if (url.pathname.includes('/context')) {
        return jsonResponse({ data: { createdAt: '2026-06-01T00:00:00.000Z', proposals: [] } });
      }
      if (url.pathname.endsWith('/agent-edges')) {
        return jsonResponse({ content: [] });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const prepared = await handler.prepare!(makeRun(), makePayload(), makeDeps(fetchImpl));
    const prompt = handler.buildPrompt(prepared.payload);

    expect(seenReportEntityIds).toEqual(['task-1', 'plan-1']);
    expect(prompt).toContain('## Recent Project Assistant report');
    expect(prompt).toContain('created 3 hours ago');
    expect(prompt).toContain('Prior summary.');
    expect(prompt).toContain('Prior analysis.');
  });

  it('builds the Project Assistant prompt normally when no recent report exists', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (
        url.pathname.includes('/context') &&
        url.searchParams.get('includeProposals') !== 'true'
      ) {
        return jsonResponse({ data: { entityId: 'task-1', entityType: 'TASK' } });
      }
      if (url.pathname === '/organizations/org-1/reports') {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const prepared = await handler.prepare!(makeRun(), makePayload(), makeDeps(fetchImpl));
    const prompt = handler.buildPrompt(prepared.payload);

    expect(prompt).toContain('You are running a Project Assistant session');
    expect(prompt).not.toContain('## Pre-fetched get_context for the session task');
    expect(prompt).not.toContain('## Recent Project Assistant report');
  });

  const parentFeatureCtx = {
    loadedEntityContext: {
      kind: 'entity',
      context: {
        entityId: 'task-1',
        featureHierarchy: [
          {
            id: 'feature-2',
            name: 'Grandparent',
            relationshipType: 'structural',
            relationship: 'ancestor',
            distance: 2,
          },
          {
            id: 'feature-1',
            name: 'Parent feature',
            relationshipType: 'structural',
            relationship: 'ancestor',
            distance: 1,
          },
        ],
      },
    },
  } as unknown as PromptTypeHandlerContext;

  const reportsOnlyFetch = vi.fn(async (input: RequestInfo | URL) =>
    new URL(String(input)).pathname === '/organizations/org-1/reports'
      ? jsonResponse({ data: [] })
      : jsonResponse({}, 404),
  ) as typeof fetch;

  it('reads the nearest parent feature in full through the generated Tasks client', async () => {
    const read = vi
      .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
      .mockResolvedValue({
        data: {
          success: true,
          message: 'ok',
          data: {
            id: 'feature-1',
            name: 'Parent feature',
            type: 'FEATURE',
            sections: [
              {
                id: 's2',
                key: 'requirements',
                order: 1,
                materializedMarkdown: '- Must read the parent.',
                materializedProposalId: 'p',
              },
              {
                id: 's1',
                key: 'description',
                order: 0,
                materializedMarkdown: 'Full parent description.',
                materializedProposalId: 'p',
              },
            ],
          },
        },
      } as unknown as Awaited<
        ReturnType<TasksApi['organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet']>
      >);

    const prepared = await handler.prepare!(
      makeRun(),
      makePayload(),
      makeDeps(reportsOnlyFetch),
      parentFeatureCtx,
    );
    const prompt = handler.buildPrompt(prepared.payload, parentFeatureCtx);

    expect(read).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      taskId: 'feature-1',
    });
    expect(prompt).toContain(
      '## Nearest parent feature\n\n@[feature:feature-1|Parent feature], in full.\n\n### description\n\nFull parent description.\n\n### requirements\n\n- Must read the parent.',
    );
    expect(prompt).toContain('its nearest parent feature in full; carry that feature');
    read.mockRestore();
  });

  describe('Jev setting', () => {
    const mockParentRead = (description = 'Full parent description.') =>
      vi
        .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
        .mockResolvedValue({
          data: {
            success: true,
            message: 'ok',
            data: {
              id: 'feature-1',
              name: 'Parent feature',
              type: 'FEATURE',
              sections: [
                {
                  id: 's1',
                  key: 'description',
                  order: 0,
                  materializedMarkdown: description,
                  materializedProposalId: 'p',
                },
                {
                  id: 's2',
                  key: 'requirements',
                  order: 1,
                  materializedMarkdown: '- Must read the parent.',
                  materializedProposalId: 'p',
                },
              ],
            },
          },
        } as unknown as Awaited<
          ReturnType<TasksApi['organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet']>
        >);
    const loadedCtx = {
      loadedEntityContext: {
        ...parentFeatureCtx.loadedEntityContext,
        focalEntity: { entityType: 'TASK', entityId: 'task-1' },
        entity: { id: 'task-1', name: 'Focal', type: 'STANDARD', sections: [] },
      },
    } as unknown as PromptTypeHandlerContext;
    const requirementRecords = [
      { id: 'r1', statement: 'Keep the key local. Never send it anywhere.', fulfilledBy: [] },
      { id: 'r2', statement: 'Export reports as PDF. Include charts.', fulfilledBy: [] },
    ];
    const makeFilter = (
      evaluate: ReturnType<typeof jevJudging>,
      load = vi.fn().mockResolvedValue({
        context: { content: { requirementsSection: { records: requirementRecords } } },
      }),
    ) => ({
      jevClient: { evaluate },
      entityContextLoader: { load },
      attemptLogDir: path.join(os.tmpdir(), 'jev-attempt-log-test'),
    });
    const withFilter = (
      filter: ReturnType<typeof makeFilter>,
      isJevEnabled: () => Promise<boolean>,
    ) => new ProjectAssistantHandler(makeCreateReportProxy(), null, filter, isJevEnabled);

    it('loads the parent in full without consulting Jev when the setting is off', async () => {
      const read = mockParentRead();
      const filter = makeFilter(jevJudging(0.95));
      const isJevEnabled = vi.fn().mockResolvedValue(false);
      const filtered = withFilter(filter, isJevEnabled);

      const prepared = await filtered.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch),
        loadedCtx,
      );

      expect(isJevEnabled).toHaveBeenCalledTimes(1);
      expect(filter.entityContextLoader.load).not.toHaveBeenCalled();
      expect(filter.jevClient.evaluate).not.toHaveBeenCalled();
      expect(filtered.buildPrompt(prepared.payload, loadedCtx)).toContain('], in full.');
      read.mockRestore();
    });

    it('filters the parent requirements when the setting is on, and only then', async () => {
      const read = mockParentRead();
      const filter = makeFilter(jevJudging(0.95));
      const isJevEnabled = vi.fn().mockResolvedValue(true);
      const filtered = withFilter(filter, isJevEnabled);

      const on = await filtered.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch),
        loadedCtx,
      );
      isJevEnabled.mockResolvedValue(false);
      const off = await filtered.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch),
        loadedCtx,
      );

      expect(isJevEnabled).toHaveBeenCalledTimes(2);
      expect(filter.jevClient.evaluate).toHaveBeenCalledTimes(1);
      expect(filtered.buildPrompt(on.payload, loadedCtx)).toContain(
        'only the requirements judged relevant to this work in full',
      );
      expect(filtered.buildPrompt(off.payload, loadedCtx)).toContain('], in full.');
      read.mockRestore();
    });

    it('makes no Jev request other than the parent filter and adds nothing to the starting input', async () => {
      const read = mockParentRead();
      const filter = makeFilter(jevJudging(0.95));
      const filtered = withFilter(filter, () => Promise.resolve(true));

      const prepared = await filtered.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch),
        loadedCtx,
      );

      expect(Object.keys(prepared)).toEqual(['payload']);
      expect(prepared.payload).not.toHaveProperty('_gatheredContext');
      expect(filtered.buildPrompt(prepared.payload, loadedCtx)).not.toContain('Gathered context');
      expect(filter.jevClient.evaluate).toHaveBeenCalledTimes(1);
      read.mockRestore();
    });

    it('loads the parent in full and carries on when Jev fails', async () => {
      const read = mockParentRead();
      const filtered = withFilter(makeFilter(jevJudging('fail')), () => Promise.resolve(true));

      const prepared = await filtered.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch),
        loadedCtx,
      );

      expect(filtered.buildPrompt(prepared.payload, loadedCtx)).toContain('], in full.');
      read.mockRestore();
    });

    it('loads the parent in full without a Jev key', async () => {
      const read = mockParentRead();
      const prepared = await handler.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch),
        loadedCtx,
      );
      expect(handler.buildPrompt(prepared.payload, loadedCtx)).toContain('], in full.');
      read.mockRestore();
    });
  });

  it('fails prepare with the HTTP status and path when the parent feature cannot be read', async () => {
    const read = vi
      .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
      .mockRejectedValue(
        new AxiosError(
          'Request failed',
          'ERR_BAD_REQUEST',
          { url: '/work-items/feature-1' } as never,
          null,
          {
            status: 404,
            data: 'Cannot GET',
          } as never,
        ),
      );

    const failure = handler.prepare!(
      makeRun(),
      makePayload(),
      makeDeps(reportsOnlyFetch),
      parentFeatureCtx,
    );
    await expect(failure).rejects.toBeInstanceOf(ProjectAssistantPreparationError);
    await expect(failure).rejects.toThrow(
      'could not read parent feature feature-1: HTTP 404 from /work-items/feature-1',
    );
    read.mockRestore();
  });

  it('fails prepare when the parent read returns something other than that feature', async () => {
    const read = vi
      .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
      .mockResolvedValue({
        data: {
          success: true,
          message: 'ok',
          data: { id: 'feature-1', name: 'X', type: 'STANDARD', sections: [] },
        },
      } as unknown as Awaited<
        ReturnType<TasksApi['organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet']>
      >);

    await expect(
      handler.prepare!(makeRun(), makePayload(), makeDeps(reportsOnlyFetch), parentFeatureCtx),
    ).rejects.toThrow('malformed parent feature feature-1');
    read.mockRestore();
  });

  it('uses Run-owned worktree paths in the preflight Services context', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (
        url.pathname.includes('/context') &&
        url.searchParams.get('includeProposals') !== 'true'
      ) {
        return jsonResponse({ data: { entityId: 'task-1', entityType: 'TASK' } });
      }
      if (url.pathname === '/organizations/org-1/reports') {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;
    const prepared = await handler.prepare!(
      makeRun({
        services: [
          { id: 'service-a', path: '/host/service-a' },
          { id: 'service-b', path: '/host/service-b' },
        ],
        launchServiceId: 'service-b',
        worktreeState: {
          'service-a': {
            repoPath: '/host/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/worktrees',
          },
          'service-b': {
            repoPath: '/host/service-b',
            worktreePath: '/worktrees/service-b',
            branch: 'feature/worktrees',
          },
        },
      }),
      makePayload(),
      makeDeps(fetchImpl),
    );

    const prompt = handler.buildPrompt(prepared.payload);
    expect(prompt).toContain('Launch service `service-b` at `/worktrees/service-b`');
    expect(prompt).toContain('`service-a` at `/worktrees/service-a`');
    expect(prompt).not.toContain('/host/service-a');
    expect(prompt).not.toContain('/host/service-b');
  });

  it('mounts run_subagents and its prompt section together, or neither', () => {
    const payload = makePayload() as ProjectAssistantPromptPayload;
    const on = new ProjectAssistantHandler(makeCreateReportProxy());
    const off = new ProjectAssistantHandler(makeCreateReportProxy(), null);

    expect(on.submissionTools.map((tool) => tool.name)).toContain('run_subagents');
    expect(on.buildPrompt(payload)).toContain('## Parallel research subagents');
    expect(off.submissionTools.map((tool) => tool.name)).not.toContain('run_subagents');
    expect(off.buildPrompt(payload)).not.toContain('run_subagents');
  });
});
