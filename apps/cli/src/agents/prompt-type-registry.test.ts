import { describe, expect, it } from 'vitest';
import { PromptTypeRegistry } from './prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from './prompt-type-registry.test-support';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import { dailySessionHandler } from './daily-session/daily-session.handler';
import type { RepositoryGroundingRequest } from '../shared/agent-bridge-contract/generated';
import { resolveSelectedProviderId } from '../server/runtime/providers/select';
import { freeFormHandler } from './coding-conversation';
import { EVAL_CONSUMER_HANDLER_IDS } from './run-eval/eval-targets';

describe('prompt-type-registry', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('returns a registered handler for a known LocalPromptType', () => {
    const handler = registry.get(LocalPromptType.Implement);
    expect(handler).toBeDefined();
    expect(handler?.promptType).toBe(LocalPromptType.Implement);
  });

  it('registers Project Assistant before the final project-defined Project Mode route', () => {
    const handlers = registry.list();
    expect(handlers.at(-2)).toMatchObject({
      id: 'project_assistant',
      promptType: LocalPromptType.ProjectAssistant,
    });
    expect(handlers.at(-1)?.promptType).toBe(LocalPromptType.ProjectMode);
    expect(registry.get(LocalPromptType.FreeForm)).toBe(freeFormHandler);
  });

  it('registers the real read-only Task Monitor coordinator', () => {
    expect(registry.get(LocalPromptType.TaskMonitor)).toMatchObject({
      id: 'task-monitor-coordinator',
      promptType: LocalPromptType.TaskMonitor,
      runnerKind: 'provider_session',
      readOnlyFilesystem: true,
      mcpToolUseCase: 'task_monitor',
      builtinTools: [],
    });
    expect(registry.get(LocalPromptType.TaskMonitor)?.buildPrompt).not.toBeUndefined();
  });

  it('resolves project_report to exactly one dedicated graph-only handler', () => {
    const matches = registry
      .list()
      .filter((handler) => handler.promptType === LocalPromptType.ProjectReport);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: 'project_report',
      promptType: LocalPromptType.ProjectReport,
      providerSessionStart: 'fresh',
      readOnlyFilesystem: true,
      builtinTools: [],
      mcpToolUseCase: 'project_report',
      reports: [{ reportType: 'PROJECT_REPORT', audience: 'PROJECT_VISIBLE', required: true }],
    });
  });

  it('registers Goal PM as a separate read-only routing handler', () => {
    expect(registry.get(LocalPromptType.GoalPm)).toMatchObject({
      id: 'goal_pm',
      promptType: LocalPromptType.GoalPm,
      expectedResponseTypes: ['goal_pm_routing_v1'],
      runnerKind: 'provider_session',
      providerSessionLifetime: 'turn',
      providerSessionStart: 'fresh',
      readOnlyFilesystem: true,
      mcpToolUseCase: 'research',
      builtinTools: [],
    });
    expect(registry.get(LocalPromptType.EntityConversation)?.id).toBe('entity_conversation');
  });

  it('registers Open Items triage once and preserves existing routes', () => {
    const handler = registry.get(LocalPromptType.OpenItemsTriage);
    expect(handler).toMatchObject({
      id: 'open_items_triage',
      promptType: LocalPromptType.OpenItemsTriage,
      expectedResponseTypes: ['open_items_triage_v1'],
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      rebuildPromptOnUserMessage: true,
      readOnlyFilesystem: true,
      builtinTools: [],
    });
    expect(registry.getById('open_items_triage')).toBe(handler);
    expect(registry.list().filter((entry) => entry.id === 'open_items_triage')).toEqual([handler]);
    expect(registry.get(LocalPromptType.FreeForm)).toBe(freeFormHandler);
  });

  it('registers the EVAL-only Run Eval handler without changing coding handlers', () => {
    expect(registry.get(LocalPromptType.RunEval)).toMatchObject({
      id: 'run_eval',
      promptType: LocalPromptType.RunEval,
      eligibleWorkItemTypeKeys: ['EVAL'],
      runnerKind: 'procedural',
    });
    expect(registry.get(LocalPromptType.StartupSession)?.id).toBe('startup_session');
    expect(registry.get(LocalPromptType.CodingFreeform)?.id).toBe('coding_freeform');
  });

  it.each([
    [LocalPromptType.WorkTrackerConnect, 'work-tracker-connect'],
    [LocalPromptType.WorkTrackerImport, 'work-tracker-import'],
  ])('registers %s as an isolated fresh read-only handler', (promptType, id) => {
    expect(registry.get(promptType)).toMatchObject({
      id,
      promptType,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      readOnlyFilesystem: true,
      builtinTools: [],
      submissionTools: [],
      reports: [],
    });
    expect(registry.get(promptType)?.projectAssistant).toBeUndefined();
    expect(registry.get(promptType)?.eligibleWorkItemTypeKeys).toBeUndefined();
  });

  it('registers the generated repository-grounding handler', () => {
    expect(registry.get(LocalPromptType.RepositoryGrounding)).toMatchObject({
      id: 'repository-analysis',
      promptType: LocalPromptType.RepositoryGrounding,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      readOnlyFilesystem: true,
      repositoryResearch: { delegation: 'allowed' },
      mcpToolUseCase: 'repository_grounding',
      reports: [],
    });
  });

  it('registers imported-root placement as a fresh bounded provider turn', () => {
    expect(registry.get(LocalPromptType.RepositoryPlacement)).toMatchObject({
      id: 'repository-placement',
      promptType: LocalPromptType.RepositoryPlacement,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      mcpToolUseCase: 'repository_placement',
      builtinTools: [],
      reports: [],
    });
  });

  it.each([
    ['claude', 'claude-opus-4-5-20251101', 'claude'],
    ['codex', 'gpt-5.1', 'codex'],
    ['opencode', 'openai/gpt-5.1', 'opencode'],
  ] as const)(
    'carries an API-shaped %s repository trigger through the registered handler to the selected runner',
    (provider, resolvedFrontierModel, expectedRunner) => {
      const trigger = {
        promptType: LocalPromptType.RepositoryGrounding,
        projectId: 'project-1',
        conversationId: 'conversation-1',
        workflowId: 'workflow-1',
        workflowNodeId: 'repository-grounding-analysis',
        entryMode: 'existing_project',
        serviceId: 'service-1',
        confirmedServiceBrief: 'Existing product',
        machineId: 'machine-1',
        scope: { scope: 'comprehensive' },
        provider,
        resolvedFrontierModel,
        reasoningEffort: 'high',
        fastMode: provider === 'codex',
        bounds: {
          maxFiles: 10,
          maxTotalBytes: 1000,
          maxFileBytes: 100,
          maxDepth: 3,
          maxGeneratedFiles: 5,
          maxIgnoredFiles: 5,
          maxUnsupportedFiles: 5,
          maxBinaryFiles: 5,
        },
      } satisfies RepositoryGroundingRequest;

      const selection = registry.get(trigger.promptType)?.resolveProviderExecution?.(trigger);

      expect(selection).toEqual({ provider, model: resolvedFrontierModel });
      expect(resolveSelectedProviderId(selection?.provider ?? '')).toBe(expectedRunner);
    },
  );

  it('registers the guarded HTML/CSS annotation revision handler', () => {
    expect(registry.get(LocalPromptType.HtmlCssMockupRevision)).toMatchObject({
      id: 'html_css_mockup_revision',
      promptType: LocalPromptType.HtmlCssMockupRevision,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      eligibleWorkItemTypeKeys: ['STANDARD'],
    });
  });

  it('routes Daily Session turns to the coach while preserving the report handler export', () => {
    expect(registry.get(LocalPromptType.DailySession)).toMatchObject({
      id: 'daily_session_coach',
      promptType: LocalPromptType.DailySession,
      expectedResponseTypes: [],
      providerSessionLifetime: 'turn',
      reports: [],
    });
    expect(dailySessionHandler.id).toBe('daily_session');
    expect(dailySessionHandler.expectedResponseTypes).toEqual(['daily_session_v1']);
    expect(dailySessionHandler.reports.length).toBeGreaterThan(0);
  });

  it('returns undefined for an unknown promptType', () => {
    expect(registry.get('not_a_real_prompt_type')).toBeUndefined();
  });

  it('returns undefined when promptType is undefined', () => {
    expect(registry.get(undefined)).toBeUndefined();
  });

  it('registers every logical agent with a non-empty stable id', () => {
    const ids = new Set<string>();
    for (const handler of registry.list()) {
      expect(handler.id.trim()).not.toBe('');
      expect(ids.has(handler.id)).toBe(false);
      ids.add(handler.id);
    }
  });

  it('resolves child-only handlers for the child launcher without making them dispatchable', () => {
    const section = registry.getChildHandler('project_report_section');
    expect(section?.childConfig?.submissionTools).toBe('none');
    expect(registry.list()).not.toContain(section);
    expect(registry.getById('project_report_section')).toBeUndefined();
    expect(registry.getChildHandler('research')).toBe(registry.getById('research'));
    expect(registry.getChildHandler('not_a_real_handler_id')).toBeUndefined();
  });

  it('resolves every registered handler by its stable id', () => {
    for (const handler of registry.list()) {
      expect(registry.getById(handler.id)).toBe(handler);
    }
    expect(registry.getById('not_a_real_handler_id')).toBeUndefined();
  });

  it('counts the coding plan for context and keeps one-off subagents out of it', () => {
    const countsForContext = (promptType: LocalPromptType) =>
      registry.get(promptType)?.providerSessionCountsForContext;
    expect(countsForContext(LocalPromptType.StartupSession)).toBe(true);
    expect(countsForContext(LocalPromptType.CodeReview)).toBe(false);
    expect(countsForContext(LocalPromptType.Commit)).toBe(false);
    expect(countsForContext(LocalPromptType.FinalAssessment)).toBe(false);
    for (const handler of registry.list()) {
      if (handler.runnerKind === 'provider_session') {
        expect(handler.providerSessionCountsForContext).toBe(true);
      }
    }
  });

  it('declares Project Assistant policy on every prior participant and nowhere by registry fallback', () => {
    const allParticipants = [
      LocalPromptType.StartupSession,
      LocalPromptType.FreeForm,
      LocalPromptType.ValidationWalkthrough,
      LocalPromptType.FeatureSyncAnalyze,
      LocalPromptType.PlanShapingFeatureSyncAnalyze,
      LocalPromptType.TaskRefiner,
      LocalPromptType.FeatureRefiner,
      LocalPromptType.DesignDocRefiner,
    ];
    for (const promptType of allParticipants) {
      expect(registry.get(promptType)?.projectAssistant).toEqual({
        allowEdgeUpdates: false,
        notifyDiscrepancies: false,
        workItemProposalMode: 'all',
      });
    }

    expect(registry.get(LocalPromptType.EntityConversation)?.projectAssistant).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    });
    expect(registry.get(LocalPromptType.CodingFreeform)?.projectAssistant).toBeUndefined();
  });

  it('offers evals exactly the registered handlers whose Project Assistant policy is fixed', () => {
    const declaringHandlerIds = registry
      .list()
      .filter((handler) => handler.projectAssistant && !handler.resolveProjectAssistant)
      .map((handler) => handler.id);

    expect([...EVAL_CONSUMER_HANDLER_IDS].sort()).toEqual(declaringHandlerIds.sort());
  });

  it('registers Verify Feature as its own Feature-only mode with its own provider-session identity', () => {
    const handler = registry.get(LocalPromptType.VerifyFeature);
    expect(handler).toMatchObject({
      id: 'verify_feature',
      promptType: LocalPromptType.VerifyFeature,
      runnerKind: 'provider_session',
      launchEntity: 'required',
      service: 'optional',
      eligibleWorkItemTypeKeys: ['FEATURE'],
    });
    expect(handler?.id).not.toBe(registry.get(LocalPromptType.EntityConversation)?.id);
    expect(handler?.additionalAllowedTools).toContain('get_agent_session');
    expect(handler?.projectAssistant).toBeUndefined();
    expect(registry.getById('verify_feature')).toBe(handler);
  });
});
