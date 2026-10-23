import { describe, expect, it } from 'vitest';
import type {
  CreateReportDto,
  CreateReportResponseDto,
  ReportDtoFeatureSyncDecisionV1,
  ReportDtoFeatureSyncDecisionV2,
  FeatureSyncDecisionReportPayload,
  FeatureSyncDecisionReportPayloadV1,
  FeatureSyncDecisionReportPayloadV2,
} from '../../../shared/api/generated/api';
import {
  jointDecision,
  overlappingDecisions,
} from '../../feature-sync/__tests__/feature-sync-decision.fixtures';
import { featureSyncDecisionV2Schema, parseFeatureSyncDecisionReport } from './schemas';

const legacy = {
  reportType: 'FEATURE_SYNC_DECISION',
  summary: 'Legacy report',
  discrepancies: [
    {
      sourceType: 'feature',
      source: jointDecision.decisionGroups[0]!.affectedEntities[0]!,
      description: 'Scope differs',
    },
  ],
  reconciliationOptions: [{ description: '1. Update scope', discrepancyIndices: [0] }],
} satisfies FeatureSyncDecisionReportPayloadV1;
const envelope = (payload: object = jointDecision, schemaVersion: number | undefined = 2) => ({
  reportType: 'FEATURE_SYNC_DECISION',
  payload,
  schemaVersion,
});

// These functions are compiled by tsc: payload access must narrow without casts.
const readDecision = (
  report: ReportDtoFeatureSyncDecisionV1 | ReportDtoFeatureSyncDecisionV2,
): FeatureSyncDecisionReportPayload | null => {
  if (report.reportType !== 'FEATURE_SYNC_DECISION') return null;
  if (report.schemaVersion === 2) {
    const payload: FeatureSyncDecisionReportPayloadV2 = report.payload;
    return payload;
  }
  const payload: FeatureSyncDecisionReportPayloadV1 = report.payload;
  return payload;
};
const createDecision = (report: CreateReportDto) => {
  if (report.reportType === 'FEATURE_SYNC_DECISION' && report.schemaVersion === 2) {
    return report.payload.decisionGroups;
  }
  return null;
};

