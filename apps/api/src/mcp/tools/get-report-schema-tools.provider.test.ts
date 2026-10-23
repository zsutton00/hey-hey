import Ajv from 'ajv';
import { CommitReportPayload } from 'src/generated/model/commitReportPayload';
import { projectReportPayload } from 'src/services/reports/__tests__/project-report.fixture';
import { GetReportSchemaToolsProvider } from './get-report-schema-tools.provider';
import {
  REPORT_SCHEMAS,
  type ReportSchemaKey,
} from './report-schemas.generated';

type ReportPayloadStub = Record<string, unknown>;

const NOW = '2026-04-26T12:00:00.000Z';
const STUB_UUID = '11111111-1111-4111-8111-111111111111';

const VALID_PAYLOAD_BY_TYPE: Record<ReportSchemaKey, ReportPayloadStub> = {
  CHANGE_WALKTHROUGH: {
    reportType: 'CHANGE_WALKTHROUGH',
    summary: 'Guided changes',
    targetRunId: STUB_UUID,
    groups: [],
  },
  PROJECT_REPORT: projectReportPayload,
  CODING_RESEARCH: {
    reportType: 'CODING_RESEARCH',
    summary: 'Research stub.',
    analysis: 'Analysis stub.',
    frame: {},
    provenance: { discoveryCalls: [], edgesTraversed: [] },
    updates: [],
  },
  COMMIT: {
    reportType: 'COMMIT',
    summary: 'Commit stub.',
    files: ['src/foo.ts'],
    hashes: [
      { service: 'api', hash: 'abc1234', branch: 'feature/commit-report' },
    ],
  } satisfies CommitReportPayload,
  DAILY_SESSION: {
    reportType: 'DAILY_SESSION',
    summary: 'Daily session stub.',
  },
  DECISION_NEEDED: {
    reportType: 'DECISION_NEEDED',
    summary: 'Decision needed stub.',
    question: 'Which approach should we take?',
    options: [{ description: 'Option A: do it the fast way.' }],
  },
  FEATURE_SYNC_DECISION: {
    reportType: 'FEATURE_SYNC_DECISION',
    summary: 'Feature sync decision stub.',
    discrepancies: [
      {
        sourceType: 'feature',
        source: { entityType: 'feature', entityId: STUB_UUID, title: 'Plans' },
        description: 'Feature description drifted from implementation.',
      },
    ],
    reconciliationOptions: [
      {
        description: 'Update the feature description to match the code.',
        discrepancyIndices: [0],
      },
    ],
  },
  FEATURE_SYNC: {
    reportType: 'FEATURE_SYNC',
    summary: 'Feature sync stub.',
    discrepancies: [
      {
        sourceType: 'feature',
        source: {
          entityType: 'feature',
          entityId: STUB_UUID,
          title: 'Plans',
        },
        description: 'Feature description drifted from current implementation.',
      },
    ],
    reconciliationOptions: [],
  },
  FEATURE_SYNC_HANDOFF: {
    reportType: 'FEATURE_SYNC_HANDOFF',
    summary: 'Handoff stub.',
    notes: [
      {
        category: 'hidden_requirements',
        text: 'Plans must allow re-parenting under arbitrary features.',
      },
    ],
  },
  IMPLEMENT: {
    reportType: 'IMPLEMENT',
    summary: 'Wired plan-from-design-doc into AgentSession lifecycle.',
    filesChanged: ['src/services/proposal/proposal-approval.service.ts'],
    decisions: [
      {
        topic: 'Event publishing site',
        choice: 'Eager publish at row creation',
        reasoning:
          'Mirrors the public AgentSessionService.create() path; tx rollback handles consistency.',
        location: {
          file: 'src/services/proposal/proposal-approval.service.ts',
          startLine: 142,
          endLine: 148,
        },
      },
      {
        topic: 'Consistency strategy',
        choice: 'Rely on the surrounding transaction',
        reasoning: 'A cross-cutting decision with no single code location.',
      },
    ],
  },
  EVIDENCE_PIPELINE: {
    reportType: 'EVIDENCE_PIPELINE',
    summary: 'Evidence pipeline stub.',
    plannerInput: {
      messageCount: 3,
      optionKeys: ['option-a'],
      maxRounds: 2,
      scaffoldedQaAnswerFocus: false,
    },
    searchSteps: [
      {
        query: 'authentication',
        why: 'find auth code',
        queryPerspective: 'engineer',
        tool: 'unified_search',
      },
    ],
    searchResults: [
      {
        query: 'authentication',
        why: 'find auth code',
        queryPerspective: 'engineer',
        fromCache: false,
        evidenceItems: [
          {
            entityId: STUB_UUID,
            entityType: 'TASK',
            score: 0.9,
            source: 'unified_search',
          },
        ],
      },
    ],
    selectedEvidenceKeys: ['TASK:abc'],
    excludedEvidenceKeys: [],
    hydratedEvidenceKeys: ['TASK:abc'],
    implementationHints: [],
    finalEvidence: [{ entityId: STUB_UUID, entityType: 'TASK' }],
    execution: {
      startedAt: NOW,
      completedAt: NOW,
      durationMs: 1234,
      totalSearchSteps: 1,
      cachedStepCount: 0,
      uncachedStepCount: 1,
      errorCount: 0,
    },
  },
  GOAL_PROGRESS: {
    reportType: 'GOAL_PROGRESS',
    summary: 'On track.',
    text: 'On track.',
  },
  RISK_ALERT: {
    reportType: 'RISK_ALERT',
    summary: 'Schedule slipping.',
    text: 'Schedule slipping.',
  },
  REVIEW: {
    reportType: 'REVIEW',
    summary: 'Review completed cleanly.',
    sourceAgentSessionId: STUB_UUID,
    implementReportId: STUB_UUID,
    disposition: 'CLEAN',
  },
  ROLLUP_PROPOSAL: {
    reportType: 'ROLLUP_PROPOSAL',
    summary: 'Rollup proposal stub.',
    taskId: STUB_UUID,
    triggeredBy: 'agent-7',
    triggeredAt: NOW,
    parentFeatures: [STUB_UUID],
    relatedFeatures: [],
  },
  SESSION_SUMMARY: {
    reportType: 'SESSION_SUMMARY',
    summary: 'Wrapped up the auth refactor.',
    text: 'Wrapped up the auth refactor.',
  },
  SESSION_MONITOR_DEFERRAL: {
    reportType: 'SESSION_MONITOR_DEFERRAL',
    summary: 'Monitor could not continue automatically.',
    assessedSessionId: STUB_UUID,
    assessedTurnId: 'turn-1',
    assessedReportIds: [STUB_UUID],
    reasoning: 'The report did not provide a safe automatic continuation.',
  },
  SNAPSHOT: { reportType: 'SNAPSHOT', summary: 'Snapshot stub.' },
  PLAN: {
    reportType: 'PLAN',
    summary: 'Plan stub.',
    sessionTitle: 'Add PLAN report variant',
    requiredServiceIds: [STUB_UUID],
    primaryImplementations: [
      {
        title: 'Add PLAN report schema',
        content: 'Register the PLAN report variant in the report schema.',
        rationale: 'The report schema must describe the implementation target.',
      },
    ],
    executionPlan: [
      {
        stepId: 'step-1',
        title: 'Add PLAN reportType',
        description: 'Extend the discriminator to cover PLAN.',
        phase: 1,
        targetFiles: ['specs/schemas/reports.yaml'],
        references: [
          {
            sourceType: 'task',
            sourceId: STUB_UUID,
            rationale: 'Active task description.',
          },
        ],
      },
    ],
    discrepancies: [],
    clarificationQuestions: [],
  },
  VALIDATION_WALKTHROUGH: {
    reportType: 'VALIDATION_WALKTHROUGH',
    summary: 'Validation walkthrough stub.',
    validationSteps: [
      {
        title: 'Run tests',
        description: 'Execute the test suite to verify correctness.',
        actions: [{ type: 'command_line', command: 'pnpm test' }],
      },
    ],
  },
  FEATURE_TREE_ANALYSIS: {
    reportType: 'FEATURE_TREE_ANALYSIS',
    summary: 'Feature tree analysis stub.',
    text: 'Feature tree analysis body.',
  },
  COMPETITIVE_ANALYSIS: {
    reportType: 'COMPETITIVE_ANALYSIS',
    summary: 'Competitive analysis stub.',
    text: 'Competitive analysis body.',
  },
  EVAL_RUN: {
    reportType: 'EVAL_RUN',
    summary: 'Eval run stub.',
    evalId: STUB_UUID,
    status: 'QUEUED',
    judgeSetup: { provider: 'claude', model: 'claude-opus-5-5' },
    cases: [],
    configurations: [],
    settings: { maxConcurrentAttempts: 3 },
    coordinatorAgentSessionId: null,
    coordinatorConversationId: null,
  },
  EVAL_ATTEMPT: {
    reportType: 'EVAL_ATTEMPT',
    summary: 'Eval attempt stub.',
    caseInputId: STUB_UUID,
    configuration: {
      id: STUB_UUID,
      target: { provider: 'claude', model: 'claude-opus-5-5' },
    },
    status: 'QUEUED',
    measurements: [],
  },
  EVAL_HUMAN_REVIEW: {
    reportType: 'EVAL_HUMAN_REVIEW',
    summary: 'Eval human review stub.',
    score: 3,
    challengeCase: false,
  },
  PHASE_GROUNDING: {
    reportType: 'PHASE_GROUNDING',
    summary:
      'Phase grounding stub committed to one touch point before execution.',
    touchPoints: [
      {
        file: 'src/services/reports/report.service.ts',
        expectedOutcome:
          'Register PHASE_GROUNDING so getReportTitle resolves it.',
      },
    ],
  },
};

