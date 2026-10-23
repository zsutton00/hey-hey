import { describe, expect, it, vi } from 'vitest';
import { reconciliationResponsibility } from '../../prompts/knowledge-responsibilities';
import { buildAnalyzePrompt } from '../prompts';
import type { AgenticSession } from '../../../session/types';
import {
  FeatureSyncDiscrepancyEntityTypeEnum,
  LocalPromptType,
  type FeatureSyncDiscrepancy,
} from '../../../shared/agent-bridge-contract/generated/api';
import type {
  LocalFeatureSyncAnalyzePromptPayload,
  LocalFeatureSyncIteratePromptPayload,
} from '../../../shared/agent-bridge-contract/runtime-types';
import { isRunContextMetadata } from '../../../shared/agent-bridge-contract/run-context';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import type { PromptTypeHandlerDeps, PromptTypeHandlerContext } from '../../prompt-type-handler';
import type { Run } from '../../../run/run';
import { featureSyncAnalyzeHandler } from '../analyze.handler';
import { featureSyncIterateHandler } from '../iterate.handler';
import {
  FEATURE_SYNC_ACTIONS,
  submitReadinessTool,
  submitDiscrepanciesTool,
  submitNoDiscrepancyTool,
  submitResolvedTool,
  submitRevisedTool,
} from '../submission-tools';
import { SubmissionToolCorrectableError } from '../../submission-tools/types';
import { readinessClassificationFixtures } from './readiness-classification.fixtures';

const makePayload = (
  userMessage = '',
  taskId = 'task-123',
): LocalFeatureSyncAnalyzePromptPayload => ({ taskId, userMessage });

const makeDiscrepancy = (
  overrides: Partial<FeatureSyncDiscrepancy> = {},
): FeatureSyncDiscrepancy => ({
  summary: 'feature drift',
  rationale: 'tasks no longer reflect feature X',
  ...overrides,
});

const makeIteratePayload = (
  overrides: Partial<LocalFeatureSyncIteratePromptPayload> = {},
): LocalFeatureSyncIteratePromptPayload => ({
  discrepancies: [makeDiscrepancy()],
  ...overrides,
});

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    entity: { entityType: 'TASK', entityId: 'task-123' },
    contextMetadata: {
      capturedAt: '2026-04-17T00:00:00Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      task: { id: 'task-123', title: 'Test task' },
      fileReferences: { resolved: [], unresolved: [] },
    },
    ...overrides,
  }) as unknown as AgenticSession;

const makeProjectAssistantMemo = (content = '## Research frame\nfeature F surfaced') => ({
  source: LocalPromptType.ProjectAssistant,
  content,
  writtenAt: '2026-04-17T00:00:00Z',
});

const PLANNED_CONTEXT_METADATA = {
  capturedAt: '2026-04-17T00:00:00Z',
  organizationId: 'org-1',
  projectId: 'proj-1',
  agentSessionId: 'agent-session-1',
  launchPlanId: 'plan-abc',
  launchStepId: 'step-xyz',
  launchStageId: 'stage-uvw',
  task: { id: 'task-123', title: 'Test task' },
  userComments: [],
  fileReferences: { resolved: [], unresolved: [] },
} as unknown as AgenticSession['contextMetadata'];

const makeLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }) as unknown as PromptTypeHandlerDeps['logger'];

const makeDeps = (logger: PromptTypeHandlerDeps['logger'] = makeLogger()): PromptTypeHandlerDeps =>
  ({ logger }) as unknown as PromptTypeHandlerDeps;

const noopDeps = makeDeps();

