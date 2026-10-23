import type { FeatureSyncDecisionReportPayloadV2 } from '../../../shared/api/generated/api';

const reporting = {
  entityType: 'feature',
  entityId: '11111111-1111-4111-8111-111111111111',
  title: 'Reporting',
} as const;
const delivery = {
  entityType: 'task',
  entityId: '22222222-2222-4222-8222-222222222222',
  title: 'Deliver scheduled reports',
} as const;

export const jointDecision = {
  reportType: 'FEATURE_SYNC_DECISION',
  summary:
    'The feature and its delivery task describe different scheduling expectations. One scope decision applies to both records, so they share a single group. The supplied choices either align both records or preserve their current wording. The user can choose one response or explain another preference; any proposed edits still require separate approval before planning continues.',
  decisionGroups: [
    {
      id: 'schedule-scope',
      affectedEntities: [reporting, delivery],
      title: 'Scheduled reporting scope',
      summary:
        'The feature promises weekly scheduling while the delivery task describes daily scheduling.',
      choices: [
        {
          id: 'align-weekly',
          label: 'Align both to weekly scheduling',
          description: 'Update the feature and task together to describe weekly delivery.',
          isNoChange: false,
        },
        { id: 'keep', label: 'Keep current scope', isNoChange: true },
      ],
    },
  ],
} satisfies FeatureSyncDecisionReportPayloadV2;

export const overlappingDecisions = {
  reportType: 'FEATURE_SYNC_DECISION',
  summary:
    'Scheduling scope and export access are separate decisions even though both affect Reporting. Each group supplies its own ordered choices and explicit no-change response. Choosing a scheduling remedy does not choose an access policy. The user can answer both groups in one ordinary response or explain another preference; proposed changes remain subject to separate approval.',
  decisionGroups: [
    jointDecision.decisionGroups[0]!,
    {
      id: 'export-access',
      affectedEntities: [reporting],
      title: 'Export access',
      summary:
        'The feature does not say whether all members or only administrators can export reports.',
      choices: [
        { id: 'members', label: 'Allow all members to export', isNoChange: false },
        { id: 'admins', label: 'Limit exports to administrators', isNoChange: false },
        { id: 'keep', label: 'Keep current access wording', isNoChange: true },
      ],
    },
  ],
} satisfies FeatureSyncDecisionReportPayloadV2;
