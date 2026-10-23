import { describe, expect, it } from 'vitest';
import type {
  FeatureSyncDecisionReportPayloadV1,
  FeatureSyncDecisionReportPayloadV2,
} from '../../shared/api/generated/api';
import type { SessionMonitorEvaluationContext } from './session-monitor-evaluation-store';
import { buildSessionMonitorPrompt, type SessionMonitorPromptInput } from './session-monitor-prompt';

const groupedDecisionReport = {
  reportType: 'FEATURE_SYNC_DECISION',
  schemaVersion: 2,
  payload: {
    reportType: 'FEATURE_SYNC_DECISION',
    summary:
      'Scheduling scope and export access are independent decisions, including an explicit no-change choice for each group.',
    decisionGroups: [
      {
        id: 'schedule-scope',
        affectedEntities: [
          {
            entityType: 'feature',
            entityId: '11111111-1111-4111-8111-111111111111',
            title: 'Reporting',
          },
          {
            entityType: 'task',
            entityId: '22222222-2222-4222-8222-222222222222',
            title: 'Deliver scheduled reports',
          },
        ],
        title: 'Scheduled reporting scope',
        summary: 'The feature and delivery task describe different schedules.',
        choices: [
          { id: 'align-weekly', label: 'Align both to weekly scheduling', isNoChange: false },
          { id: 'keep', label: 'Keep current scope', isNoChange: true },
        ],
      },
      {
        id: 'export-access',
        affectedEntities: [
          {
            entityType: 'feature',
            entityId: '11111111-1111-4111-8111-111111111111',
            title: 'Reporting',
          },
        ],
        title: 'Export access',
        summary: 'The feature does not define who may export reports.',
        choices: [
          { id: 'members', label: 'Allow all members to export', isNoChange: false },
          { id: 'admins', label: 'Limit exports to administrators', isNoChange: false },
          { id: 'keep', label: 'Keep current access wording', isNoChange: true },
        ],
      },
    ],
  } satisfies FeatureSyncDecisionReportPayloadV2,
} as const;

const legacyDecisionReport = {
  reportType: 'FEATURE_SYNC_DECISION',
  schemaVersion: 1,
  payload: {
    reportType: 'FEATURE_SYNC_DECISION',
    summary: 'The legacy report uses a numbered reconciliation list.',
    discrepancies: [
      {
        sourceType: 'feature',
        source: {
          entityType: 'feature',
          entityId: '33333333-3333-4333-8333-333333333333',
          title: 'Reporting',
        },
        description: 'The feature promises weekly reporting.',
      },
    ],
    reconciliationOptions: [
      { description: '1. Align the reporting scope.', discrepancyIndices: [0] },
      { description: '2. Keep the current scope.', discrepancyIndices: [0] },
    ],
  } satisfies FeatureSyncDecisionReportPayloadV1,
} as const;

const payload = (
  overrides: Partial<SessionMonitorEvaluationContext> = {},
): SessionMonitorPromptInput => ({
  evaluation: {
    targetSessionId: '00000000-0000-4000-8000-000000000001',
    targetConversationId: '00000000-0000-4000-8000-000000000002',
    turnId: 'turn-1',
    completedAssistantContent: 'I found two options. Which should be canonical?',
    reports: [
      {
        reportId: '00000000-0000-4000-8000-000000000003',
        reportType: 'FEATURE_SYNC_DECISION',
      },
    ],
    workflow: {
      state: 'live-non-agent',
      promptType: 'plan_shaping_finalize',
      nodeId: null,
      triggerMessageId: null,
    },
    availableActions: [],
    ...overrides,
  },
});

describe('buildSessionMonitorPrompt', () => {
  it('snapshots the complete response-only prompt', () => {
    expect(buildSessionMonitorPrompt(payload())).toMatchSnapshot();
  });

  it('snapshots the complete action-guided prompt', () => {
    expect(
      buildSessionMonitorPrompt(
        payload({
          workflow: {
            state: 'agent-pending',
            promptType: 'plan_shaping_finalize',
            nodeId: 'approve-plan',
            triggerMessageId: '00000000-0000-4000-8000-000000000005',
          },
          availableActions: ['APPROVED', 'REVISED'],
        }),
      ),
    ).toMatchSnapshot();
  });

  it('snapshots grouped Feature Sync guidance for multiple independent decisions', () => {
    expect(
      buildSessionMonitorPrompt(
        payload({
          completedAssistantContent: groupedDecisionReport.payload.summary,
          reports: [
            {
              reportId: '00000000-0000-4000-8000-000000000006',
              reportType: groupedDecisionReport.reportType,
            },
          ],
        }),
      ),
    ).toMatchSnapshot();
  });

  it('snapshots legacy Feature Sync numbered guidance', () => {
    expect(
      buildSessionMonitorPrompt(
        payload({
          completedAssistantContent: legacyDecisionReport.payload.summary,
          reports: [
            {
              reportId: '00000000-0000-4000-8000-000000000007',
              reportType: legacyDecisionReport.reportType,
            },
          ],
        }),
      ),
    ).toMatchSnapshot();
  });
});