describe('featureSyncAnalyzeHandler', () => {
  it.each([false, true])(
    'includes the supplied readiness source snapshot (planned: %s)',
    (planned) => {
      const payload = {
        ...makePayload(),
        ...(planned
          ? { launchPlanId: 'plan-123', launchStepId: 'step-123', launchStageId: 'stage-123' }
          : {}),
      };
      const prompt = featureSyncAnalyzeHandler.buildPrompt(payload, {
        recentUserReplies: [],
        triggerParentMessageId: null,
        implementationReadinessSourceSnapshot: {
          runId: 'cli-run-123',
          focalEntityId: 'task-123',
          focalEntityType: 'TASK',
          sourceRevision: 'revision-123',
          capturedAt: '2026-09-22T22:00:00.000Z',
        },
      });
      expect(prompt).toMatchSnapshot();
    },
  );

  it('registers under the feature_sync_analyze prompt type', () => {
    expect(featureSyncAnalyzeHandler.promptType).toBe(LocalPromptType.FeatureSyncAnalyze);
  });

  it('exposes structural terminals and the typed readiness verdict', () => {
    const names = featureSyncAnalyzeHandler.submissionTools?.map((t) => t.name) ?? [];
    expect(names).toContain('submit_no_discrepancy');
    expect(names).toContain('submit_discrepancies');
    expect(names).toContain('submit_implementation_readiness');
    expect(names).toHaveLength(3);
  });

  it.each(readinessClassificationFixtures)(
    'pins the $expectedState readiness classification fixture: $id',
    ({ expectedState, label }) => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());

      expect(prompt).toContain(`**${expectedState} — ${label}.**`);
    },
  );

  it('forwards get_report_schema through additionalAllowedTools so the agent can look up the payload shape', () => {
    // The analyze prompt instructs the agent to call `get_report_schema` before
    // calling create_report (now via the run-scoped submission tool wrapper).
    // `create_report` is no longer a platform MCP tool so it must NOT appear in
    // the MCP additionalAllowedTools.
    const extras = featureSyncAnalyzeHandler.additionalAllowedTools ?? [];
    expect(extras).toContain('get_report_schema');
    expect(extras).not.toContain('create_report');
  });

  describe('prepare', () => {
    it('verifies a FEATURE seed without inheriting source plan participation', async () => {
      const result = await featureSyncAnalyzeHandler.prepare!(
        makeSession({
          entity: { entityType: 'TASK', entityId: 'task-123' },
          contextMetadata: PLANNED_CONTEXT_METADATA,
        }),
        {
          ...makePayload(),
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
        },
        noopDeps,
        {
          loadedEntityContext: {
            kind: 'entity',
            entity: { id: 'task-123', type: 'FEATURE' },
          },
          recentUserReplies: [],
          triggerParentMessageId: null,
        } as unknown as PromptTypeHandlerContext,
      );
      expect(result.payload).not.toHaveProperty('launchPlanId');
      expect(featureSyncAnalyzeHandler.buildPrompt(result.payload!)).toMatchSnapshot();
      expect(featureSyncAnalyzeHandler.buildStartingMessage?.(result.payload!)).toContain(
        'Verifying',
      );
    });
    it('uses the matching persisted Run task identity without caching it', async () => {
      const payload = makePayload('look for drift', 'task-123');
      const result = await featureSyncAnalyzeHandler.prepare!(makeSession(), payload, noopDeps);
      expect(result.payload.taskId).toBe('task-123');
      expect(result.payload).not.toHaveProperty('_taskId');
    });

    it('fails closed when the persisted Run task identity is missing', async () => {
      await expect(
        featureSyncAnalyzeHandler.prepare!(makeSession({ entity: null }), makePayload(), noopDeps),
      ).rejects.toThrow(/requires a persisted TASK Run entity/);
    });

    it('fails closed when the Turn payload task conflicts with the persisted Run entity', async () => {
      await expect(
        featureSyncAnalyzeHandler.prepare!(
          makeSession(),
          makePayload('', 'different-task'),
          noopDeps,
        ),
      ).rejects.toThrow(/conflicts with the persisted Run entity/);
    });

    it('reads launchPlanId/launchStepId/launchStageId off contextMetadata and propagates them onto the payload when all three are present', async () => {
      const session = makeSession({
        contextMetadata: {
          capturedAt: '2026-04-17T00:00:00Z',
          organizationId: 'org-1',
          projectId: 'proj-1',
          agentSessionId: 'agent-session-1',
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
          task: { id: 'task-123', title: 'Test task' },
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        } as unknown as AgenticSession['contextMetadata'],
      });
      const result = await featureSyncAnalyzeHandler.prepare!(session, makePayload(), noopDeps);
      expect(result.payload).toMatchObject({
        taskId: 'task-123',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });
    });

    it('does not stamp launch fields onto the payload when any of the three is missing from contextMetadata', async () => {
      const sessionWithOnlyPlanAndStep = makeSession({
        contextMetadata: {
          capturedAt: '2026-04-17T00:00:00Z',
          organizationId: 'org-1',
          projectId: 'proj-1',
          agentSessionId: 'agent-session-1',
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          task: { id: 'task-123', title: 'Test task' },
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        } as unknown as AgenticSession['contextMetadata'],
      });
      const result = await featureSyncAnalyzeHandler.prepare!(
        sessionWithOnlyPlanAndStep,
        makePayload(),
        noopDeps,
      );
      expect(result.payload.launchPlanId).toBeUndefined();
      expect(result.payload.launchStepId).toBeUndefined();
      expect(result.payload.launchStageId).toBeUndefined();
    });

    it('records launchPlanId/launchStepId/launchStageId and turnPath in the turn_starting log fields so production traces show the branch', async () => {
      const logger = makeLogger();
      const deps = makeDeps(logger);

      const plannedSession = makeSession({
        contextMetadata: {
          capturedAt: '2026-04-17T00:00:00Z',
          organizationId: 'org-1',
          projectId: 'proj-1',
          agentSessionId: 'agent-session-1',
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
          task: { id: 'task-123', title: 'Test task' },
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        } as unknown as AgenticSession['contextMetadata'],
      });
      await featureSyncAnalyzeHandler.prepare!(plannedSession, makePayload(), deps);
      await featureSyncAnalyzeHandler.prepare!(makeSession(), makePayload(), deps);

      const infoCalls = (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const [, plannedFields] = infoCalls[0] as [string, Record<string, unknown>];
      expect(plannedFields).toMatchObject({
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
        turnPath: 'planned',
      });
      const [, freeFields] = infoCalls[1] as [string, Record<string, unknown>];
      expect(freeFields).toMatchObject({
        launchPlanId: null,
        launchStepId: null,
        launchStageId: null,
        turnPath: 'free',
      });
    });

    it('stamps _hasResearch true and logs it when a project_assistant memo is present on the run', async () => {
      const logger = makeLogger();
      const deps = makeDeps(logger);
      const session = makeSession({ memos: [makeProjectAssistantMemo()] });
      const result = await featureSyncAnalyzeHandler.prepare!(session, makePayload(), deps);
      expect((result.payload as { _hasResearch?: boolean })._hasResearch).toBe(true);
      const infoCalls = (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const [, fields] = infoCalls[0] as [string, Record<string, unknown>];
      expect(fields).toMatchObject({ hasResearch: true });
    });

    it('stamps _hasResearch false when the run carries no project_assistant memo', async () => {
      const noMemo = await featureSyncAnalyzeHandler.prepare!(
        makeSession(),
        makePayload(),
        noopDeps,
      );
      expect((noMemo.payload as { _hasResearch?: boolean })._hasResearch).toBe(false);
      // A memo from a different phase must not trip the flag.
      const otherMemo = makeSession({
        memos: [
          { source: 'daily_session', content: 'unrelated', writtenAt: '2026-04-17T00:00:00Z' },
        ],
      });
      const result = await featureSyncAnalyzeHandler.prepare!(otherMemo, makePayload(), noopDeps);
      expect((result.payload as { _hasResearch?: boolean })._hasResearch).toBe(false);
    });

    it('logs the turn kind at info level so the flagged-path conversation is observable', async () => {
      const logger = makeLogger();
      const deps = makeDeps(logger);

      await featureSyncAnalyzeHandler.prepare!(makeSession(), makePayload(), deps);
      await featureSyncAnalyzeHandler.prepare!(
        makeSession(),
        makePayload('feature is wrong for discrepancy 1'),
        deps,
      );

      const infoCalls = (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(infoCalls).toHaveLength(2);

      const [initialEvent, initialFields] = infoCalls[0] as [string, Record<string, unknown>];
      expect(initialEvent).toBe('feature_sync_analyze.prepare.turn_starting');
      expect(initialFields).toMatchObject({
        runId: 'run-1',
        taskId: 'task-123',
        turnKind: 'initial',
        userMessageLength: 0,
      });

      const [followUpEvent, followUpFields] = infoCalls[1] as [string, Record<string, unknown>];
      expect(followUpEvent).toBe('feature_sync_analyze.prepare.turn_starting');
      expect(followUpFields).toMatchObject({
        runId: 'run-1',
        taskId: 'task-123',
        turnKind: 'follow_up',
      });
      expect((followUpFields['userMessageLength'] as number) > 0).toBe(true);
    });
  });

  describe('buildPrompt', () => {
    it('matches full Contract-aware reconciliation prompts for free and plan contexts', () => {
      expect(featureSyncAnalyzeHandler.buildPrompt(makePayload())).toMatchSnapshot('free task');
      expect(
        featureSyncAnalyzeHandler.buildPrompt({
          taskId: 'task-123',
          userMessage: '',
          launchPlanId: 'plan-abc',
          launchStepId: 'step-xyz',
          launchStageId: 'stage-uvw',
        }),
      ).toMatchSnapshot('planned task');
    });

    it('includes the task id and termination suffix and no longer weaves in the user message', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: 'check whether auth feature is drifting',
      });
      expect(prompt).toContain('task-123');
      expect(prompt).toContain('submit_no_discrepancy');
      expect(prompt).toContain('submit_discrepancies');
      expect(prompt).toMatch(/end each turn by calling one of the submission tools/i);
      // Injection moved to the resolver via addUserMessage — buildPrompt is
      // user-message-free now.
      expect(prompt).not.toContain('check whether auth feature is drifting');
      expect(prompt).not.toContain('User message for this turn');
    });

    it('always renders the task id line', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
      });
      expect(prompt).toContain('Current task id: task-123');
    });

    it('addUserMessage formats the message under the turn label, or null when unset', () => {
      expect(
        featureSyncAnalyzeHandler.addUserMessage({
          taskId: 'task-123',
          userMessage: 'check whether auth feature is drifting',
        }),
      ).toBe('\n\nUser message for this turn:\ncheck whether auth feature is drifting');
      expect(
        featureSyncAnalyzeHandler.addUserMessage({ taskId: 'task-123', userMessage: '' }),
      ).toBeNull();
    });

    it('directs the agent to use get_feature_sync_context for the ancestor walk', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toContain('get_feature_sync_context');
      expect(prompt).toContain('purpose: "maintenance"');
      expect(prompt).not.toContain('`get_work_item_type_guidance`');
      expect(prompt).toContain('`get_work_item_type_guidance_batch`');
      expect(prompt).toContain('typeKeys: [key]');
      expect(prompt).toContain('deduplicated array of 1–10 relevant encountered keys');
      expect(prompt).toContain('same purpose and relevant focal context');
      expect(prompt).toContain('request order');
      expect(prompt).toContain('Do not load the whole type catalog');
      expect(prompt).toContain('once per encountered type');
    });

    it('uses the canonical sections[requirements] collection and preserves durable record ids', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toContain('sections[requirements]');
      expect(prompt).toContain('content.sections["requirements"]');
      expect(prompt).toContain('ordered `records`');
      expect(prompt).toContain('stored durable `id`');
      expect(prompt).toMatch(/statement, group, or any citation slot/i);
      expect(prompt).not.toContain('requirementsStructured');
      expect(prompt).not.toContain('content-hash');
    });

    it('research lens: a project_assistant memo adds the research-lens section and keeps the mandatory ancestor walk (free variant)', async () => {
      const session = makeSession({ memos: [makeProjectAssistantMemo()] });
      const { payload } = await featureSyncAnalyzeHandler.prepare!(
        session,
        makePayload(),
        noopDeps,
      );
      const prompt = featureSyncAnalyzeHandler.buildPrompt(payload);
      // The research-lens section appears and points the agent at the
      // resolver-prepended "Context from prior phases" block, telling it to
      // read flagged entities through the sync lens.
      expect(prompt).toMatch(/Project Assistant research is already in context/i);
      expect(prompt).toContain('## Context from prior phases');
      expect(prompt).toMatch(/through the sync lens/i);
      // The mandatory live ancestor fetch is preserved regardless.
      expect(prompt).toContain('get_feature_sync_context');
    });

    it('uses the Project Assistant memo instead of requesting a direct source-conversation read', async () => {
      const session = makeSession({ memos: [makeProjectAssistantMemo()] });
      const { payload } = await featureSyncAnalyzeHandler.prepare!(
        session,
        makePayload(),
        noopDeps,
      );
      const prompt = featureSyncAnalyzeHandler.buildPrompt(payload);

      expect(prompt).toMatch(/Project Assistant research is already in context/i);
      expect(prompt).not.toContain('get_agent_session');
      expect(featureSyncAnalyzeHandler.additionalAllowedTools).not.toContain('get_agent_session');
    });

    it('research lens: absent when no project_assistant memo is present, while the ancestor walk stays (free variant)', async () => {
      const { payload } = await featureSyncAnalyzeHandler.prepare!(
        makeSession(),
        makePayload(),
        noopDeps,
      );
      const prompt = featureSyncAnalyzeHandler.buildPrompt(payload);
      expect(prompt).not.toMatch(/Project Assistant research is already in context/i);
      expect(prompt).toContain('get_feature_sync_context');
    });

    it('research lens: also added to the plan-task variant when a project_assistant memo is present', async () => {
      const session = makeSession({
        contextMetadata: PLANNED_CONTEXT_METADATA,
        memos: [makeProjectAssistantMemo()],
      });
      const { payload } = await featureSyncAnalyzeHandler.prepare!(
        session,
        makePayload(),
        noopDeps,
      );
      const prompt = featureSyncAnalyzeHandler.buildPrompt(payload);
      expect(prompt).toMatch(/Project Assistant research is already in context/i);
      // Still the plan variant, and still walking the ancestor chain.
      expect(prompt).toMatch(/Plan-context catch-up/i);
      expect(prompt).toContain('get_feature_sync_context');
    });

    it('names ancestors, siblings, and descendants as the three tree relations', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toMatch(/ancestors/i);
      expect(prompt).toMatch(/siblings/i);
      expect(prompt).toMatch(/descendants/i);
    });

    it('flags mechanism-shaped feature names but preserves concise technical capabilities', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toContain('Apply the same structural discipline to feature names');
      expect(prompt).toContain('`Send Updates over WebSockets`');
      expect(prompt).toContain('`Build SearchIndexService`');
      expect(prompt).toContain('`Normalize Events before Indexing`');
      expect(prompt).toContain('`Live Updates`');
      expect(prompt).toContain('`Feature Search`');
      expect(prompt).toContain('properly nested `Event Delivery` unchanged');
      expect(prompt).toContain('not a closed vocabulary');
    });

    it('bounds cross-subtree exploration and separately discovers visual artifacts', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toContain('search_features');
      expect(prompt).toContain('get_full_entity');
      expect(prompt).toContain('run one bounded unified_search');
      expect(prompt).toContain('proof of staleness is not required');
      expect(prompt).toContain('selected choices and approved proposals');
      expect(prompt).not.toContain('plan_search');
    });

    it('does not short-circuit the walk when proposals show a recent feature edit', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The old "fast-path" coupled `proposals` → `submit_no_discrepancy`
      // as a skip signal; it was removed because it was flaky and masked
      // real drift the moment a feature-edit proposal landed. The prompt
      // must still name `get_context`, but it must NOT instruct the agent
      // to skip the walk or submit based on recent proposal history.
      expect(prompt).toContain('get_context');
      expect(prompt).toContain("Begin with the current task's canonical focal projection");
      expect(prompt).toContain('only when those required topology or proposal fields are absent');
      expect(prompt).toContain('user explicitly requests a fresh read');
      expect(prompt).not.toMatch(/fast[- ]path/i);
      expect(prompt).not.toMatch(/without enumerating findings/i);
      // The prompt should explicitly tell the agent NOT to treat a recent
      // feature edit as a reason to skip the walk — prevents the flaky
      // short-circuit from creeping back in.
      expect(prompt).toMatch(/every analyze turn walks the tree/i);
    });

    it('flagged path: persists report with grouped decisions, references the report in text, and asks the user before submitting', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The ask step must explicitly forbid submitting on the first flagged
      // turn, and must direct the agent to persist a report that carries the
      // decisionGroups array. The text must NOT
      // duplicate those — the report is the single source of truth. Asserting
      // the report structure and the "do not duplicate" instruction together
      // keeps the test from passing when one part regresses.
      expect(prompt).toMatch(/never.*\`submit_discrepancies\`.*on the same turn/i);
      expect(prompt).toMatch(/FEATURE_SYNC_DECISION.*report is the single source of truth/i);
      expect(prompt).toContain('decisionGroups');
      expect(prompt).toContain('Each ordered choice');
      expect(prompt).toMatch(/must NOT enumerate|do NOT duplicate/i);
      expect(prompt).toMatch(/ask the user and wait/i);
    });

    it('flagged path: enumerate-and-ask is unconditional even if the user asks to skip', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The prompt must explicitly refuse direct user shortcuts like "just
      // call submit_discrepancies" — collected observation showed the agent
      // obeying such instructions and skipping the ask step.
      expect(prompt).toMatch(/unconditional/i);
      expect(prompt).toMatch(/even if the user/i);
    });

    it('flagged path: report carries agent-chosen reconciliation options, not a fixed verdict set', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The first turn used to force the user into "feature is wrong /
      // task is wrong / neither" — that fixed set has been retired in
      // favor of agent-chosen, action-shaped options like "update feature
      // X to ..." or "split feature Y into ...". The report carries the
      // structured data (decisionGroups array);
      // the text message references the report and must NOT duplicate those
      // contents. Pin the new shape so the old phrasing can't sneak back.
      expect(prompt).toContain('decisionGroups');
      expect(prompt).toContain('Each ordered choice');
      expect(prompt).toMatch(/must NOT enumerate|do NOT duplicate/i);
      expect(prompt).toMatch(/referen.{2,15} the report/i);
    });

    it('flagged path: couples chosen options to the generic edit_work_item proposal tool', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // Couple the chosen options to the proposal tool they route to —
      // independent of the retired verdict strings — so the test fails if
      // the routing or tool references are dropped.
      expect(prompt).toMatch(/option targets a feature or a task[\s\S]{0,400}edit_work_item/i);
    });

    it('pairs an accepted operational correction with its missing Contract in one review group', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toContain('## Contract candidates during reconciliation');
      expect(prompt).toMatch(
        /make the reconciliation option describe the two changes as one remedy/i,
      );
      expect(prompt).toMatch(
        /edit_work_item[\s\S]{0,200}create_work_item[\s\S]{0,200}same agent turn/i,
      );
      expect(prompt).toMatch(/do not draft either proposal before they choose/i);
      expect(prompt).toMatch(/Never split the Contract into detached cleanup/i);
    });

    it('flagged path: treats a discrepancy as resolved only after explicit user confirmation', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toMatch(/only after[\s\S]{0,200}user[\s\S]{0,80}confirm/i);
    });

    it('flagged path: forbids extending the submission-tool contract for this flow', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toMatch(/do not extend or invent new submission tools/i);
    });

    it('frames the agent to the user as a friendly pre-check, not as "the feature-sync analyze agent"', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The persona the user sees must be a friendly pre-check that
      // confirms the task is ready — not an "agent" narrating its own
      // process. Pinning the persona string prevents the opening line
      // from silently regressing to machine-speak.
      expect(prompt).toMatch(/friendly pre-check/i);
      expect(prompt).toMatch(/ready before planning/i);
      expect(prompt).not.toMatch(/you are the feature-sync analyze agent/i);
    });

    it('forbids naming tools, flow/turn/submission vocabulary, and meta-narration in user-visible text', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // Pin the two rules together (never name tools + never meta-narrate)
      // so a future edit that drops either half fails loudly. The tool
      // names must still appear elsewhere as agent-only call instructions,
      // but the prompt must explicitly tell the agent not to put them in
      // messages to the user.
      expect(prompt).toMatch(/never name the tools you use/i);
      expect(prompt).toMatch(/never meta-narrate/i);
      expect(prompt).toMatch(/submit_no_discrepancy[\s\S]{0,400}anything the user reads/i);
      expect(prompt).toMatch(/edit_work_item[\s\S]{0,400}anything the user reads/i);
    });

    it('uses the exact product-aware findings instruction', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      expect(prompt).toContain(
        'Write findings for a product-aware user, not for another agent . Explain what you noticed, why it matters, and what accepting the recommendation would change. Never expose tool names or implementation instructions such as requirementOps.add. Translate those mechanics into plain product language while preserving exact entity references and the meaning and order of the available choices..',
      );
    });

    it('reconciles owned and Feature-applicable MODE bundles through the existing review path', () => {
      const free = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      const planned = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });

      for (const prompt of [free, planned]) {
        expect(prompt).toContain(
          '## Project MODE freshness (bounded Feature-neighborhood extension)',
        );
        expect(prompt).toMatch(/Do not scan or enumerate the project-wide MODE catalog/i);
        expect(prompt).toMatch(/Structural ownership[\s\S]{0,500}globally runnable mode/i);
        expect(prompt).toMatch(
          /outbound MODE-to-Feature `DEPENDS_ON`[\s\S]{0,300}visited Feature or one of its ancestors/i,
        );
        expect(prompt).toMatch(/Structural parentage and `RELATED_TO` are non-filtering/i);
        expect(prompt).toMatch(
          /Exclude MODE work items that match neither ownership nor outbound/i,
        );
        expect(prompt).toMatch(/Deduplicate candidates by MODE identity/i);
        expect(prompt).toMatch(/Hydrate only the deduplicated MODE bundles needed/i);
        expect(prompt).toMatch(
          /stale MODE entry instructions or supporting files are targeted discrepancies/i,
        );
        expect(prompt).toMatch(
          /persist the decision report[\s\S]{0,300}wait for selection[\s\S]{0,300}wait for approval/i,
        );
        expect(prompt).toMatch(/Never bypass that sequence or write MODE content directly/i);
      }
    });

    it('carves out deliberately-general phrasing from the flag set, with a source-of-truth-contract exception', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The carve-out must be visible in the "What counts as something to
      // flag" register and must operate at flag-decision time — before any
      // reconciliation table or `edit_work_item` proposal. Pin
      // the language ("deliberately-general", at least one of the example
      // phrases, "breadth is the point") together with the contract
      // exception so neither half can regress on its own.
      expect(prompt).toMatch(/deliberately-general/i);
      expect(prompt).toMatch(/the X handler|the Y step|the message poster/);
      expect(prompt).toMatch(/breadth is the point/i);
      expect(prompt).toMatch(/flag-decision time/i);
      // Source-of-truth-contract carve-out exception keeps real contract
      // drift flaggable.
      expect(prompt).toMatch(/source[- ]of[- ]truth/i);
      expect(prompt).toMatch(/OpenAPI/);
      expect(prompt).toMatch(/typed schema/i);
    });

    it('calls out each failure-mode phrasing from the task as something the agent must not say', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // These four phrasings were observed leaking to the user and are
      // the concrete regressions the register rule must prevent; pinning
      // them as in-prompt anti-examples keeps the next edit honest.
      expect(prompt).toMatch(/park the flow on session startup/i);
      expect(prompt).toMatch(/route via edit_work_item per the flow's proposal rules/i);
      expect(prompt).toMatch(/loading the tool schemas/i);
      expect(prompt).toMatch(/enumerate siblings and potentially related features/i);
    });

    it('persist a FEATURE_SYNC report at completion: emits the report before the submission tool fires', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The new report-emission block must (a) call get_report_schema with
      // FEATURE_SYNC, (b) call create_report with the matching reportType,
      // PROJECT_VISIBLE audience, and a TASK PRIMARY entity for the active
      // task, and (c) order the report emission strictly before the
      // submission tool fires. Pin all four pieces together so a future
      // edit that loosens any one of them fails loudly.
      expect(prompt).toMatch(/Persist FEATURE_SYNC and FEATURE_SYNC_HANDOFF reports at completion/);
      expect(prompt).toMatch(/get_report_schema[\s\S]{0,200}FEATURE_SYNC/);
      expect(prompt).toMatch(/create_report[\s\S]{0,400}reportType[\s\S]{0,40}FEATURE_SYNC/);
      expect(prompt).toMatch(/audience[\s\S]{0,40}PROJECT_VISIBLE/);
      expect(prompt).toMatch(/entityType[\s\S]{0,40}TASK[\s\S]{0,200}relation[\s\S]{0,40}PRIMARY/);
      // The strict ordering is the load-bearing rule: report first, then
      // the terminating submission tool. The phrase "Only after both reports
      // are persisted" pinpoints the ordering language used in the prompt.
      expect(prompt).toMatch(
        /only after both reports are persisted[\s\S]{0,200}submit_no_discrepancy[\s\S]{0,40}submit_discrepancies/i,
      );
    });

    it('plan-task variant: composes a plan-task body without reparenting / re-home / feature-edit material', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });
      // The plan variant scopes the discrepancy table to task-scope items
      // and surfaces feature-side contract drift as narrative observations.
      // Crucially, this is composed positively: the variant must NOT contain
      // re-home / split-feature / rewrite-feature option language at all,
      // and must not name reparenting even as a suppressed/excluded category
      // (which is the failure mode that motivated this rewrite — naming the
      // excluded category was enough for the agent to surface re-home
      // commentary as observation prose).
      expect(prompt).toMatch(/Plan-context catch-up/i);
      expect(prompt).toMatch(/Narrative observations/i);
      expect(prompt).toMatch(/What counts as something to flag \(this turn\)/i);
      expect(prompt).toMatch(
        /get_context[\s\S]{0,160}entityType:\s*"TASK"[\s\S]{0,120}entityId:\s*"stage-uvw"/,
      );
      expect(prompt).not.toMatch(/get_plan_stage/);
      // Catch-up must use launchStageId as a TASK context read for the
      // and must NOT dump the plan/step ids — the agent previously grabbed
      // the wrong id from the dual-id dump in the prior version.
      expect(prompt).toMatch(/entityId:\s*"stage-uvw"/);
      expect(prompt).not.toContain('plan-abc');
      expect(prompt).not.toContain('step-xyz');
      // Reparenting tokens must be absent from the plan variant entirely —
      // not as directives, not as anti-examples, not as suppressed/excluded
      // categories. The variant is composed positively around task-scope
      // edits and narrative observations.
      expect(prompt).not.toMatch(/re-home/i);
      expect(prompt).not.toMatch(/reparenting/i);
      expect(prompt).not.toMatch(/split feature/i);
      expect(prompt).not.toMatch(/split-feature/i);
      expect(prompt).not.toMatch(/rewrite feature/i);
      expect(prompt).not.toMatch(/update feature/i);
      expect(prompt).not.toMatch(/parent-feature/i);
      expect(prompt).not.toMatch(/natural home/i);
      expect(prompt).not.toMatch(/cross-subtree placement/i);
      expect(prompt).not.toMatch(/feature-tree restructure/i);
      expect(prompt).not.toMatch(/option targets a feature/i);
      // The generic edit_work_item replaced the per-type edit tools, so
      // the plan variant can no longer be pinned by counting a
      // feature-specific tool name. The invariant that survives: every
      // edit_work_item directive in this variant routes a *task* target —
      // the reconciliation step couples the tool to "option targets a
      // task", and no feature-targeted routing language exists (asserted
      // above via the absent re-home / rewrite-feature / update-feature
      // tokens).
      expect(prompt).toMatch(/option targets a task[\s\S]{0,400}edit_work_item/i);
      const retiredToolCount = (prompt.match(/edit_feature|edit_task(?!s)/g) ?? []).length;
      expect(retiredToolCount).toBe(0);
      // No-flag terminal turn splits on whether observations were surfaced.
      // No-observations branch still auto-advances without acknowledgement.
      // Observations-present branch must explicitly forbid submitting on the
      // same turn and direct the agent to wait for the user — the prior
      // unconditional auto-advance hid feature-side drift from the user by
      // shipping the conversation forward before they saw the observation.
      expect(prompt).toMatch(/When nothing is flaggable \(terminal turn\)/i);
      expect(prompt).toMatch(
        /No flags, no observations[\s\S]{0,400}do \*\*not\*\* ask the user to confirm, acknowledge, or approve/i,
      );
      expect(prompt).toMatch(
        /No flags, observations present[\s\S]{0,400}do \*\*not\*\* call[\s\S]{0,200}submit_no_discrepancy/i,
      );
      expect(prompt).toMatch(/No flags, observations present[\s\S]{0,400}wait for the user/i);
      // Follow-up section: the next analyze turn after observations turns an
      // affirmative reply into a terminal submit_no_discrepancy without
      // re-walking the feature tree.
      expect(prompt).toMatch(/Follow-up after observations/i);
      expect(prompt).toMatch(/affirmative[\s\S]{0,200}confirmation/i);
      expect(prompt).toMatch(/do \*\*not\*\* re-walk the feature tree/i);
      expect(prompt).toMatch(/Follow-up after observations[\s\S]{0,800}submit_no_discrepancy/i);
      // Proposal gate anchors the "any surfaced finding blocks auto-advance"
      // invariant near the top of the body so future edits cannot regress it
      // by dropping the rule from a single section.
      expect(prompt).toMatch(/Proposal gate \(this turn\)/i);
      expect(prompt).toMatch(
        /drafts any proposal[\s\S]{0,400}do \*\*not\*\* call[\s\S]{0,200}submit_no_discrepancy/i,
      );
    });

    it('free-task variant: prompt is unchanged when any of the three launch fields is absent', () => {
      const freePrompt = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
      });
      const onlyPlan = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
      });
      const planAndStep = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
      });
      const planAndStage = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStageId: 'stage-uvw',
      });
      // Free-task path must remain byte-identical for any partial set of
      // launch fields — the plan variant requires all three, so any
      // missing field yields the free body.
      expect(onlyPlan).toBe(freePrompt);
      expect(planAndStep).toBe(freePrompt);
      expect(planAndStage).toBe(freePrompt);
      // And the free prompt must not mention the plan-task sections.
      expect(freePrompt).not.toMatch(/Plan-context catch-up/i);
      expect(freePrompt).not.toMatch(/Narrative observations/i);
      expect(freePrompt).not.toMatch(/get_plan_stage/);
    });

    it('persist a FEATURE_SYNC report at completion: payload arrays mirror the rendered table and options, empty when nothing was flagged', () => {
      const prompt = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      // The payload must mirror the user-facing table 1:1: discrepancies =
      // table rows, reconciliationOptions = numbered options. Pin the
      // mirroring rule plus the empty-arrays-on-no-flag rule together so
      // neither half can drift on its own.
      expect(prompt).toMatch(/discrepancies[\s\S]{0,200}mirror[\s\S]{0,200}rows/i);
      expect(prompt).toMatch(/reconciliationOptions[\s\S]{0,200}mirror[\s\S]{0,200}numbered/i);
      expect(prompt).toMatch(/empty[\s\S]{0,80}nothing was flagged/i);
    });

    it('persist a FEATURE_SYNC_DECISION report on every ask turn: report is the single source of truth (free + plan)', () => {
      const free = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      const plan = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });
      for (const prompt of [free, plan]) {
        // Full snapshots cover both prompts; these assertions protect ask-only semantics.
        expect(prompt).toMatch(/get_report_schema[\s\S]{0,200}FEATURE_SYNC_DECISION/);
        expect(prompt).toMatch(
          /create_report[\s\S]{0,400}reportType[\s\S]{0,80}FEATURE_SYNC_DECISION/,
        );
        expect(prompt).toMatch(
          /FEATURE_SYNC_DECISION[\s\S]{0,2000}audience[\s\S]{0,40}PROJECT_VISIBLE/,
        );
        expect(prompt).toMatch(
          /entityType[\s\S]{0,40}TASK[\s\S]{0,200}relation[\s\S]{0,40}PRIMARY/,
        );
        expect(prompt).toContain('schemaVersion: 2');
        expect(prompt).toContain('decisionGroups');
        expect(prompt).toContain('exactly one explicit');
        expect(prompt).toContain('no ordinal prefixes');
        expect(prompt).toContain('Shared multi-entity decision');
        expect(prompt).toContain('Independent decisions with overlapping entities');
        expect(prompt).toContain('one ordinary response');
        expect(prompt).toContain('separate approval');
        expect(prompt).toMatch(/Do not draft any tool-level proposal up front/i);
        // The decision report rides alongside the ask, not in place of it —
        // submission tools must not fire on the ask turn.
        expect(prompt).toMatch(/ask the user and wait/i);
      }
    });

    it('analyze waits for the user to accept a drafted proposal and names the pre-canned approval message (free + plan)', () => {
      const free = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      const plan = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });
      for (const prompt of [free, plan]) {
        // The bug: analyze submitted a terminal in the same turn it drafted a
        // fix, before the user accepted it — the backend checks proposals for
        // acceptance and rejects the advance. The fix: analyze must base its
        // terminal on the user's reply, and the authoritative acceptance signal
        // is the pre-canned message ui-common posts when all proposals are
        // approved. Pin the section, the wait, and the literal together.
        expect(prompt).toMatch(/Wait for the user to accept a proposal before advancing/i);
        expect(prompt).toContain('All proposals approved, ready for the next phase');
        expect(prompt).toMatch(/DRAFT until the user approves it/i);
        expect(prompt).toMatch(
          /Ordinarily[\s\S]{0,200}wait[\s\S]{0,80}without calling a submission tool/i,
        );
        // A verbal "looks good" is explicitly not acceptance.
        expect(prompt).toMatch(/a verbal "looks good"[\s\S]{0,80}not[\s\S]{0,40}approval/i);
      }
    });

    it('sole fulfilledBy enrichment drafts without pre-confirmation and enters review (free + plan)', () => {
      const free = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      const plan = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });
      for (const prompt of [free, plan]) {
        expect(prompt).toMatch(/complete set of work[\s\S]{0,200}one `requirementOps` `update`/i);
        expect(prompt).toMatch(/draft that one enrichment without first asking/i);
        expect(prompt).toMatch(
          /call `submit_discrepancies` on the same turn[\s\S]{0,120}proposal-review path/i,
        );
        expect(prompt).toMatch(/Never call `submit_no_discrepancy` on that turn/i);
        expect(prompt).toMatch(/pending, reviewable proposal/i);
      }
    });

    it('mixed findings retain pre-proposal reconciliation in free and plan prompts', () => {
      const free = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      const plan = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });
      for (const prompt of [free, plan]) {
        expect(prompt).toMatch(
          /If the proposed mutation set is mixed in any way[\s\S]{0,200}do not draft[\s\S]{0,200}wait for the user's selection/i,
        );
        expect(prompt).toMatch(
          /no other requirement operation, entity edit, Contract proposal, actionable discrepancy/i,
        );
        expect(prompt).toMatch(/Outside that sole-enrichment exception[\s\S]{0,100}unconditional/i);
      }
    });

    it('terminal-eligibility: advance only on the user acceptance turn, never on the drafting turn (free + plan)', () => {
      const free = featureSyncAnalyzeHandler.buildPrompt(makePayload());
      const plan = featureSyncAnalyzeHandler.buildPrompt({
        taskId: 'task-123',
        userMessage: '',
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      });
      for (const prompt of [free, plan]) {
        // Step 4 used to treat a verbal confirmation as resolution. Now it
        // advances only on the turn that carries the user's acceptance — the
        // pre-canned literal or a clear approval — and submit_no_discrepancy
        // covers in-conversation resolution while submit_discrepancies covers
        // remaining items for the separate review surface.
        expect(prompt).toMatch(
          /Advance only on the turn that carries the user's acceptance[\s\S]{0,200}All proposals approved, ready for the next phase/i,
        );
        expect(prompt).toMatch(/Never advance on the same turn you drafted a proposal/i);
        expect(prompt).toMatch(/never treat a verbal "looks good" as approval/i);
        expect(prompt).toMatch(
          /resolved in-conversation \(accepted proposals or dismissals\)[\s\S]{0,40}submit_no_discrepancy/i,
        );
      }
    });
  });
});

describe('featureSyncIterateHandler', () => {
  it('matches the full Contract-aware revision prompt', () => {
    expect(featureSyncIterateHandler.buildPrompt(makeIteratePayload())).toMatchSnapshot();
  });

  it('registers under the feature_sync_iterate prompt type', () => {
    expect(featureSyncIterateHandler.promptType).toBe(LocalPromptType.FeatureSyncIterate);
  });

  it('exposes submit_resolved and submit_revised as submission tools', () => {
    const names = featureSyncIterateHandler.submissionTools?.map((t) => t.name) ?? [];
    expect(names).toContain('submit_resolved');
    expect(names).toContain('submit_revised');
    expect(names).toHaveLength(2);
  });

  it('buildPrompt renders the termination suffix; addUserMessage owns the user message', () => {
    const payload = makeIteratePayload({ userMessage: 'drop the third discrepancy, it was wrong' });
    const prompt = featureSyncIterateHandler.buildPrompt(payload);
    expect(prompt).not.toContain('drop the third discrepancy');
    expect(prompt).toContain('submit_resolved');
    expect(prompt).toContain('submit_revised');
    expect(prompt).toMatch(/end each turn by calling one of the submission tools/i);
    expect(featureSyncIterateHandler.addUserMessage(payload)).toBe(
      '\n\nUser message for this turn:\ndrop the third discrepancy, it was wrong',
    );
  });

  it('renders the typed discrepancies as an Outstanding items section above the Internal mechanics heading', () => {
    const prompt = featureSyncIterateHandler.buildPrompt(
      makeIteratePayload({
        discrepancies: [
          makeDiscrepancy({
            summary: 'Auth feature missing',
            rationale: 'no impl in auth dir',
            entityType: FeatureSyncDiscrepancyEntityTypeEnum.Feature,
            entityId: 'feat-1',
            proposal: 'rewrite the feature description to drop the auth claim',
          }),
          makeDiscrepancy({
            summary: 'Task scope drifted',
            rationale: 'tasks/foo.ts no longer reflects the AC',
            entityType: FeatureSyncDiscrepancyEntityTypeEnum.Task,
            entityId: 'task-2',
          }),
        ],
        userMessage: '',
      }),
    );
    // Section heading lives above the Internal mechanics block so the agent
    // sees outstanding items as the substance of the turn, not a footnote.
    const outstandingIdx = prompt.indexOf('## Outstanding items');
    const mechanicsIdx = prompt.indexOf('## Internal mechanics');
    expect(outstandingIdx).toBeGreaterThan(-1);
    expect(mechanicsIdx).toBeGreaterThan(-1);
    expect(outstandingIdx).toBeLessThan(mechanicsIdx);
    // Each row carries the typed fields plus a clickable mention.
    expect(prompt).toContain('Auth feature missing');
    expect(prompt).toContain('no impl in auth dir');
    expect(prompt).toContain('@[feature:feat-1|Auth feature missing]');
    expect(prompt).toContain('rewrite the feature description to drop the auth claim');
    expect(prompt).toContain('Task scope drifted');
    expect(prompt).toContain('@[task:task-2|Task scope drifted]');
    // Intro stops referencing the implicit conversation history and points
    // the agent at the rendered list.
    expect(prompt).toContain('listed under "Outstanding items"');
    expect(prompt).not.toContain('A prior turn surfaced a few things to flag');
  });

  it('instructs the agent not to re-walk the feature tree by default', () => {
    const prompt = featureSyncIterateHandler.buildPrompt(makeIteratePayload());
    expect(prompt).toMatch(/do not re-walk the feature tree/i);
    // The iterate turn stays context-light by design: the tools that would
    // trigger a full tree-walk (`get_feature_sync_context`, `search_features`)
    // must not appear as directives. `get_full_entity` / `get_context` are
    // still allowed as narrow re-verification escape hatches.
    expect(prompt).not.toContain('get_feature_sync_context');
    expect(prompt).not.toContain('search_features');
  });

  it('keeps a Contract companion coupled when the user revises the remediation', () => {
    const prompt = featureSyncIterateHandler.buildPrompt(makeIteratePayload());
    expect(prompt).toMatch(/preserve them as one coupled remedy/i);
    expect(prompt).toMatch(/Do not split the Contract into a detached follow-up item/i);
  });

  it('treats one selected choice as the complete disposition of its decision group', () => {
    const prompt = featureSyncIterateHandler.buildPrompt(makeIteratePayload());
    expect(prompt).toContain('add the requirement and a Contract');
    expect(prompt).toContain('add only the requirement');
    expect(prompt).toContain('make no change');
    expect(prompt).toMatch(
      /selecting "add only the requirement" resolves the whole group and rejects the Contract alternative/i,
    );
    expect(prompt).toMatch(/Accept the selected choice and reject every unselected sibling/i);
    expect(prompt).toMatch(/Continue from only the selected disposition/i);
    expect(prompt).toMatch(/Never reinterpret a rejected alternative as deferred work/i);
    expect(prompt).toMatch(/reopen it for discussion/i);
    expect(prompt).toMatch(/derive a new obligation from it/i);
    expect(prompt).toMatch(/unless a separate decision group explicitly asks/i);
  });

  it('mirrors the analyze prompt scope rule for any user-triggered re-verification', () => {
    const prompt = featureSyncIterateHandler.buildPrompt(makeIteratePayload());
    // The iterate turn shares the flag-decision scope rule: deliberately-
    // general phrasing where today's code has one specific instance is
    // not a discrepancy, except when verifying against a source-of-truth
    // contract. This keeps an iterate-time re-verify consistent with
    // analyze-time judgment.
    expect(prompt).toMatch(/deliberately-general/i);
    expect(prompt).toMatch(/breadth is the point/i);
    expect(prompt).toMatch(/source[- ]of[- ]truth/i);
    expect(prompt).toMatch(/OpenAPI/);
  });

  it('carries the same user-facing register rules as the analyze prompt', () => {
    const prompt = featureSyncIterateHandler.buildPrompt(makeIteratePayload());
    // Iterate turns share the user surface with analyze, so the persona
    // and the prohibition on naming tools / meta-narrating must apply
    // here too. Pinning both halves keeps the iterate tone from drifting
    // away from the analyze tone on a future edit.
    expect(prompt).toMatch(/friendly pre-check/i);
    expect(prompt).toMatch(/never name the tools you use/i);
    expect(prompt).toMatch(/never meta-narrate/i);
    expect(prompt).toMatch(/submit_resolved[\s\S]{0,400}anything the user reads/i);
    expect(prompt).toMatch(/submit_revised[\s\S]{0,400}anything the user reads/i);
  });

  it('judges the user reply: names the auto-advance literal as a strong signal but does not fire only on it', () => {
    const prompt = featureSyncIterateHandler.buildPrompt(makeIteratePayload());
    // "The user has acted" is the iterate agent's judgement on the reply, not
    // a fixed sentinel match. The prompt must (a) name the deterministic
    // auto-advance literal as a strong approval signal, (b) also accept
    // arbitrary affirmatives in the user's own words, and (c) explicitly warn
    // against both failure modes — firing only on the literal, or ignoring it.
    expect(prompt).toContain('All proposals approved, ready for the next phase');
    expect(prompt).toMatch(/not a fixed sentinel match/i);
    expect(prompt).toMatch(/do not fire the terminal only on a literal match/i);
    expect(prompt).toMatch(
      /affirmative[\s\S]{0,200}submit_resolved|submit_resolved[\s\S]{0,200}affirmative/i,
    );
    // The three judgement branches stay distinct: approval → submit_resolved,
    // revision → submit_revised, otherwise keep talking.
    expect(prompt).toMatch(/Approval[\s\S]{0,80}submit_resolved/i);
    expect(prompt).toMatch(/Revision[\s\S]{0,80}submit_revised/i);
    expect(prompt).toMatch(/keep talking|do not force a terminal/i);
  });
});

describe('feature-sync submission tools', () => {
  const makeCtx = (args: Record<string, unknown>) => ({ runId: 'run-1', args });
  const makeRun = (
    entityType: 'TASK' | 'FEATURE' = 'TASK',
    promptType: LocalPromptType = LocalPromptType.FeatureSyncAnalyze,
  ) =>
    ({
      entity: { entityType: 'TASK', entityId: 'task-123' },
      workItemType: entityType === 'FEATURE' ? 'FEATURE' : 'STANDARD',
      session: { promptType },
      normalizeImplementationReadinessForSubmission: (disposition: unknown) => disposition,
    }) as unknown as Run;

  it('submit_no_discrepancy produces a NO_DISCREPANCY action for FEATURE verification', async () => {
    const result = await submitNoDiscrepancyTool.execute({
      ...makeCtx({}),
      run: makeRun('FEATURE'),
    });
    expect(result).toEqual({ action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY });
  });

  it('submit_no_discrepancy rejects TASK runs so pre-planning cannot bypass readiness', () => {
    expect(() => submitNoDiscrepancyTool.execute({ ...makeCtx({}), run: makeRun('TASK') })).toThrow(
      /structural no-discrepancy action/,
    );
  });

  it('submit_no_discrepancy remains available for FEATURE verification', async () => {
    const result = await submitNoDiscrepancyTool.execute({
      ...makeCtx({}),
      run: makeRun('TASK', LocalPromptType.PlanShapingFeatureSyncAnalyze),
    });
    expect(result).toEqual({ action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY });
  });

  it('submit_no_discrepancy fails closed without an active Run', () => {
    expect(() => submitNoDiscrepancyTool.execute(makeCtx({}))).toThrow(/requires an active Run/);
  });

  it('submit_resolved produces a RESOLVED action with no payload', async () => {
    const result = await submitResolvedTool.execute(makeCtx({}));
    expect(result).toEqual({ action: FEATURE_SYNC_ACTIONS.RESOLVED });
  });

  it('submit_discrepancies wraps the array in the action payload', async () => {
    const result = await submitDiscrepanciesTool.execute(
      makeCtx({
        discrepancies: [{ summary: 'feature missing', rationale: 'no impl in auth dir' }],
      }),
    );
    expect(result).toEqual({
      action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
      payload: {
        discrepancies: [{ summary: 'feature missing', rationale: 'no impl in auth dir' }],
      },
    });
  });

  it('submit_revised wraps the array in the action payload', async () => {
    const result = await submitRevisedTool.execute(
      makeCtx({
        discrepancies: [{ summary: 'revised gap', rationale: 'follow-up after user feedback' }],
      }),
    );
    expect(result).toEqual({
      action: FEATURE_SYNC_ACTIONS.REVISED,
      payload: {
        discrepancies: [{ summary: 'revised gap', rationale: 'follow-up after user feedback' }],
      },
    });
  });

  it('submit_implementation_readiness emits a typed clear or review action', async () => {
    const sourceSnapshot = {
      runId: 'run-1',
      focalEntityId: 'task-123',
      focalEntityType: 'TASK',
      sourceRevision: 'sha256:source-1',
      capturedAt: '2026-09-17T20:00:00.000Z',
    };
    const clear = await submitReadinessTool.execute({
      ...makeCtx({
        disposition: {
          state: 'CLEAR',
          sourceSnapshot,
          finding: null,
          resolution: { kind: 'NONE' },
        },
      }),
      run: makeRun(),
    });
    expect(clear).toEqual({
      action: FEATURE_SYNC_ACTIONS.READINESS_CLEAR,
      payload: {
        disposition: {
          state: 'CLEAR',
          sourceSnapshot,
          finding: null,
          resolution: { kind: 'NONE' },
        },
      },
    });

    const review = await submitReadinessTool.execute({
      ...makeCtx({
        disposition: {
          state: 'REVIEW_REQUIRED',
          sourceSnapshot,
          finding: {
            affectedSourceContext: 'Task and service boundary',
            unresolvedDecision: 'Which service owns the state?',
            consequentialInventionRisk: 'Implementation could place state in the wrong service.',
            boundedEvidence: [
              { category: 'behavior', statement: 'The source leaves two observable outcomes.' },
            ],
            answerKind: 'Name the owning service.',
          },
          resolution: { kind: 'NONE' },
        },
      }),
      run: makeRun(),
    });
    expect(review).toEqual(
      expect.objectContaining({
        action: FEATURE_SYNC_ACTIONS.READINESS_REVIEW_REQUIRED,
        payload: expect.objectContaining({
          disposition: expect.objectContaining({ state: 'REVIEW_REQUIRED' }),
        }),
      }),
    );
  });

  it('submit_implementation_readiness fails closed without an active Run', () => {
    expect(() =>
      submitReadinessTool.execute(
        makeCtx({
          disposition: {
            state: 'CLEAR',
            sourceSnapshot: {
              runId: 'run-1',
              focalEntityId: 'task-123',
              focalEntityType: 'TASK',
              sourceRevision: 'sha256:source-1',
              capturedAt: '2026-09-17T20:00:00.000Z',
            },
            finding: null,
            resolution: { kind: 'NONE' },
          },
        }),
      ),
    ).toThrow(/requires an active Run/);
  });

  it('classifies readiness parser failures as correctable submission errors', () => {
    expect(() =>
      submitReadinessTool.execute({
        ...makeCtx({
          disposition: {
            state: 'CLEAR',
            sourceSnapshot: {
              runId: 'run-1',
              focalEntityId: 'task-123',
              focalEntityType: 'TASK',
              sourceRevision: 'sha256:source-1',
              capturedAt: '2026-09-17T20:00:00.000Z',
            },
            finding: null,
            resolution: { kind: 'INVALID' },
          },
        }),
        run: makeRun(),
      }),
    ).toThrow(SubmissionToolCorrectableError);
  });

  it('keeps DISMISSED reserved for the confirmed user action', () => {
    expect(() =>
      submitReadinessTool.execute({
        ...makeCtx({
          disposition: {
            state: 'DISMISSED',
            sourceSnapshot: {
              runId: 'run-1',
              focalEntityId: 'task-123',
              focalEntityType: 'TASK',
              sourceRevision: 'sha256:source-1',
              capturedAt: '2026-09-17T20:00:00.000Z',
            },
            finding: {
              affectedSourceContext: 'Task and service boundary',
              unresolvedDecision: 'Which service owns the state?',
              consequentialInventionRisk: 'State could be written by the wrong service.',
              boundedEvidence: [{ category: 'ownership', statement: 'Ownership is not settled.' }],
              answerKind: 'Name the owning service.',
            },
            resolution: {
              kind: 'DISMISSED',
              runId: 'run-1',
              sourceRevision: 'sha256:source-1',
              resolvedAt: '2026-09-17T20:01:00.000Z',
            },
          },
        }),
        run: makeRun(),
      }),
    ).toThrow(SubmissionToolCorrectableError);
  });

  it('submit_discrepancies throws when discrepancies are absent rather than shipping a payload the server would reject', () => {
    expect(() => submitDiscrepanciesTool.execute(makeCtx({}))).toThrow(
      /submit_discrepancies.*non-empty discrepancies/,
    );
  });

  it('submit_revised throws when discrepancies are absent', () => {
    expect(() => submitRevisedTool.execute(makeCtx({}))).toThrow(
      /submit_revised.*non-empty discrepancies/,
    );
  });

  it('ordinary feature-sync submit_revised still rejects an empty array', () => {
    expect(() => submitRevisedTool.execute(makeCtx({ discrepancies: [] }))).toThrow(
      /submit_revised.*non-empty discrepancies/,
    );
  });

  it('submit_discrepancies throws when discrepancies is an empty array', () => {
    expect(() => submitDiscrepanciesTool.execute(makeCtx({ discrepancies: [] }))).toThrow(
      /non-empty discrepancies/,
    );
  });

  it('declares a JSON Schema matching the server contract fields', () => {
    const schema = submitDiscrepanciesTool.inputSchema as {
      required?: string[];
      properties: { discrepancies: { items: { required: string[] } } };
    };
    expect(schema.required).toContain('discrepancies');
    expect(schema.properties.discrepancies.items.required).toEqual(
      expect.arrayContaining(['summary', 'rationale']),
    );
  });

  it('advertises the complete implementation-readiness finding and resolution shapes', () => {
    expect(submitReadinessTool.inputSchema).toMatchObject({
      properties: {
        disposition: {
          required: ['state', 'sourceSnapshot', 'finding', 'resolution'],
          properties: {
            finding: {
              anyOf: [
                { type: 'null' },
                {
                  required: [
                    'affectedSourceContext',
                    'unresolvedDecision',
                    'consequentialInventionRisk',
                    'boundedEvidence',
                    'answerKind',
                  ],
                  properties: {
                    boundedEvidence: {
                      items: {
                        properties: {
                          category: { enum: expect.arrayContaining(['ownership']) },
                        },
                      },
                    },
                  },
                },
              ],
            },
            resolution: {
              oneOf: [
                { properties: { kind: { const: 'NONE' } } },
                { properties: { kind: { enum: ['DISMISSED'] } } },
              ],
            },
          },
        },
      },
    });
  });
});

describe('isRunContextMetadata launch-field validation', () => {
  const validBase = {
    capturedAt: '2026-04-17T00:00:00Z',
    organizationId: 'org-1',
    projectId: 'proj-1',
    agentSessionId: 'agent-session-1',
    userComments: [] as string[],
    fileReferences: { resolved: [] as string[], unresolved: [] as string[] },
  };

  it('accepts metadata that omits both launch fields entirely', () => {
    expect(isRunContextMetadata({ ...validBase })).toBe(true);
  });

  it('accepts metadata with all three launch fields set to non-empty strings', () => {
    expect(
      isRunContextMetadata({
        ...validBase,
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      }),
    ).toBe(true);
  });

  it('rejects an empty-string launchPlanId', () => {
    expect(
      isRunContextMetadata({
        ...validBase,
        launchPlanId: '',
      }),
    ).toBe(false);
  });

  it('rejects a whitespace-only launchStepId', () => {
    expect(
      isRunContextMetadata({
        ...validBase,
        launchStepId: '   ',
      }),
    ).toBe(false);
  });

  it('rejects an empty-string launchStageId', () => {
    expect(
      isRunContextMetadata({
        ...validBase,
        launchStageId: '',
      }),
    ).toBe(false);
  });

  it('rejects a non-string launchPlanId', () => {
    expect(
      isRunContextMetadata({
        ...validBase,
        launchPlanId: 42,
      }),
    ).toBe(false);
  });

  it('rejects a non-string launchStepId', () => {
    expect(
      isRunContextMetadata({
        ...validBase,
        launchStepId: { id: 'step-xyz' },
      }),
    ).toBe(false);
  });

  it('rejects a non-string launchStageId', () => {
    expect(
      isRunContextMetadata({
        ...validBase,
        launchStageId: 99,
      }),
    ).toBe(false);
  });
});

describe('feature-sync registry wiring', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('registers both handlers under their promptType keys', async () => {
    expect(registry.get(LocalPromptType.FeatureSyncAnalyze)?.promptType).toBe(
      LocalPromptType.FeatureSyncAnalyze,
    );
    expect(registry.get(LocalPromptType.FeatureSyncIterate)?.promptType).toBe(
      LocalPromptType.FeatureSyncIterate,
    );
  });

  it('keeps edit_plan off analyze and iterate tool surfaces', () => {
    for (const handler of [featureSyncAnalyzeHandler, featureSyncIterateHandler]) {
      expect(handler.additionalAllowedTools ?? []).not.toContain('edit_plan');
    }
  });

  it('does not resolve typo or sibling-shaped promptTypes to a feature-sync handler', async () => {
    expect(registry.get('feature_sync')).toBeUndefined();
    expect(registry.get('FEATURE_SYNC_ANALYZE')).toBeUndefined();
    expect(registry.get('feature_sync_resolve')).toBeUndefined();
  });
});

describe('governing disagreements in both Feature Sync branches', () => {
  it.each([false, true])(
    'retains review choices and resolution handoffs with plan=%s',
    (planned) => {
      const prompt = buildAnalyzePrompt({
        taskId: '11111111-1111-4111-8111-111111111111',
        ...(planned
          ? {
              launchPlanId: '22222222-2222-4222-8222-222222222222',
              launchStepId: '33333333-3333-4333-8333-333333333333',
              launchStageId: '44444444-4444-4444-8444-444444444444',
            }
          : {}),
      });
      expect(prompt).toContain(reconciliationResponsibility);
      expect(prompt.indexOf(reconciliationResponsibility)).toBeGreaterThan(
        prompt.indexOf('## When something is off'),
      );
      expect(prompt).toContain('a disagreement the user resolved and what they chose');
      expect(prompt).toContain('Diagram Elements');
      expect(prompt).toContain('proof of staleness is not required');
      expect(prompt).toContain('selected choices and approved proposals');
    },
  );
});
