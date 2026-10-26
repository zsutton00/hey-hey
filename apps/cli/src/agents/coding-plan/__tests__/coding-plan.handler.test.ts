import { describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../../session/types';
import {
  LocalPromptType,
  type LocalPromptStartupInput,
  type LocalStartupSessionPromptPayload,
} from '../../../shared/agent-bridge-contract/generated/api';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import type { PromptTypeHandlerContext, PromptTypeHandlerDeps } from '../../prompt-type-handler';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../../prompt-type-handler.test-support';
import {
  CODING_PLAN_SUBAGENT_BUILTIN_ALLOWED_TOOLS,
  CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS,
  codingPlanHandler,
  type EnrichedCodingPlanPromptPayload,
} from '../coding-plan.handler';
import { codingPlanSubmissionTools } from '../submission-tools';

const makeStartupInput = (): LocalPromptStartupInput =>
  ({
    task: {
      id: 'task-1',
      title: 'Cut over Coding Plan completion',
      description: 'Update the CLI coding-plan prompt and handler.',
      acceptanceCriteria: 'Plan review uses a typed report and explicit completion actions.',
      taskType: 'FEATURE',
    },
    evidenceItems: [],
    adjacentScopeTasks: [],
  }) as unknown as LocalPromptStartupInput;

const makePayload = (): LocalStartupSessionPromptPayload => ({
  startupInput: makeStartupInput(),
});

const makeCanonicalContext = (): PromptTypeHandlerContext => ({
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: 'task-1' },
    entity: { title: 'Cut over Coding Plan completion' } as never,
    context: { displayName: 'Cut over Coding Plan completion' } as never,
  },
  recentUserReplies: [],
  triggerParentMessageId: null,
});

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-startup-1',
    entity: { entityType: 'TASK', entityId: 'task-1' },
    sessionContext: {},
    contextMetadata: {},
    ...overrides,
  }) as unknown as AgenticSession;

const makeLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }) as unknown as PromptTypeHandlerDeps['logger'];

const makeDeps = (
  logger: PromptTypeHandlerDeps['logger'] = makeLogger(),
  overrides: Partial<PromptTypeHandlerDeps> = {},
): PromptTypeHandlerDeps => createPromptTypeHandlerTestDeps({ logger, ...overrides });

const jsonResponse = (body: object, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  }) as unknown as Response;

const noopDeps = makeDeps();

