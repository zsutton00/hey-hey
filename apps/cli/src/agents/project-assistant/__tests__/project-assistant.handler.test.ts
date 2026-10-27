import os from 'node:os';
import path from 'node:path';
import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { TasksApi } from '../../../shared/api/generated';
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
} from '../../../shared/agent-bridge-contract/generated/api';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';
import type * as ContextGathering from '../context-gathering';
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
    preparationRecords: {},
    fetchImpl,
    auth: { getAccessToken: vi.fn().mockResolvedValue('token-1') },
    apiBaseUrl: 'http://platform.test',
    logger,
    taskMonitorDecisionStore: { bind: vi.fn() },
  }) as unknown as PromptTypeHandlerDeps;

describe('projectAssistantHandler — read-only by construction', () => {
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
      'edit_tasks',
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

  describe('Jev-filtered parent feature load setting', () => {
    const mockParentRead = () =>
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
                  materializedMarkdown: 'Full parent description.',
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
    const makeFilter = (enabled: boolean) => ({
      jevClient: { evaluate: vi.fn() },
      entityContextLoader: { load: vi.fn().mockRejectedValue(new Error('requirements read')) },
      isEnabled: vi.fn().mockResolvedValue(enabled),
      attemptLogDir: path.join(os.tmpdir(), 'jev-attempt-log-test'),
    });

    it('loads the parent in full without consulting Jev when the setting is off', async () => {
      const read = mockParentRead();
      const filter = makeFilter(false);
      const filtered = new ProjectAssistantHandler(makeCreateReportProxy(), null, filter);

      const prepared = await filtered.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch),
        loadedCtx,
      );

      expect(filter.isEnabled).toHaveBeenCalledTimes(1);
      expect(filter.entityContextLoader.load).not.toHaveBeenCalled();
      expect(filter.jevClient.evaluate).not.toHaveBeenCalled();
      expect(filtered.buildPrompt(prepared.payload, loadedCtx)).toContain('], in full.');
      read.mockRestore();
    });

    it('reads the setting on every prepare and filters when it is on', async () => {
      const read = mockParentRead();
      const filter = makeFilter(true);
      const filtered = new ProjectAssistantHandler(makeCreateReportProxy(), null, filter);

      await filtered.prepare!(makeRun(), makePayload(), makeDeps(reportsOnlyFetch), loadedCtx);
      filter.isEnabled.mockResolvedValue(false);
      await filtered.prepare!(makeRun(), makePayload(), makeDeps(reportsOnlyFetch), loadedCtx);

      expect(filter.isEnabled).toHaveBeenCalledTimes(2);
      expect(filter.entityContextLoader.load).toHaveBeenCalledTimes(1);
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

    it('logs a Feature focal as an expected unfiltered load, not a warning', async () => {
      const read = mockParentRead();
      const filter = makeFilter(true);
      const filtered = new ProjectAssistantHandler(makeCreateReportProxy(), null, filter);
      const featureCtx = {
        loadedEntityContext: {
          ...loadedCtx.loadedEntityContext,
          entity: { id: 'task-1', name: 'Focal', type: 'FEATURE', sections: [] },
        },
      } as unknown as PromptTypeHandlerContext;
      const logger = makeLogger();

      await filtered.prepare!(
        makeRun(),
        makePayload(),
        makeDeps(reportsOnlyFetch, logger),
        featureCtx,
      );

      expect(logger.warn).not.toHaveBeenCalledWith(
        'project_assistant.prepare.parent_feature.filter_failed',
        expect.anything(),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'project_assistant.prepare.parent_feature.filter_failed',
        expect.objectContaining({ reason: 'focal_not_a_task', focalType: 'FEATURE' }),
      );
      read.mockRestore();
    });

    describe('gathered context', () => {
      const gathering = {} as ContextGathering.ContextGatheringDeps;
      const turnCtx = (overrides: Partial<PromptTypeHandlerContext> = {}) =>
        ({
          ...loadedCtx,
          turnId: 'turn-1',
          abortSignal: () => new AbortController().signal,
          ...overrides,
        }) as PromptTypeHandlerContext;

      it('puts the gathered entities in the first prompt and mounts no search tool', async () => {
        const read = mockParentRead();
        const gather = vi
          .spyOn(await import('../context-gathering'), 'gatherProjectContext')
          .mockResolvedValue('## Gathered context\n\ntask kept-1\n\nKept body');
        const withJev = new ProjectAssistantHandler(
          makeCreateReportProxy(),
          null,
          undefined,
          gathering,
        );

        const ctx = turnCtx();
        const prepared = await withJev.prepare!(
          makeRun(),
          makePayload(),
          makeDeps(reportsOnlyFetch),
          ctx,
        );

        expect(gather).toHaveBeenCalledWith(
          expect.objectContaining({
            deps: gathering,
            runId: 'run-1',
            turnId: 'turn-1',
            project: { organizationId: 'org-1', projectId: 'proj-1' },
            focalRef: { id: 'task-1', kind: 'task' },
            ask: 'please start',
            promptContext: expect.stringContaining('Project Assistant session'),
          }),
        );
        expect(withJev.buildPrompt(prepared.payload, ctx)).toContain('Kept body');
        expect(withJev.submissionTools.map(({ name }) => name)).not.toContain(
          'submit_context_searches',
        );
        gather.mockRestore();
        read.mockRestore();
      });

      it('fails prepare with the gathering error and does not fall back', async () => {
        const read = mockParentRead();
        const gather = vi
          .spyOn(await import('../context-gathering'), 'gatherProjectContext')
          .mockRejectedValue(new Error('planning failed'));
        const withJev = new ProjectAssistantHandler(
          makeCreateReportProxy(),
          null,
          undefined,
          gathering,
        );

        await expect(
          withJev.prepare!(makeRun(), makePayload(), makeDeps(reportsOnlyFetch), turnCtx()),
        ).rejects.toThrow('planning failed');
        gather.mockRestore();
        read.mockRestore();
      });

      it('leaves prompt and tools unchanged without a Jev key', async () => {
        const read = mockParentRead();
        const gather = vi.spyOn(await import('../context-gathering'), 'gatherProjectContext');
        const without = new ProjectAssistantHandler(makeCreateReportProxy(), null);

        const prepared = await without.prepare!(
          makeRun(),
          makePayload(),
          makeDeps(reportsOnlyFetch),
          turnCtx(),
        );

        expect(gather).not.toHaveBeenCalled();
        expect(prepared.payload).not.toHaveProperty('_gatheredContext');
        expect(without.buildPrompt(prepared.payload, loadedCtx)).not.toContain('Gathered context');
        gather.mockRestore();
        read.mockRestore();
      });

      it('gathers for a planned task with no parent feature', async () => {
        const read = vi
          .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
          .mockResolvedValue({
            data: {
              success: true,
              message: 'ok',
              data: { id: 'plan-1', name: 'Eval rollout', type: 'PLAN', sections: [] },
            },
          } as never);
        const gather = vi
          .spyOn(await import('../context-gathering'), 'gatherProjectContext')
          .mockResolvedValue('## Gathered context');
        const logger = makeLogger();
        const withJev = new ProjectAssistantHandler(
          makeCreateReportProxy(),
          null,
          undefined,
          gathering,
        );
        const planned = {
          ...loadedCtx.loadedEntityContext,
          context: { entityId: 'task-1', planContext: { parentPlan: { id: 'plan-1' } } },
        };

        await withJev.prepare!(makeRun(), makePayload(), makeDeps(reportsOnlyFetch, logger), {
          ...turnCtx(),
          loadedEntityContext: planned,
        } as PromptTypeHandlerContext);

        expect(gather).toHaveBeenCalledWith(
          expect.objectContaining({
            focal: expect.objectContaining({
              parent: { kind: 'plan', name: 'Eval rollout', description: '' },
            }),
          }),
        );
        expect(logger.warn).not.toHaveBeenCalledWith(
          'project_assistant.prepare.context_gathering_skipped',
          expect.anything(),
        );
        gather.mockRestore();
        read.mockRestore();
      });

      it('skips gathering when no focal is resolved', async () => {
        const read = mockParentRead();
        const gather = vi.spyOn(await import('../context-gathering'), 'gatherProjectContext');
        const withJev = new ProjectAssistantHandler(
          makeCreateReportProxy(),
          null,
          undefined,
          gathering,
        );

        const prepared = await withJev.prepare!(
          makeRun(),
          { ...makePayload(), userMessage: '' },
          makeDeps(reportsOnlyFetch),
          { turnId: 'turn-1', abortSignal: () => undefined } as PromptTypeHandlerContext,
        );

        expect(gather).not.toHaveBeenCalled();
        expect(prepared.payload).not.toHaveProperty('_gatheredContext');
        gather.mockRestore();
        read.mockRestore();
      });
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