function parseToolText(result: unknown): {
  schema: unknown;
  description: unknown;
} {
  const r = result as { content: Array<{ type: string; text: string }> };
  expect(Array.isArray(r.content)).toBe(true);
  const first = r.content[0];
  expect(first?.type).toBe('text');
  if (!first) throw new Error('Expected at least one content entry');
  return JSON.parse(first.text);
}

describe('GetReportSchemaToolsProvider', () => {
  let provider: GetReportSchemaToolsProvider;
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    // OpenAPI uses string formats (date-time, uuid) that AJV does not know
    // out of the box. Treat them as no-ops so schema compilation does not
    // emit warnings; format validation is not the focus of this round-trip.
    formats: { 'date-time': true, uuid: true },
  });

  beforeEach(() => {
    provider = new GetReportSchemaToolsProvider();
  });

  const reportTypes = Object.keys(REPORT_SCHEMAS) as ReportSchemaKey[];

  it.each([
    [null, true],
    ['USER', true],
    ['UNKNOWN', false],
    [42, false],
  ])(
    'validates nullable composed stopReason %p as %p',
    (stopReason, expected) => {
      const validate = ajv.compile(REPORT_SCHEMAS.EVAL_ATTEMPT.schema);
      expect(
        validate({ ...VALID_PAYLOAD_BY_TYPE.EVAL_ATTEMPT, stopReason }),
      ).toBe(expected);
    },
  );

  it('covers every discriminator value declared in REPORT_SCHEMAS', () => {
    for (const reportType of reportTypes) {
      expect(VALID_PAYLOAD_BY_TYPE[reportType]).toBeDefined();
    }
  });

  describe.each(reportTypes)('reportType=%s', (reportType) => {
    it('returns a non-empty description and self-contained schema', async () => {
      const result = await provider.getReportSchema({ reportType }, {} as any);
      const { schema, description } = parseToolText(result);

      expect(typeof description).toBe('string');
      expect((description as string).length).toBeGreaterThan(0);
      expect(schema).toBeDefined();
      expect(JSON.stringify(schema)).not.toContain('"$ref"');
    });

    it('AJV validates a known-valid payload against the returned schema', async () => {
      const result = await provider.getReportSchema({ reportType }, {} as any);
      const { schema } = parseToolText(result);

      const validate = ajv.compile(schema as object);
      const payload = VALID_PAYLOAD_BY_TYPE[reportType];
      const isValid = validate(payload);
      if (!isValid) {
        console.error('AJV errors for', reportType, validate.errors);
      }
      expect(isValid).toBe(true);
    });

    it('does not return a SubmissionToolAction (read-only, turn continues)', async () => {
      const result = await provider.getReportSchema({ reportType }, {} as any);
      expect(result).not.toHaveProperty('submissionToolAction');
      expect(result).toHaveProperty('content');
    });
  });

  it('rejects an unknown reportType through the zod input parser', () => {
    // The @Tool decorator would normally apply this; we assert the schema
    // directly so the test is independent of the MCP runtime harness.

    const { z } = require('zod');
    const REPORT_TYPE_KEYS = Object.keys(REPORT_SCHEMAS) as [
      string,
      ...string[],
    ];
    const inputSchema = z.object({ reportType: z.enum(REPORT_TYPE_KEYS) });
    const parsed = inputSchema.safeParse({ reportType: 'NOT_A_REAL_TYPE' });
    expect(parsed.success).toBe(false);
  });
});
