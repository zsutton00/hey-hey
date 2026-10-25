import { describe, expect, it } from 'vitest';
import {
  LocalPromptType,
  type FeatureSyncDiscrepancy,
} from '../../../shared/agent-bridge-contract/generated/api';
import type {
  LocalPlanShapingFeatureSyncAnalyzePromptPayload,
  LocalPlanShapingFeatureSyncDiscussPromptPayload,
  LocalPlanShapingFeatureSyncIteratePromptPayload,
} from '../../../shared/agent-bridge-contract/runtime-types';
import { ReportAudience, ReportType } from '../../../shared/api/index';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import { FEATURE_SYNC_ACTIONS } from '../../feature-sync/submission-tools';
import { planShapingFeatureSyncAnalyzeHandler } from '../analyze.handler';
import { planShapingFeatureSyncIterateHandler } from '../iterate.handler';

const makeAnalyzePayload = (
  overrides: Partial<LocalPlanShapingFeatureSyncAnalyzePromptPayload> = {},
): LocalPlanShapingFeatureSyncAnalyzePromptPayload => ({
  planId: 'plan-123',
  designDocId: 'design-456',
  userMessage: '',
  ...overrides,
});

const makeDiscrepancy = (
  overrides: Partial<FeatureSyncDiscrepancy> = {},
): FeatureSyncDiscrepancy => ({
  summary: 'feature drift',
  rationale: 'the feature tree omits a capability the design doc names',
  ...overrides,
});

const makeIteratePayload = (
  overrides: Partial<LocalPlanShapingFeatureSyncIteratePromptPayload> = {},
): LocalPlanShapingFeatureSyncIteratePromptPayload => ({
  planId: 'plan-123',
  designDocId: 'design-456',
  discrepancies: [makeDiscrepancy({ id: 'fs-1' })],
  decisions: [],
  ...overrides,
});

const makeDiscussPayload = (
  overrides: Partial<LocalPlanShapingFeatureSyncDiscussPromptPayload> = {},
): LocalPlanShapingFeatureSyncDiscussPromptPayload => ({
  planId: 'plan-123',
  designDocId: 'design-456',
  discrepancies: [makeDiscrepancy()],
  userMessage: 'what did you flag?',
  ...overrides,
});

