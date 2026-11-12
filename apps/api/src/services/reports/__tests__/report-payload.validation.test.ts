import { ReportType } from '@hey-hey/contracts/api/models';
import { REPORT_SCHEMAS } from 'src/mcp/tools/report-schemas.generated';
import {
  ReportPayloadValidationException,
  SCHEMA_BACKED_REPORT_TYPES,
  validateReportPayload,
} from '../report-payload.validation';
import { STUB_UUID, VALID_PAYLOAD_BY_TYPE } from './report-payload.fixtures';
import { projectReportPayload } from './project-report.fixture';

const writtenResearch = {
  reportType: 'CODING_RESEARCH',
  format: 'SUBAGENT_PARENT',
  summary: 'The parent researched the project and wrote this handoff.',
  analysis: 'Findings from the project.\n\n## Uncertainties\n\n- None found.',
};

const decisionV2 = {
  reportType: 'FEATURE_SYNC_DECISION',
  summary: 'Choose how to repair the boundary.',
  decisionGroups: [
    {
      id: 'repair',
      affectedEntities: [
        { entityType: 'feature', entityId: STUB_UUID, title: 'Reports' },
      ],
      title: 'Validate findings',
      summary: 'Choose whether to repair the boundary.',
      choices: [
        { id: 'fix', label: 'Validate reports', isNoChange: false },
        { id: 'keep', label: 'Keep current behavior', isNoChange: true },
      ],
    },
  ],
};

function failureOf(input: Parameters<typeof validateReportPayload>[0]) {
  try {
    validateReportPayload(input);
  } catch (error) {
    if (error instanceof ReportPayloadValidationException) {
      return error.failure;
    }
    throw error;
  }
  throw new Error('Expected the report to be rejected');
}

describe('shared report payload validation', () => {
  it('has a validator and a valid fixture for every generated report type', () => {
    expect([...SCHEMA_BACKED_REPORT_TYPES].sort()).toEqual(
      Object.keys(REPORT_SCHEMAS).sort(),
    );
    expect(Object.keys(VALID_PAYLOAD_BY_TYPE).sort()).toEqual(
      Object.keys(REPORT_SCHEMAS).sort(),
    );
  });

  it('covers every public report type, so a new type cannot bypass validation', () => {
    expect([...SCHEMA_BACKED_REPORT_TYPES].sort()).toEqual(
      Object.values(ReportType).sort(),
    );
  });

  it.each(Object.entries(VALID_PAYLOAD_BY_TYPE))(
    'accepts a valid %s payload',
    (reportType, payload) => {
      expect(() =>
        validateReportPayload({ reportType, payload, schemaVersion: 1 }),
      ).not.toThrow();
    },
  );

  it.each([
    ['written CODING_RESEARCH', 'CODING_RESEARCH', writtenResearch, 1],
    ['FEATURE_SYNC_DECISION V2', 'FEATURE_SYNC_DECISION', decisionV2, 2],
    ['PROJECT_REPORT', 'PROJECT_REPORT', projectReportPayload, 1],
  ])('accepts %s', (_name, reportType, payload, schemaVersion) => {
    expect(() =>
      validateReportPayload({ reportType, payload, schemaVersion }),
    ).not.toThrow();
  });

  it.each(Object.keys(VALID_PAYLOAD_BY_TYPE))(
    'names the missing required field for %s',
    (reportType) => {
      const { summary: _summary, ...withoutSummary } = VALID_PAYLOAD_BY_TYPE[
        reportType as keyof typeof VALID_PAYLOAD_BY_TYPE
      ] as Record<string, unknown>;

      const failure = failureOf({
        reportType,
        payload: withoutSummary,
        schemaVersion: 1,
      });

      expect(failure.reportType).toBe(reportType);
      expect(failure.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/summary',
            keyword: 'required',
            missingProperty: 'summary',
          }),
        ]),
      );
    },
  );

  it('reports nested field paths for malformed nested fields', () => {
    const failure = failureOf({
      reportType: 'FEATURE_SYNC',
      schemaVersion: 1,
      payload: {
        ...VALID_PAYLOAD_BY_TYPE.FEATURE_SYNC,
        reconciliationOptions: [{ description: 'Repair' }],
      },
    });

    expect(failure.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/reconciliationOptions/0/discrepancyIndices',
          missingProperty: 'discrepancyIndices',
        }),
      ]),
    );
  });

  it('rejects a payload whose discriminator differs from the envelope', () => {
    const failure = failureOf({
      reportType: 'SNAPSHOT',
      schemaVersion: 1,
      payload: VALID_PAYLOAD_BY_TYPE.COMMIT,
    });

    expect(failure.issues).toEqual([
      expect.objectContaining({
        path: '/reportType',
        keyword: 'reportTypeMismatch',
      }),
    ]);
  });

  it('selects the decision schema by version and rejects mismatches', () => {
    const v1 = VALID_PAYLOAD_BY_TYPE.FEATURE_SYNC_DECISION;

    expect(() =>
      validateReportPayload({
        reportType: 'FEATURE_SYNC_DECISION',
        payload: v1,
        schemaVersion: 1,
      }),
    ).not.toThrow();
    expect(
      failureOf({
        reportType: 'FEATURE_SYNC_DECISION',
        payload: v1,
        schemaVersion: 2,
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ missingProperty: 'decisionGroups' }),
      ]),
    );
    expect(
      failureOf({
        reportType: 'FEATURE_SYNC_DECISION',
        payload: decisionV2,
        schemaVersion: 1,
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ missingProperty: 'discrepancies' }),
      ]),
    );
  });

  it('rejects unsupported decision versions and lists the supported ones', () => {
    const failure = failureOf({
      reportType: 'FEATURE_SYNC_DECISION',
      payload: decisionV2,
      schemaVersion: 3,
    });

    expect(failure.schemaVersion).toBe(3);
    expect(failure.issues).toEqual([
      expect.objectContaining({
        path: '/schemaVersion',
        allowedValues: [1, 2],
      }),
    ]);
  });

  it('keeps accepting any positive version for non-versioned report types', () => {
    expect(() =>
      validateReportPayload({
        reportType: 'SNAPSHOT',
        payload: VALID_PAYLOAD_BY_TYPE.SNAPSHOT,
        schemaVersion: 7,
      }),
    ).not.toThrow();
  });

  it('ignores internal envelope metadata but checks the payload itself', () => {
    expect(() =>
      validateReportPayload({
        reportType: 'SNAPSHOT',
        payload: {
          ...VALID_PAYLOAD_BY_TYPE.SNAPSHOT,
          __reportEnvelope: { agent: 'planner' },
        },
        schemaVersion: 1,
      }),
    ).not.toThrow();
  });

  it('rejects a report type with no registered schema', () => {
    expect(
      failureOf({ reportType: 'NOT_A_TYPE', payload: {}, schemaVersion: 1 })
        .issues[0],
    ).toMatchObject({ keyword: 'reportType' });
  });

  it('does not echo submitted values in the error message', () => {
    try {
      validateReportPayload({
        reportType: 'SNAPSHOT',
        payload: { reportType: 'SNAPSHOT', summary: 42, secret: 'hunter2' },
        schemaVersion: 1,
      });
    } catch (error) {
      expect(JSON.stringify((error as Error).message)).not.toContain('hunter2');
      return;
    }
    throw new Error('Expected the report to be rejected');
  });
});
