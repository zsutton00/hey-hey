import { describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../../../session/types';
import type { MessageResponseDto } from '../../../shared/api/generated/api';
import type { PromptTypeHandlerDeps } from '../../prompt-type-handler';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../../prompt-type-handler.test-support';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import { NOOP_LOGGER } from '../../../server/logger';
import { implementHandler } from '../implement.handler';
import type { EnrichedImplementPromptPayload } from '../prompts';

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'agentic-1',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    provider: 'claude',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    status: 'idle',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'coding-session-1',
    },
    createdAt: '2026-04-18T00:00:00.000Z',
    updatedAt: '2026-04-18T00:00:00.000Z',
    events: [],
    ...overrides,
  }) as unknown as AgenticSession;

const makePlanMessage = (
  plan: Record<string, unknown>,
  overrides: Partial<Record<string, unknown>> = {},
): MessageResponseDto =>
  ({
    id: overrides['id'] ?? 'msg-plan-1',
    projectId: 'proj-1',
    type: 'SYSTEM',
    conversationId: 'conv-1',
    createdAt: overrides['createdAt'] ?? '2026-04-18T00:00:01.000Z',
    awaitingResponse: false,
    status: 'open',
    data: {
      type: 'QUESTIONS',
      processResponseType: 'startup_plan_v1',
      response: 'Startup Plan',
      detectedIntent: 'agent_response',
      intentConfidence: 1,
      uiElements: [
        {
          id: 'ui-1',
          type: 'coding_prompt_startup_plan',
          label: 'Startup Plan',
          payload: plan,
        },
      ],
    },
    ...overrides,
  }) as unknown as MessageResponseDto;

const makeUserMessage = (id: string): MessageResponseDto =>
  ({
    id,
    projectId: 'proj-1',
    type: 'USER',
    conversationId: 'conv-1',
    createdAt: '2026-04-18T00:00:00.500Z',
    awaitingResponse: false,
    status: 'open',
    data: { type: 'USER' },
  }) as unknown as MessageResponseDto;

const makePlanReportMessage = (
  plan: Record<string, unknown>,
  overrides: Partial<Record<string, unknown>> = {},
): MessageResponseDto => {
  const { responseType: _responseType, ...reportPlan } = plan;
  return {
    ...makePlanMessage(plan, overrides),
    data: {
      type: 'AGENT',
      response: 'Coding Plan ready for review.',
    },
    reports: [
      {
        reportType: 'PLAN',
        createdAt: overrides['createdAt'] ?? '2026-04-18T00:00:01.000Z',
        payload: {
          ...reportPlan,
          reportType: 'PLAN',
          summary: 'Approved implementation plan.',
        },
      },
    ],
  } as unknown as MessageResponseDto;
};

const makeValidPlan = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  responseType: 'startup_plan_v1',
  sessionTitle: 'Approved title',
  requiredServiceIds: ['service-auth'],
  primaryImplementations: [
    {
      title: 'Primary implementation',
      content: 'Concrete implementation body.',
      rationale: 'Defines the primary delivered behavior.',
      location: 'src/TriageModal.tsx',
      language: 'markdown',
      connections: [
        {
          entityType: 'workflowStep',
          entityId: '33333333-3333-4333-8333-333333333333',
          entityTitle: 'Triage decision',
          relationship: 'fulfills',
          sourceField: 'outputs',
          sourceExcerpt: 'Both triage branches preserve shared cards.',
          rationale: 'The modal honors both branches.',
        },
      ],
    },
  ],
  executionPlan: [
    {
      stepId: 'step-1',
      title: 'Implement the approved change',
      description: 'Apply the approved implementation.',
      phase: 1,
      targetFiles: ['src/TriageModal.tsx'],
      references: [
        {
          sourceType: 'designDoc',
          sourceId: '44444444-4444-4444-8444-444444444444',
          rationale: 'Approved modal redraw reuses existing shared triage cards.',
        },
      ],
    },
  ],
  discrepancies: [],
  clarificationQuestions: [],
  ...overrides,
});