describe('codingPlanHandler', () => {
  it('registers under the startup_session prompt type', () => {
    expect(codingPlanHandler.promptType).toBe('startup_session');
  });

  it('runs in an isolated subagent with declarative SubAgent config', () => {
    expect(codingPlanHandler.runnerKind).toBe('subagent');
    expect(codingPlanHandler.rebuildPromptOnUserMessage).toBe(true);
    expect(codingPlanHandler.subagentConfig?.adapterId).toBe('claude-sdk-coding-plan-subagent');
    expect(codingPlanHandler.subagentConfig?.mcpAllowedTools.length).toBeGreaterThan(0);
  });

  it('requires no reports and mounts only conversation tools', () => {
    expect(codingPlanHandler.reports).toEqual([]);
    expect(codingPlanHandler.submissionTools).toEqual([...codingPlanSubmissionTools]);
    expect(codingPlanHandler.submissionTools?.every((tool) => tool.kind === 'pass_through')).toBe(
      true,
    );
  });

  it('exposes a read-only subagent MCP allowlist with no proposal or edge mutations', () => {
    const allow = new Set(CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS);
    // The subagent calls create_report via the run-scoped submission tool wrapper,
    // while get_report_schema is a read-only platform lookup required by the prompt.
    expect(allow).toContain('get_report_schema');
    expect(allow).not.toContain('create_report');
    // Read/search tools survive.
    expect(allow).toContain('get_context');
    for (const reader of [
      'get_diagram',
      'get_edges',
      'get_tool_guidance',
      'get_work_item_type_guidance_batch',
    ]) {
      expect(allow).toContain(reader);
    }
    expect(allow).toContain('unified_search');
    // Implementation-hint tools survive — hints are the agent's own memory
    // layer, not user-reviewed graph proposals.
    expect(allow).toContain('create_implementation_hint');
    expect(allow).toContain('edit_implementation_hint');
    expect(allow).toContain('delete_implementation_hint');
    // Every proposal-mutating and edge tool is stripped.
    for (const tool of [
      'create_work_item',
      'edit_work_item',
      'edit_tasks',
      'create_step',
      'update_step',
      'update_proposal',
      'create_edge',
      'update_edge',
      'delete_edge',
    ]) {
      expect(allow).not.toContain(tool);
    }
  });

  it('limits the subagent to read-only built-in tools (no Write/Edit/Bash)', () => {
    const builtin = new Set(CODING_PLAN_SUBAGENT_BUILTIN_ALLOWED_TOOLS);
    expect(builtin).toContain('Read');
    expect(builtin).toContain('Glob');
    expect(builtin).toContain('Grep');
    expect(builtin).not.toContain('Write');
    expect(builtin).not.toContain('Edit');
    expect(builtin).not.toContain('Bash');
  });

  it('keeps response transformation hooks disabled for the report/action protocol', () => {
    // Structured plan presentation belongs to the typed PLAN report and the
    // explicit completion tools, not to a handler-local JSON transformer.
    expect(codingPlanHandler.transformInput).toBeUndefined();
    expect(codingPlanHandler.transformOutput).toBeUndefined();
  });

  describe('prepare', () => {
    it('rebuilds revision context with current feedback and Run-owned Service scope', async () => {
      const replies = [
        {
          messageId: 'revision-1',
          text: 'Revise the root-level file step.',
          createdAt: '2026-09-22T19:46:00-07:00',
        },
      ];
      const session = makeSession({
        services: [
          { id: 'service-cli', path: '/repos/cli' },
          { id: 'service-api', path: '/repos/api' },
        ],
        launchServiceId: 'service-cli',
        worktreeState: {
          'service-cli': {
            repoPath: '/repos/cli',
            worktreePath: '/worktrees/cli',
            branch: 'bug/plan-revision',
          },
          'service-api': {
            repoPath: '/repos/api',
            worktreePath: '/worktrees/api',
            branch: 'bug/plan-revision',
          },
        },
      });

      const result = await codingPlanHandler.prepare!(session, makePayload(), noopDeps, {
        recentUserReplies: replies,
        triggerParentMessageId: 'revision-1',
      });

      expect(result.payload).toMatchObject({
        _recentUserReplies: replies,
        _services: session.services,
        _launchServiceId: 'service-cli',
        _worktreeState: session.worktreeState,
      });
      const prompt = codingPlanHandler.buildPrompt(result.payload);
      expect(prompt).toContain('Revise the root-level file step.');
      expect(prompt).toContain('Launch service `service-cli` at `/worktrees/cli`');
      expect(prompt).toContain('`service-api` at `/worktrees/api`');
    });

    it('retains matching startupInput enrichment without caching identity', async () => {
      const session = makeSession();
      const payload = makePayload();
      const result = await codingPlanHandler.prepare!(session, payload, noopDeps);
      expect(result.payload.startupInput?.task.id).toBe('task-1');
      expect(result.payload.startupInput?.task.title).toBe('Cut over Coding Plan completion');
      expect(result.sessionContext).toBeUndefined();
    });

    it('does not reconstruct or replace the startup task projection', async () => {
      const payload = makePayload();
      const startupInput = payload.startupInput;
      if (!startupInput) throw new Error('Expected the compatibility startupInput fixture.');
      startupInput.task.id = 'stale-payload-task';

      const result = await codingPlanHandler.prepare!(makeSession(), payload, noopDeps);
      expect(result.payload.startupInput).toBe(payload.startupInput);
    });

    it('threads recentUserReplies from the turn context onto the enriched payload', async () => {
      const session = makeSession();
      const replies = [
        { messageId: 'u1', text: 'looks good', createdAt: '2026-04-21T10:00:00Z' },
        { messageId: 'u2', text: 'go ahead', createdAt: '2026-04-21T10:01:00Z' },
      ];
      const result = await codingPlanHandler.prepare!(session, makePayload(), noopDeps, {
        recentUserReplies: replies,
        triggerParentMessageId: null,
      });
      const enriched = result.payload as EnrichedCodingPlanPromptPayload;
      expect(enriched._recentUserReplies).toEqual(replies);
    });

    it('treats the turn user message as the latest reply so feedback is classified, not ignored', async () => {
      const session = makeSession();
      const result = await codingPlanHandler.prepare!(
        session,
        { ...makePayload(), userMessage: '  ok, we need to update the bug  ' },
        noopDeps,
      );
      const enriched = result.payload as EnrichedCodingPlanPromptPayload;
      expect(enriched._recentUserReplies?.map((reply) => reply.text)).toEqual([
        'ok, we need to update the bug',
      ]);
    });

    it('defaults recentUserReplies to an empty array when no turn context is supplied', async () => {
      const session = makeSession();
      const result = await codingPlanHandler.prepare!(session, makePayload(), noopDeps);
      const enriched = result.payload as EnrichedCodingPlanPromptPayload;
      expect(enriched._recentUserReplies).toEqual([]);
    });

    it('records whether the planning conversation already holds a saved plan version', async () => {
      const session = makeSession({
        conversationId: 'conv-1',
        contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
      } as Partial<AgenticSession>);
      const planMessage = {
        id: 'plan-1',
        type: 'SYSTEM',
        data: {
          uiElements: [
            {
              type: 'coding_plan_version',
              payload: {
                responseType: 'coding_plan_version_v1',
                markdown: '# Plan',
                requiredServiceIds: ['a8fb6fbb-5747-4480-89e3-fc4a43ab7745'],
              },
            },
          ],
        },
      };
      const prepareWith = async (data: object[]) =>
        (
          await codingPlanHandler.prepare!(
            session,
            makePayload(),
            makeDeps(makeLogger(), {
              fetchImpl: vi.fn(async () => jsonResponse({ data })) as unknown as typeof fetch,
            }),
          )
        ).payload as EnrichedCodingPlanPromptPayload;

      expect((await prepareWith([]))._hasSavedPlanVersion).toBe(false);
      expect((await prepareWith([planMessage]))._hasSavedPlanVersion).toBe(true);
    });

    it('does not rebuild startup input from stale cached identity on follow-up', async () => {
      const session = makeSession({
        sessionContext: {
          'codingPlan.startupInput': {
            ...makeStartupInput(),
            task: { ...makeStartupInput().task, id: 'stale-task' },
          },
        },
      } as unknown as Partial<AgenticSession>);
      const result = await codingPlanHandler.prepare!(
        session,
        {} as LocalStartupSessionPromptPayload,
        noopDeps,
      );
      expect(result.payload.startupInput).toBeUndefined();
      expect(result.sessionContext).toBeUndefined();
    });

    it('fails closed when the persisted Run entity is missing', async () => {
      const session = makeSession({ entity: null });
      await expect(
        codingPlanHandler.prepare!(session, {} as LocalStartupSessionPromptPayload, noopDeps),
      ).rejects.toThrow(/requires a persisted Run entity/i);
    });

    it('stamps launchPlanId/launchStepId/launchStageId on the payload only when all three are non-empty', async () => {
      const session = makeSession({
        contextMetadata: {
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
        },
      } as unknown as Partial<AgenticSession>);
      const result = await codingPlanHandler.prepare!(session, makePayload(), noopDeps);
      expect(result.payload.launchPlanId).toBe('plan-abc');
      expect(result.payload.launchStepId).toBe('step-xyz');
      expect(result.payload.launchStageId).toBe('stage-uvw');
    });

    it('leaves the payload unchanged when any of the three launch ids is absent', async () => {
      const session = makeSession({
        contextMetadata: {
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
        },
      } as unknown as Partial<AgenticSession>);
      const result = await codingPlanHandler.prepare!(session, makePayload(), noopDeps);
      expect(result.payload.launchPlanId).toBeUndefined();
      expect(result.payload.launchStepId).toBeUndefined();
      expect(result.payload.launchStageId).toBeUndefined();
    });

    it('logs turnPath=planned when all three launch ids are present', async () => {
      const logger = makeLogger();
      const deps = makeDeps(logger);
      const session = makeSession({
        contextMetadata: {
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
        },
      } as unknown as Partial<AgenticSession>);
      await codingPlanHandler.prepare!(session, makePayload(), deps);
      expect(logger.debug).toHaveBeenCalledWith(
        'coding_plan.prepare.entry',
        expect.objectContaining({ turnPath: 'planned' }),
      );
    });

    it('resolves the launched plan design doc and threads it onto the enriched payload', async () => {
      const logger = makeLogger();
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              entityId: 'plan-abc',
              entityType: 'TASK',
              displayName: 'Launch plan',
              relatedEntities: [
                {
                  entityId: 'design-doc-abc',
                  entityType: 'DESIGN_DOC',
                  displayName: 'Launch design',
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              entityId: 'design-doc-abc',
              entityType: 'DESIGN_DOC',
              displayName: 'Launch design',
              content: {
                sections: {
                  solution: 'Use the plan context path.',
                  problem: 'Plan-scoped sessions need design intent.',
                },
              },
            },
          }),
        );
      const deps = makeDeps(logger, {
        apiBaseUrl: 'https://api.test/v1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        auth: createPromptTypeHandlerTestAuth('access-token'),
      });
      const session = makeSession({
        contextMetadata: {
          organizationId: 'org-1',
          projectId: 'proj-1',
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
        },
      } as unknown as Partial<AgenticSession>);

      const result = await codingPlanHandler.prepare!(session, makePayload(), deps);
      const enriched = result.payload as EnrichedCodingPlanPromptPayload;

      expect(enriched._planDesignDocReference).toEqual({
        id: 'design-doc-abc',
        title: 'Launch design',
        sections: {
          problem: 'Plan-scoped sessions need design intent.',
          solution: 'Use the plan context path.',
        },
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl).toHaveBeenNthCalledWith(
        1,
        'https://api.test/v1/organizations/org-1/projects/proj-1/entities/TASK/plan-abc/context',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer access-token' },
        }),
      );
      expect(fetchImpl).toHaveBeenNthCalledWith(
        2,
        'https://api.test/v1/organizations/org-1/projects/proj-1/entities/DESIGN_DOC/design-doc-abc/context',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer access-token' },
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'coding_plan.prepare.plan_design_doc_reference_resolved',
        expect.objectContaining({ hasPlanDesignDocReference: true }),
      );
    });

    it('keeps plan-scoped startup non-blocking when the plan has no design doc relation', async () => {
      const logger = makeLogger();
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          data: {
            entityId: 'plan-abc',
            entityType: 'TASK',
            displayName: 'Launch plan',
            relatedEntities: [],
          },
        }),
      );
      const deps = makeDeps(logger, {
        apiBaseUrl: 'https://api.test/v1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        auth: createPromptTypeHandlerTestAuth('access-token'),
      });
      const session = makeSession({
        contextMetadata: {
          organizationId: 'org-1',
          projectId: 'proj-1',
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
        },
      } as unknown as Partial<AgenticSession>);

      const result = await codingPlanHandler.prepare!(session, makePayload(), deps);
      const enriched = result.payload as EnrichedCodingPlanPromptPayload;

      expect(enriched._planDesignDocReference).toBeUndefined();
      expect(enriched.launchPlanId).toBe('plan-abc');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        'coding_plan.prepare.plan_design_doc_reference_resolved',
        expect.objectContaining({ hasPlanDesignDocReference: false }),
      );
    });

    it('logs turnPath=free when launch ids are absent', async () => {
      const logger = makeLogger();
      const deps = makeDeps(logger);
      const session = makeSession();
      await codingPlanHandler.prepare!(session, makePayload(), deps);
      expect(logger.debug).toHaveBeenCalledWith(
        'coding_plan.prepare.entry',
        expect.objectContaining({ turnPath: 'free' }),
      );
    });

    it('threads a project_assistant memo onto the enriched payload — the subagent needs it carried since the resolver skips the memo prepend', async () => {
      const logger = makeLogger();
      const deps = makeDeps(logger);
      const session = makeSession({
        memos: [
          {
            source: LocalPromptType.ProjectAssistant,
            content:
              '## Research frame\nfeature F surfaced\nMockup: retain shared triage cards and redraw the approved modal.\nDiagram: preserve both decision branches.\nCUSTOM_REVIEW: retain review evidence.\nResolution: user chose the modal.\nGap: unavailable governing item; readable items remain usable.',
            writtenAt: '2026-04-17T00:00:00Z',
          },
        ],
      } as unknown as Partial<AgenticSession>);
      const result = await codingPlanHandler.prepare!(session, makePayload(), deps);
      const enriched = result.payload as EnrichedCodingPlanPromptPayload;
      expect(enriched._researchMemo).toContain('feature F surfaced');
      const prompt = codingPlanHandler.buildPrompt(enriched);
      for (const content of [
        'retain shared triage cards',
        'preserve both decision branches',
        'CUSTOM_REVIEW: retain review evidence',
        'user chose the modal',
        'Gap: unavailable governing item',
      ]) {
        expect(prompt).toContain(content);
      }
      expect(prompt).toContain('read the current content of each before planning');
      expect(logger.debug).toHaveBeenCalledWith(
        'coding_plan.prepare.entry',
        expect.objectContaining({ hasResearchMemo: true }),
      );
    });

    it('leaves _researchMemo unset when no project_assistant memo is on the run', async () => {
      const session = makeSession({
        memos: [
          { source: 'daily_session', content: 'unrelated', writtenAt: '2026-04-17T00:00:00Z' },
        ],
      } as unknown as Partial<AgenticSession>);
      const result = await codingPlanHandler.prepare!(session, makePayload(), noopDeps);
      const enriched = result.payload as EnrichedCodingPlanPromptPayload;
      expect(enriched._researchMemo).toBeUndefined();
    });

    it('uses Run-owned worktree paths in the Plan Services context', async () => {
      const session = makeSession({
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
      });
      const prepared = await codingPlanHandler.prepare!(session, makePayload(), noopDeps);
      const prompt = codingPlanHandler.buildPrompt(prepared.payload);

      expect(prompt).toContain('Launch service `service-b` at `/worktrees/service-b`');
      expect(prompt).toContain('`service-a` at `/worktrees/service-a`');
      expect(prompt).not.toContain('/host/service-a');
      expect(prompt).not.toContain('/host/service-b');
    });
  });

  describe('buildPrompt', () => {
    it('delivers the section readability guidance and example in the effective planner prompt', () => {
      const prompt = codingPlanHandler.buildPrompt(makePayload());
      expect(prompt).toContain(
        'Open each substantive section of the complete plan with a short, bold paragraph explaining in accessible language why the change is needed and what the user or system gains.',
      );
      expect(prompt).toContain('not a required section schema');
      expect(prompt).toContain('without adding another heading or using a blockquote');
      expect(prompt).toContain(
        '**People should be able to understand the proposed change before reviewing its engineering details. Each section explains the reason for the work and its expected benefit first.**\n\n- Bold the opening paragraph.\n- Follow with distinct implementation instructions while retaining necessary qualifications and references.',
      );
    });

    it('persists conversational context and reserves approval for explicit user control', () => {
      const prompt = codingPlanHandler.buildPrompt(makePayload());
      expect(prompt).toContain('emit_coding_plan');
      expect(prompt).toContain('emit_coding_plan_discrepancy');
      expect(prompt).toContain(
        'Only the explicit Approve control on the current complete emitted plan authorizes implementation',
      );
      expect(prompt).not.toContain('submit_approved');
    });
    it('preserves ordinary replies without interpreting them as approval', () => {
      const prompt = codingPlanHandler.buildPrompt(makePayload(), {
        recentUserReplies: [{ messageId: 'reply', text: 'looks good', createdAt: '' }],
        triggerParentMessageId: null,
      });
      expect(prompt).toContain('## Current feedback\nlooks good');
      expect(prompt).toContain('never completes the workflow, submits APPROVED or REFINE');
    });
  });

  describe('buildStartingMessage', () => {
    it('returns a task-titled starting message when a title is available', () => {
      const msg = codingPlanHandler.buildStartingMessage!(makePayload(), makeCanonicalContext());
      expect(msg).toBe('Getting started on Cut over Coding Plan completion...');
    });
  });
});

describe('coding-plan registry wiring', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('registers the handler under the startup_session key', async () => {
    expect(registry.get('startup_session')?.promptType).toBe('startup_session');
  });

  it('the registered handler carries the explicit completion tools', async () => {
    const fetched = registry.get('startup_session');
    expect(fetched?.submissionTools?.map((tool) => tool.name)).toEqual([
      'emit_coding_plan_discrepancy',
      'emit_coding_plan',
    ]);
  });
});