describe('planShapingFeatureSyncAnalyzeHandler', () => {
  it('registers under the plan_shaping_feature_sync_analyze prompt type', () => {
    expect(planShapingFeatureSyncAnalyzeHandler.promptType).toBe(
      LocalPromptType.PlanShapingFeatureSyncAnalyze,
    );
  });

  it('runs on the persisted provider session and declares the decision report variant', () => {
    expect(planShapingFeatureSyncAnalyzeHandler.runnerKind).toBe('provider_session');
    expect(planShapingFeatureSyncAnalyzeHandler.reports).toEqual([
      {
        reportType: ReportType.FeatureSyncDecision,
        audience: ReportAudience.ProjectVisible,
        required: false,
      },
    ]);
  });

  it('forwards get_report_schema so the flagged path can persist FEATURE_SYNC_DECISION', () => {
    const extras = planShapingFeatureSyncAnalyzeHandler.additionalAllowedTools ?? [];
    expect(extras).toContain('get_report_schema');
    expect(extras).not.toContain('create_report');
  });

  it('registers submit_no_discrepancy and submit_discrepancies as submission tools', () => {
    const names = planShapingFeatureSyncAnalyzeHandler.submissionTools?.map((t) => t.name) ?? [];
    expect(names).toContain('submit_no_discrepancy');
    expect(names).toContain('submit_discrepancies');
    expect(names).not.toContain('submit_revised');
    expect(names).toHaveLength(2);
  });

  describe('buildPrompt', () => {
    it('embeds the plan id, design doc id, and termination suffix without weaving in the user message', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(
        makeAnalyzePayload({ userMessage: 'focus on the auth stage' }),
      );
      expect(prompt).toContain('Current plan id: plan-123');
      expect(prompt).toContain('Design doc id: design-456');
      // Injection moved to the resolver via addUserMessage.
      expect(prompt).not.toContain('focus on the auth stage');
      expect(prompt).not.toContain('User message for this turn');
    });

    it('instructs the flagged path to persist decision details without duplicating them in prose', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(makeAnalyzePayload());
      // A plain-English summary plus a report, not a duplicated markdown
      // table/list in the visible response.
      expect(prompt).toMatch(/summary/i);
      expect(prompt).not.toContain('| Source Type | Source | Description | Recommendation |');
      expect(prompt).not.toMatch(/Render the flagged-item table/i);
      expect(prompt).not.toMatch(/List concrete fix options/i);
      expect(prompt).toContain('Do not render this as a markdown table or a numbered option list');
      expect(prompt).toContain('the report carries the detailed rows and options');
      expect(prompt).toContain('Do not duplicate the report');
      expect(prompt).toContain("report's numbered options");
      expect(prompt).toContain('source material');
      expect(prompt).toContain('Plan stages are created separately by the plan-shaping agent');
      expect(prompt).toContain('Reserve "not ready" for genuinely missing content');
      expect(prompt).toContain('contradictory scope');
      expect(prompt).toContain('ready to plan');
      expect(prompt).toContain('Do not tell the user the plan or structure is ready');
      expect(prompt).toMatch(/get_report_schema[\s\S]{0,200}FEATURE_SYNC_DECISION/);
      expect(prompt).toMatch(
        /create_report[\s\S]{0,400}reportType[\s\S]{0,80}FEATURE_SYNC_DECISION/,
      );
      expect(prompt).toMatch(/entities[\s\S]{0,80}TASK[\s\S]{0,200}DESIGN_DOC/);
      expect(prompt).toMatch(/discrepancies[\s\S]{0,200}one entry per flagged item/i);
      expect(prompt).toMatch(/reconciliationOptions[\s\S]{0,200}fix option/i);
      expect(prompt).toMatch(
        /Do not call `submit_discrepancies` until this report has been persisted/,
      );
      // The agent records findings on the same turn, after persisting the decision report.
      expect(prompt).toContain('submit_discrepancies');
    });

    it('treats branchy seed-doc ambiguity as a plan-blocking finding', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(makeAnalyzePayload());
      expect(prompt).toContain('too ambiguous to safely plan from');
      expect(prompt).toContain('unresolved alternatives');
      expect(prompt).toContain('multiple plausible scopes');
      expect(prompt).toContain('deferred core scope decisions');
      expect(prompt).toContain('competing product branches');
      expect(prompt).toContain('This is not phrase scanning');
      expect(prompt).toContain(
        'Checked assumptions are acceptable when the document makes one assumption explicit',
      );
      expect(prompt).toContain('accept a proposed clarification');
      expect(prompt).toContain('explicitly dismiss/proceed');
    });

    it('applies the paired capability-name test during design-doc reconciliation', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(makeAnalyzePayload());
      expect(prompt).toContain('Apply the same structural discipline to feature names');
      expect(prompt).toContain('`Send Updates over WebSockets`');
      expect(prompt).toContain('`Build SearchIndexService`');
      expect(prompt).toContain('`Normalize Events before Indexing`');
      expect(prompt).toContain('`Live Updates`');
      expect(prompt).toContain('`Feature Search`');
      expect(prompt).toContain('properly nested `Event Delivery` unchanged');
      expect(prompt).toContain('not a closed vocabulary');
    });

    it('preserves the clean pass for a coherent single-direction design doc', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(makeAnalyzePayload());
      expect(prompt).toContain(
        'the design doc gives one coherent direction without unresolved alternatives',
      );
      expect(prompt).toContain('submit_no_discrepancy()');
      expect(prompt).toContain('The call is unconditional in this branch');
    });

    it('does not use the retired terminal JSON block format', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(makeAnalyzePayload());
      // The retired contract emitted a fenced verdict block; the current one calls submit_discrepancies.
      expect(prompt).not.toContain('plan_shaping_feature_sync_analyze_v1');
      expect(prompt).not.toContain('"action": "DISCREPANCY"');
    });

    it('allows settled non-live remediations while preserving unresolved choices', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(makeAnalyzePayload());
      expect(prompt).toContain('draft a non-live future remediation');
      expect(prompt).toContain('Leave unresolved product choices as findings');
      expect(prompt).toMatch(/concrete recommendation|concrete remediation/);
      // The eager-drafting step is gone: no instruction to draft edits on this turn.
      expect(prompt).not.toMatch(/draft edit proposals/i);
      expect(prompt).not.toMatch(/call `edit_work_item` on the target entity/i);
    });

    it('always renders the plan context lines', () => {
      const prompt = planShapingFeatureSyncAnalyzeHandler.buildPrompt(makeAnalyzePayload());
      expect(prompt).toContain('Current plan id: plan-123');
      expect(prompt).toContain('Design doc id: design-456');
    });

    it('addUserMessage formats the message under the turn label, or null when unset', () => {
      expect(
        planShapingFeatureSyncAnalyzeHandler.addUserMessage(
          makeAnalyzePayload({ userMessage: 'focus on the auth stage' }),
        ),
      ).toBe('\n\nUser message for this turn:\nfocus on the auth stage');
      expect(planShapingFeatureSyncAnalyzeHandler.addUserMessage(makeAnalyzePayload())).toBeNull();
    });
  });

  it('provides a starting message', () => {
    expect(
      planShapingFeatureSyncAnalyzeHandler.buildStartingMessage?.(makeAnalyzePayload()),
    ).toBeTruthy();
  });
});