const makeFetchImpl = (messages: MessageResponseDto[]): typeof fetch => {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: messages }),
  })) as unknown as typeof fetch;
};

const makeDeps = (fetchImpl: typeof fetch): PromptTypeHandlerDeps =>
  createPromptTypeHandlerTestDeps({
    fetchImpl,
    auth: createPromptTypeHandlerTestAuth('test-token'),
    apiBaseUrl: 'https://api.test',
    logger: NOOP_LOGGER,
  });

describe('implementHandler', () => {
  it('registers under the implement prompt type', () => {
    expect(implementHandler.promptType).toBe(LocalPromptType.Implement);
  });

  it('runs on the Run-lifetime provider session under the coding tool use case', () => {
    expect(implementHandler.runnerKind).toBe('provider_session');
    expect(implementHandler.subagentConfig).toBeUndefined();
    expect(implementHandler.mcpToolUseCase).toBe('coding');
  });

  it('registers the coding-only Service-scope request tool', () => {
    expect(implementHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'report_changed_files',
      'request_agent_session_service_scope',
    ]);
  });

  describe('buildPrompt', () => {
    it('returns a non-empty system prompt', () => {
      const prompt = implementHandler.buildPrompt({});
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('does not mention submission tools', () => {
      const prompt = implementHandler.buildPrompt({});
      expect(prompt).not.toMatch(/submission tool/i);
      expect(prompt).not.toContain('submit_done');
    });

    it('instructs the agent to read the plan from the conversation log', () => {
      const prompt = implementHandler.buildPrompt({});
      expect(prompt).toMatch(/conversation/i);
      expect(prompt).toMatch(/plan/i);
    });

    it('formats a user-message injection through addUserMessage', () => {
      const injection = implementHandler.addUserMessage({
        userMessage: 'start with the router changes',
      });
      expect(injection).toContain('start with the router changes');
    });

    it('returns null from addUserMessage when the payload has none', () => {
      expect(implementHandler.addUserMessage({})).toBeNull();
    });

    it('inlines the enriched approved plan under its own section', () => {
      const enriched: EnrichedImplementPromptPayload = {
        _approvedPlan: '{"responseType":"startup_plan_v1"}',
      };
      const prompt = implementHandler.buildPrompt(enriched);
      expect(prompt).toContain('## Approved plan');
      expect(prompt).toContain('startup_plan_v1');
    });

    it('inlines session context identifiers when enriched', () => {
      const enriched: EnrichedImplementPromptPayload = {
        _services: [{ id: 'svc-7', path: '/tmp/repo' }],
        _launchServiceId: 'svc-7',
        _codingSessionId: 'coding-9',
        _agenticSessionId: 'agentic-2',
      };
      const prompt = implementHandler.buildPrompt(enriched);
      expect(prompt).toContain('## Session context');
      expect(prompt).toContain('svc-7');
      expect(prompt).toContain('coding-9');
      expect(prompt).toContain('agentic-2');
    });

    it('keeps internal mechanics out of user-facing register rules', () => {
      const prompt = implementHandler.buildPrompt({});
      expect(prompt).toMatch(/never describe your internal workings/i);
      expect(prompt).toMatch(/never meta-narrate/i);
    });

    it('declares the agent strictly one-shot with no mid-turn user interaction', () => {
      const prompt = implementHandler.buildPrompt({});
      expect(prompt).toMatch(/strictly one-shot/i);
      expect(prompt).toMatch(/never interact with the user mid-turn/i);
      expect(prompt).toMatch(/do not ask the user/i);
    });

    it('directs the agent to ground itself via repo search before declaring a block', () => {
      const prompt = implementHandler.buildPrompt({});
      expect(prompt).toMatch(/Read,\s*Grep,\s*Glob/);
      expect(prompt).toMatch(/MCP search/i);
    });
  });

  describe('prepare', () => {
    it('recovers the approved plan from the canonical PLAN report attachment', async () => {
      const plan = makeValidPlan({
        sessionTitle: 'Canonical report title',
        requiredServiceIds: ['service-auth', 'service-api'],
      });
      const reportMessage = makePlanReportMessage(plan);
      const fetchImpl = makeFetchImpl([reportMessage]);

      const result = await implementHandler.prepare!(makeSession(), {}, makeDeps(fetchImpl));
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlan).toContain('Canonical report title');
      expect(Array.from(enriched._approvedPlanPayload?.requiredServiceIds ?? [])).toEqual([
        'service-auth',
        'service-api',
      ]);
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('includeReports=true'),
        expect.any(Object),
      );
    });

    it('prefers the canonical PLAN report over a legacy startup-plan UI element', async () => {
      const reportPlan = makeValidPlan({ sessionTitle: 'Canonical report title' });
      const legacyPlan = makeValidPlan({ sessionTitle: 'Legacy element title' });
      const fetchImpl = makeFetchImpl([
        makePlanReportMessage(reportPlan, { createdAt: '2026-04-18T00:00:01.000Z' }),
        makePlanMessage(legacyPlan, { createdAt: '2026-04-18T00:00:02.000Z' }),
      ]);

      const result = await implementHandler.prepare!(makeSession(), {}, makeDeps(fetchImpl));
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlan).toContain('Canonical report title');
      expect(enriched._approvedPlan).not.toContain('Legacy element title');
    });

    it('does not fall back to a legacy UI element when the canonical PLAN report is invalid', async () => {
      const invalidReportPlan = makeValidPlan({ requiredServiceIds: [] });
      const legacyPlan = makeValidPlan({ sessionTitle: 'Legacy element title' });
      const fetchImpl = makeFetchImpl([
        makePlanReportMessage(invalidReportPlan),
        makePlanMessage(legacyPlan),
      ]);

      const result = await implementHandler.prepare!(makeSession(), {}, makeDeps(fetchImpl));
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlan).toBeUndefined();
      expect(enriched._approvedPlanPayload).toBeUndefined();
    });

    it('logs the parse error when the stored PLAN report has an unknown step field', async () => {
      const basePlan = makeValidPlan();
      const [step] = basePlan['executionPlan'] as Record<string, unknown>[];
      const plan = makeValidPlan({ executionPlan: [{ ...step, step: null }] });
      const fetchImpl = makeFetchImpl([makePlanReportMessage(plan)]);
      const deps = makeDeps(fetchImpl);
      const warn = vi.spyOn(deps.logger, 'warn');

      const result = await implementHandler.prepare!(makeSession(), {}, deps);
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlanPayload).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'implement.prepare.plan_report_invalid',
        expect.objectContaining({ error: expect.stringContaining('step') }),
      );
      warn.mockRestore();
    });

    it('packages the latest startup plan and session identifiers onto the payload', async () => {
      const plan = makeValidPlan();
      const fetchImpl = makeFetchImpl([
        makeUserMessage('u-1'),
        makePlanMessage(plan, { id: 'msg-plan-1' }),
      ]);
      const run = makeSession();

      const result = await implementHandler.prepare!(run, {}, makeDeps(fetchImpl));
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlan).toContain('Approved title');
      const prompt = implementHandler.buildPrompt(enriched);
      for (const content of [
        'References: designDoc:44444444-4444-4444-8444-444444444444',
        'Approved modal redraw reuses existing shared triage cards.',
        '### Primary Implementations',
        'Concrete implementation body.',
        'Location: src/TriageModal.tsx',
        'Both triage branches preserve shared cards.',
        'The modal honors both branches.',
        'Source field: outputs',
        'compare the whole delivered result',
      ]) {
        expect(prompt).toContain(content);
      }
      expect(Array.from(enriched._approvedPlanPayload?.requiredServiceIds ?? [])).toEqual([
        'service-auth',
      ]);
      expect(enriched._launchServiceId).toBe('svc-1');
      expect(enriched._services).toEqual([{ id: 'svc-1', path: '/tmp/repo' }]);
      expect(enriched._codingSessionId).toBe('coding-session-1');
      expect(enriched._agenticSessionId).toBe('agentic-1');
    });

    it('uses Run-owned worktree paths in the Implement Services context', async () => {
      const fetchImpl = makeFetchImpl([makePlanMessage(makeValidPlan())]);
      const run = makeSession({
        services: [
          { id: 'svc-1', path: '/host/service-a' },
          { id: 'svc-2', path: '/host/service-b' },
        ],
        launchServiceId: 'svc-2',
        worktreeState: {
          'svc-1': {
            repoPath: '/host/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/worktrees',
          },
          'svc-2': {
            repoPath: '/host/service-b',
            worktreePath: '/worktrees/service-b',
            branch: 'feature/worktrees',
          },
        },
      });

      const result = await implementHandler.prepare!(run, {}, makeDeps(fetchImpl));
      const prompt = implementHandler.buildPrompt(result.payload);

      expect(prompt).toContain('Launch service `svc-2` at `/worktrees/service-b`');
      expect(prompt).toContain('`svc-1` at `/worktrees/service-a`');
      expect(prompt).not.toContain('/host/service-a');
      expect(prompt).not.toContain('/host/service-b');
    });

    it('picks the most recent plan when multiple are present', async () => {
      const olderPlan = makeValidPlan({ sessionTitle: 'Older title' });
      const newerPlan = makeValidPlan({ sessionTitle: 'Newer title' });
      const fetchImpl = makeFetchImpl([
        makePlanMessage(olderPlan, { id: 'old', createdAt: '2026-04-18T00:00:01.000Z' }),
        makePlanMessage(newerPlan, { id: 'new', createdAt: '2026-04-18T00:00:02.000Z' }),
      ]);
      const run = makeSession();

      const result = await implementHandler.prepare!(run, {}, makeDeps(fetchImpl));
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlan).toContain('Newer title');
      expect(enriched._approvedPlan).not.toContain('Older title');
    });

    it('walks nested response trees to find the plan', async () => {
      const plan = makeValidPlan({ sessionTitle: 'Nested title' });
      const planMessage = makePlanMessage(plan, {
        id: 'nested',
        createdAt: '2026-04-18T00:00:02.000Z',
      });
      const root = {
        ...makeUserMessage('root'),
        responses: [planMessage],
      } as unknown as MessageResponseDto;
      const fetchImpl = makeFetchImpl([root]);
      const run = makeSession();

      const result = await implementHandler.prepare!(run, {}, makeDeps(fetchImpl));
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlan).toContain('Nested title');
    });

    it('degrades gracefully when message fetching fails', async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ success: false }),
      })) as unknown as typeof fetch;
      const run = makeSession();

      const result = await implementHandler.prepare!(run, {}, makeDeps(fetchImpl));
      const enriched = result.payload as EnrichedImplementPromptPayload;

      expect(enriched._approvedPlan).toBeUndefined();
      expect(enriched._launchServiceId).toBe('svc-1');
      expect(enriched._services).toEqual([{ id: 'svc-1', path: '/tmp/repo' }]);
      expect(enriched._codingSessionId).toBe('coding-session-1');
      expect(enriched._agenticSessionId).toBe('agentic-1');
    });
  });
});

describe('implement registry wiring', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('registers the handler under its promptType key', async () => {
    expect(registry.get(LocalPromptType.Implement)?.promptType).toBe(LocalPromptType.Implement);
  });

  it('does not resolve typo or sibling-shaped promptTypes to the implement handler', async () => {
    expect(registry.get('IMPLEMENT')).toBeUndefined();
    expect(registry.get('implement_done')).toBeUndefined();
  });
});
