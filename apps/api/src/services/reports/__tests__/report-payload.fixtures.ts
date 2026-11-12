import type { CommitReportPayload } from '@hey-hey/contracts/api/models';
import type { ReportSchemaKey } from 'src/mcp/tools/report-schemas.generated';
import { projectReportPayload } from './project-report.fixture';

export type ReportPayloadStub = Record<string, unknown>;

export const NOW = '2026-04-26T12:00:00.000Z';
export const STUB_UUID = '11111111-1111-4111-8111-111111111111';

/** One schema-valid producer payload per generated report type. */
export const VALID_PAYLOAD_BY_TYPE: Record<ReportSchemaKey, ReportPayloadStub> =
  {
    CHANGE_WALKTHROUGH: {
      reportType: 'CHANGE_WALKTHROUGH',
      summary: 'Guided changes',
      targetRunId: STUB_UUID,
      groups: [],
    },
    PROJECT_REPORT: projectReportPayload,
    CODING_RESEARCH: {
      reportType: 'CODING_RESEARCH',
      format: 'SELF_RESEARCH',
      summary: 'Research stub.',
      analysis: 'Analysis stub.',
      frame: {},
      provenance: { discoveryCalls: [], edgesTraversed: [] },
      updates: [],
      uncertainties: [],
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
          source: {
            entityType: 'feature',
            entityId: STUB_UUID,
            title: 'Plans',
          },
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
          description:
            'Feature description drifted from current implementation.',
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
          rationale:
            'The report schema must describe the implementation target.',
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