describe('planShapingFeatureSyncIterateHandler', () => {
  it('registers under the plan_shaping_feature_sync_iterate prompt type', () => {
    expect(planShapingFeatureSyncIterateHandler.promptType).toBe(
      LocalPromptType.PlanShapingFeatureSyncIterate,
    );
  });

  it('runs on the persisted provider session and declares no reports', () => {
    expect(planShapingFeatureSyncIterateHandler.runnerKind).toBe('provider_session');
    expect(planShapingFeatureSyncIterateHandler.reports).toEqual([]);
  });

  it('exposes only submit_revised as a submission tool', () => {
    const names = planShapingFeatureSyncIterateHandler.submissionTools?.map((t) => t.name) ?? [];
    expect(names).toContain('submit_revised');
    expect(names).not.toContain('submit_resolved');
    expect(names).toHaveLength(1);
  });

  it('allows an empty revised set without granting resolution authority', () => {
    const submitRevised = planShapingFeatureSyncIterateHandler.submissionTools?.find(
      (tool) => tool.name === 'submit_revised',
    );

    expect(submitRevised?.execute({ args: { discrepancies: [] }, runId: 'test-run' })).toEqual({
      action: FEATURE_SYNC_ACTIONS.REVISED,
      payload: { discrepancies: [] },
    });
    expect(
      planShapingFeatureSyncIterateHandler.submissionTools?.map((tool) => tool.name),
    ).not.toContain('submit_resolved');
  });

  describe('buildPrompt', () => {
    it('builds an iterate prompt when the producer explicitly reports no outstanding items', () => {
      const prompt = planShapingFeatureSyncIterateHandler.buildPrompt(
        makeIteratePayload({ discrepancies: [], decisions: [] }),
      );

      expect(prompt).toContain('## Outstanding items');
      expect(prompt).toContain('## Internal mechanics');
      expect(prompt).not.toContain('undefined');
    });

    it('renders the numbered outstanding items from the payload instead of relying on session history', () => {
      const prompt = planShapingFeatureSyncIterateHandler.buildPrompt(
        makeIteratePayload({
          userMessage: 'accept item 1',
          discrepancies: [
            makeDiscrepancy({ id: 'fs-1', summary: 'first gap' }),
            makeDiscrepancy({ id: 'fs-6', summary: 'sixth gap' }),
          ],
        }),
      );
      expect(prompt).toContain('## Outstanding items');
      expect(prompt).toContain('1. (id `fs-1`) **Source:** (no entity)');
      expect(prompt).toContain('2. (id `fs-6`) **Source:** (no entity)');
      expect(prompt.indexOf('## Outstanding items')).toBeLessThan(
        prompt.indexOf('## Internal mechanics'),
      );
      expect(prompt).not.toMatch(/already in the conversation history/i);
      expect(prompt).toMatch(/bare number or list of numbers/i);
      expect(prompt).toMatch(/Copy the `id` of every item you carry forward/);
      expect(prompt).toContain('submit_revised');
      expect(prompt).not.toContain('submit_resolved');
      expect(prompt).toMatch(/end each turn by calling one of the submission tools/i);
      expect(prompt).not.toContain('accept item 1');
    });

    it('instructs one bounded revision pass with no resolution authority', () => {
      const prompt = planShapingFeatureSyncIterateHandler.buildPrompt(makeIteratePayload());
      expect(prompt).toContain('`submit_revised` is the only completion path for this turn');
      expect(prompt).not.toMatch(/accept.*reject.*dismiss|accepted.*rejected.*dismissed/i);
      expect(prompt).not.toMatch(/user is satisfied|concerns.*resolved|declare.*resolved/i);
      expect(prompt).not.toContain('submit_resolved');
      expect(prompt).toMatch(/proposal you draft is pending work/i);
      expect(prompt).toMatch(
        /does \*\*not\*\* mean the edit was approved, applied, fixed, or resolved/i,
      );
      expect(prompt).toMatch(
        /may be empty only when the user's current message explicitly dismisses/i,
      );
      expect(prompt).toMatch(/empty revised list does not advance the workflow/i);
      expect(prompt).toMatch(/use \*\*Ready for Plan\*\* to continue/i);
    });

    it('renders per-item choices as advisory guidance keyed to list positions', () => {
      const prompt = planShapingFeatureSyncIterateHandler.buildPrompt(
        makeIteratePayload({
          discrepancies: [makeDiscrepancy({ id: 'fs-1' }), makeDiscrepancy({ id: 'fs-2' })],
          decisions: [
            { itemId: 'fs-2', choice: 'amend', note: 'narrow it' },
            { itemId: 'fs-9', choice: 'dismiss' },
          ],
        }),
      );
      expect(prompt).toContain('## Your choices');
      expect(prompt).toContain('- Item 2 (id `fs-2`): amend — note: narrow it');
      expect(prompt).toContain('- Item id `fs-9` (no longer in the list): dismiss');
      expect(prompt).toMatch(/they never approve or apply a proposal/);
    });

    it('omits the choices section when the user made no per-item choices', () => {
      const prompt = planShapingFeatureSyncIterateHandler.buildPrompt(makeIteratePayload());
      expect(prompt).not.toContain('## Your choices');
    });

    it('snapshots the complete iterate prompt contract', () => {
      expect(
        planShapingFeatureSyncIterateHandler.buildPrompt(makeIteratePayload()),
      ).toMatchSnapshot();
    });

    it('keeps unresolved seed-doc ambiguity in the revised list until user-owned resolution', () => {
      const prompt = planShapingFeatureSyncIterateHandler.buildPrompt(makeIteratePayload());
      expect(prompt).toContain('Apply the same seed-doc ambiguity rule on every follow-up pass');
      expect(prompt).toContain('too ambiguous to safely plan from');
      expect(prompt).toContain('keep that concern in the non-empty revised discrepancy list');
      expect(prompt).toContain('Do not guess the branch for the user');
      expect(prompt).toContain('approved edit has clarified the design doc or feature context');
      expect(prompt).toContain('user-owned review action explicitly dismisses/proceeds');
    });

    it('addUserMessage formats the message under the turn label', () => {
      expect(
        planShapingFeatureSyncIterateHandler.addUserMessage(
          makeIteratePayload({ userMessage: 'accept item 1' }),
        ),
      ).toBe('\n\nUser message for this turn:\naccept item 1');
      expect(planShapingFeatureSyncIterateHandler.addUserMessage(makeIteratePayload())).toBeNull();
    });
  });
});

describe('plan-shaping feature-sync registry resolution', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('resolves all three plan-shaping feature-sync prompt types to their handlers', () => {
    expect(registry.get(LocalPromptType.PlanShapingFeatureSyncAnalyze)).toBe(
      planShapingFeatureSyncAnalyzeHandler,
    );
    expect(registry.get(LocalPromptType.PlanShapingFeatureSyncIterate)).toBe(
      planShapingFeatureSyncIterateHandler,
    );
  });
});
