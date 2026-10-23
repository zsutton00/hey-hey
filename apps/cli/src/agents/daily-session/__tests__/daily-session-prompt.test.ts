import { describe, expect, it } from 'vitest';
import { buildDailySessionPrompt } from '../daily-session-prompt';
import type { DailySessionPromptInput } from '../types';
import { REPORT_CATALOG } from '../report-catalog';

const makeInput = (overrides: Partial<DailySessionPromptInput> = {}): DailySessionPromptInput => ({
  activitySnapshot: [],
  computedDelta: {
    statusChanges: [],
    itemCompletions: [],
    newSignals: [],
    computedAt: '2026-04-08T12:00:00.000Z',
  },
  ...overrides,
});

describe('buildDailySessionPrompt', () => {
  describe('report catalog', () => {
    it('includes a description block for every report type', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      for (const type of Object.keys(REPORT_CATALOG)) {
        expect(prompt).toContain(`\`${type}\``);
      }
    });

    it('includes purpose, when, guidance, and entity guidance for each report type', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      for (const entry of Object.values(REPORT_CATALOG)) {
        expect(prompt).toContain(entry.purpose);
        expect(prompt).toContain(entry.when);
        expect(prompt).toContain(entry.guidance);
        expect(prompt).toContain(entry.entityGuidance);
      }
    });
  });

  describe('user goal injection', () => {
    it('injects User Goal section when userFocus is present', () => {
      const prompt = buildDailySessionPrompt(
        makeInput({ userFocus: 'shipping the auth refactor' }),
      );
      expect(prompt).toContain('## User Goal');
      expect(prompt).toContain('shipping the auth refactor');
      expect(prompt).toContain('GOAL_PROGRESS');
    });

    it('omits User Goal section when userFocus is absent', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).not.toContain('## User Goal');
    });

    it('never renders a goal-shift block, even when userFocus is present', () => {
      const prompt = buildDailySessionPrompt(makeInput({ userFocus: 'deploy pipeline' }));
      expect(prompt).not.toContain('Goal shift detected');
    });
  });

  describe('report priority guidance', () => {
    it('references report types in priority tiers', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('GOAL_PROGRESS');
      expect(prompt).toContain('RISK_ALERT');
      expect(prompt).toContain('SESSION_SUMMARY');
    });

    it('maintains goal > risk > session ordering', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      const goalIdx = prompt.indexOf('**Goal alignment**');
      const riskIdx = prompt.indexOf('**Risks**');
      const sessionIdx = prompt.indexOf('**Session context**');
      expect(goalIdx).toBeLessThan(riskIdx);
      expect(riskIdx).toBeLessThan(sessionIdx);
    });
  });

  describe('output format', () => {
    it('instructs agent to produce reports, not widgets', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('"reports"');
      expect(prompt).toContain('"reportType"');
      expect(prompt).toContain('"text"');
      expect(prompt).toContain('"entities"');
      expect(prompt).not.toContain('"widgets"');
      expect(prompt).not.toContain('"agentComment"');
    });

    it('includes responseType instruction', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('"responseType": "daily_session_v1"');
    });

    it('instructs entity relation types', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('"PRIMARY"');
      expect(prompt).toContain('"CONTEXT"');
    });
  });

  describe('mention policy', () => {
    it('includes mention policy section', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('## Mention Policy');
      expect(prompt).toContain('entities array');
    });

    it('forbids per-task enumeration and prefers counts and clusters', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('Per-task enumeration is not allowed');
      expect(prompt).toContain('counts and clusters');
      expect(prompt).toContain('delivery summary');
    });
  });

  describe('SESSION_SUMMARY product narrative rules', () => {
    it('instructs zero mentions in SESSION_SUMMARY text', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('SESSION_SUMMARY: Product Narrative Rules');
      expect(prompt).toContain('zero');
      expect(prompt).toContain('@[type:id|title]');
    });

    it('instructs agent to gather feature context before writing', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('get_context');
      expect(prompt).toContain('unified_search');
      expect(prompt).toContain('parent features');
    });
  });

  describe('GOAL_PROGRESS delivery narrative rules', () => {
    it('includes a GOAL_PROGRESS delivery narrative subsection', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('GOAL_PROGRESS: Delivery Narrative Rules');
    });

    it('instructs zero mentions in GOAL_PROGRESS text', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      const subsection = prompt.slice(prompt.indexOf('GOAL_PROGRESS: Delivery Narrative Rules'));
      expect(subsection).toContain('zero');
      expect(subsection).toContain('@[type:id|title]');
      expect(subsection).toContain('entities` array');
    });

    it('frames progress as deliveries not enumerations', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      const subsection = prompt.slice(prompt.indexOf('GOAL_PROGRESS: Delivery Narrative Rules'));
      expect(subsection).toContain('delivery narrative');
      expect(subsection).toContain('what remains to deliver');
      expect(subsection).toContain('per-task enumeration is not allowed');
    });

    it('instructs context gathering on goal/feature/initiative before writing', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      const subsection = prompt.slice(prompt.indexOf('GOAL_PROGRESS: Delivery Narrative Rules'));
      expect(subsection).toContain('get_context');
      expect(subsection).toContain('unified_search');
      expect(subsection).toMatch(/goal, feature, or initiative/);
    });
  });

  describe('active goals section', () => {
    const goal = {
      id: 'goal-1',
      name: 'Ship the dashboard',
      dueDate: '2026-05-20T00:00:00.000Z',
      audience: 'PROJECT' as const,
    };

    it('renders the Active Goals section with name, due date, and audience', () => {
      const prompt = buildDailySessionPrompt(makeInput({ activeGoals: [goal] }));
      expect(prompt).toContain('## Active Goals');
      expect(prompt).toContain('Ship the dashboard');
      expect(prompt).toContain('PROJECT');
      // Due date should be formatted in a human-readable way (not the raw ISO).
      expect(prompt).not.toContain('2026-05-20T00:00:00.000Z');
      expect(prompt).toMatch(/May 20, 2026/);
    });

    it('renders an undated Goal without formatting a deadline', () => {
      const prompt = buildDailySessionPrompt(
        makeInput({
          activeGoals: [{ ...goal, dueDate: null }],
        }),
      );
      expect(prompt).toContain('No target date');
      expect(prompt).not.toContain('1970');
    });

    it('omits the section when activeGoals is absent', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).not.toContain('## Active Goals');
    });

    it('omits the section when activeGoals is empty', () => {
      const prompt = buildDailySessionPrompt(makeInput({ activeGoals: [] }));
      expect(prompt).not.toContain('## Active Goals');
    });

    it('renders alongside userFocus when both are present', () => {
      const prompt = buildDailySessionPrompt(
        makeInput({ userFocus: 'shipping the auth refactor', activeGoals: [goal] }),
      );
      expect(prompt).toContain('## User Goal');
      expect(prompt).toContain('## Active Goals');
      expect(prompt.indexOf('## User Goal')).toBeLessThan(prompt.indexOf('## Active Goals'));
    });
  });

  describe('session context framing', () => {
    it('always renders clean-slate framing', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('start of a new daily session');
      expect(prompt).toContain('comprehensive analysis');
    });
  });

  describe('activity snapshot and delta framing', () => {
    const inputWithDelta = (): Partial<DailySessionPromptInput> => ({
      computedDelta: {
        statusChanges: [
          {
            entityId: 'task-1',
            entityType: 'TASK',
            title: 'Example',
            previousStatus: 'TODO',
            currentStatus: 'IN_PROGRESS',
            changedAt: '2026-04-08T12:00:00.000Z',
          },
        ],
        itemCompletions: [],
        newSignals: [],
        computedAt: '2026-04-08T12:00:00.000Z',
      },
    });

    it('frames the Activity Snapshot as the report subject', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).toContain('## Activity Snapshot');
      expect(prompt).toContain('the subject of your reports');
    });

    it('labels the Activity Delta as a comparison reference describing what shifted since the prior firing', () => {
      const prompt = buildDailySessionPrompt(makeInput(inputWithDelta()));
      expect(prompt).toContain('Activity Delta — reference: what shifted since the prior firing');
      expect(prompt).toContain('Supporting context only');
    });

    it('labels the delta as what shifted since the prior firing', () => {
      const prompt = buildDailySessionPrompt(makeInput(inputWithDelta()));
      expect(prompt).toContain('what shifted since the prior firing');
      expect(prompt).not.toContain('all recent signals');
    });

    it('omits the Activity Delta section when the delta is empty', () => {
      const prompt = buildDailySessionPrompt(makeInput());
      expect(prompt).not.toContain('Activity Delta');
    });
  });
});