describe('Feature Sync decision producer boundary', () => {
  it.each([jointDecision, overlappingDecisions])(
    'accepts generated grouped fixtures',
    (payload) => {
      expect(parseFeatureSyncDecisionReport(envelope(payload))).toMatchObject({
        ok: true,
        value: { payload },
      });
    },
  );

  it('retains V1 with explicit or omitted version', () => {
    expect(parseFeatureSyncDecisionReport(envelope(legacy, 1)).ok).toBe(true);
    expect(
      parseFeatureSyncDecisionReport({ reportType: 'FEATURE_SYNC_DECISION', payload: legacy }).ok,
    ).toBe(true);
  });

  it.each([
    ['wrong legacy version', envelope(legacy, 2)],
    ['wrong grouped version', envelope(jointDecision, 1)],
    ['unsupported version', envelope(jointDecision, 3)],
    ['omitted grouped version', { reportType: 'FEATURE_SYNC_DECISION', payload: jointDecision }],
    ['mismatched envelope type', { ...envelope(), reportType: 'FEATURE_SYNC' }],
    ['mismatched payload type', envelope({ ...jointDecision, reportType: 'FEATURE_SYNC' })],
    ['missing payload', { reportType: 'FEATURE_SYNC_DECISION' }],
    ['mixed discrepancies', envelope({ ...jointDecision, discrepancies: legacy.discrepancies })],
    [
      'mixed options',
      envelope({ ...jointDecision, reconciliationOptions: legacy.reconciliationOptions }),
    ],
    [
      'legacy with groups',
      envelope({ ...legacy, decisionGroups: jointDecision.decisionGroups }, 1),
    ],
    ['payload version', envelope({ ...jointDecision, schemaVersion: 2 })],
    ['empty groups', envelope({ ...jointDecision, decisionGroups: [] })],
    [
      'duplicate group ids',
      envelope({
        ...jointDecision,
        decisionGroups: [jointDecision.decisionGroups[0]!, jointDecision.decisionGroups[0]!],
      }),
    ],
  ])('rejects %s', (_name, args) => {
    expect(parseFeatureSyncDecisionReport(args).ok).toBe(false);
  });

  const group = jointDecision.decisionGroups[0]!;
  it.each([
    ['missing targets', { ...group, affectedEntities: undefined }],
    ['empty targets', { ...group, affectedEntities: [] }],
    [
      'repeated target with another title',
      {
        ...group,
        affectedEntities: [
          group.affectedEntities[0]!,
          { ...group.affectedEntities[0]!, title: 'Another title' },
        ],
      },
    ],
    ['single choice', { ...group, choices: [group.choices[0]!] }],
    ['empty choices', { ...group, choices: [] }],
    [
      'zero no-change choices',
      { ...group, choices: group.choices.map((choice) => ({ ...choice, isNoChange: false })) },
    ],
    [
      'multiple no-change choices',
      { ...group, choices: group.choices.map((choice) => ({ ...choice, isNoChange: true })) },
    ],
    [
      'duplicate choice ids',
      { ...group, choices: group.choices.map((choice) => ({ ...choice, id: 'same' })) },
    ],
    ['empty group id', { ...group, id: '' }],
    [
      'empty choice id',
      { ...group, choices: [{ ...group.choices[0]!, id: '' }, group.choices[1]!] },
    ],
    [
      'missing no-change flag',
      { ...group, choices: [{ ...group.choices[0]!, isNoChange: undefined }, group.choices[1]!] },
    ],
  ])('rejects %s', (_name, invalid) => {
    expect(
      featureSyncDecisionV2Schema.safeParse({ ...jointDecision, decisionGroups: [invalid] })
        .success,
    ).toBe(false);
  });

  it.each([
    '1. Update scope',
    '2) Update scope',
    '(3) Update scope',
    'A. Update scope',
    'iv. Update scope',
  ])('rejects ordinal label %s', (label) => {
    const payload = {
      ...jointDecision,
      decisionGroups: [{ ...group, choices: [{ ...group.choices[0]!, label }, group.choices[1]!] }],
    };
    expect(featureSyncDecisionV2Schema.safeParse(payload).success).toBe(false);
  });

  it('permits different typed identities with the same id and shared choice ids across groups', () => {
    expect(
      featureSyncDecisionV2Schema.safeParse({
        ...overlappingDecisions,
        decisionGroups: [
          {
            ...group,
            affectedEntities: [
              group.affectedEntities[0]!,
              { ...group.affectedEntities[0]!, entityType: 'task' },
            ],
          },
          overlappingDecisions.decisionGroups[1]!,
        ],
      }).success,
    ).toBe(true);
  });

  it('leaves terminal and unrelated reports to their existing boundaries', () => {
    for (const reportType of ['FEATURE_SYNC', 'FEATURE_SYNC_HANDOFF', 'IMPLEMENT']) {
      expect(parseFeatureSyncDecisionReport({ reportType, payload: { reportType } })).toEqual({
        ok: true,
        value: null,
      });
    }
  });

  it('uses generated envelope narrowing on reads and creation', () => {
    const creation = {
      reportType: 'FEATURE_SYNC_DECISION',
      audience: 'PROJECT_VISIBLE',
      schemaVersion: 2,
      payload: jointDecision,
    } satisfies CreateReportDto;
    const report = {
      ...creation,
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      title: 'Decision',
      version: 1,
      createdAt: '2026-09-04T22:00:00Z',
      expiresAt: '2026-09-05T22:00:00Z',
      entities: [],
    } satisfies ReportDtoFeatureSyncDecisionV2;
    expect(readDecision(report)).toBe(jointDecision);
    const response = {
      ...report,
      reportGuidance: { actions: [] },
    } satisfies CreateReportResponseDto;
    expect(readDecision(response)).toBe(jointDecision);
    expect(createDecision(creation)).toBe(jointDecision.decisionGroups);
  });
});
