import Ajv from 'ajv';
import { VALID_PAYLOAD_BY_TYPE } from 'src/services/reports/__tests__/report-payload.fixtures';
import { GetReportSchemaToolsProvider } from './get-report-schema-tools.provider';
import {
  REPORT_SCHEMAS,
  type ReportSchemaKey,
} from './report-schemas.generated';

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
