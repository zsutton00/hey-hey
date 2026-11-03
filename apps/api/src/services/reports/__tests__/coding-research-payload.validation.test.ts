import { BadRequestException } from '@nestjs/common';
import { ReportType } from '@hey-hey/contracts/api/models';
import { validateCodingResearchPayload } from '../coding-research-payload.validation';

const validPayload = {
  reportType: 'CODING_RESEARCH',
  format: 'STRUCTURED',
  summary: 'handoff',
  analysis: 'analysis',
  frame: {},
  provenance: { discoveryCalls: [], edgesTraversed: [] },
  updates: [],
  uncertainties: [],
};

describe('CODING_RESEARCH submission boundary', () => {
  it('accepts a payload that satisfies the schema', () => {
    expect(
      validateCodingResearchPayload(ReportType.CodingResearch, validPayload),
    ).toEqual(validPayload);
  });

  it('accepts and preserves a parent-authored written report', () => {
    const writtenPayload = {
      reportType: 'CODING_RESEARCH',
      format: 'WRITTEN',
      summary: 'The parent researched the project and wrote this handoff.',
      analysis:
        'Findings from the project.\n\n## Uncertainties\n\n- None found.',
    };

    expect(
      validateCodingResearchPayload(ReportType.CodingResearch, writtenPayload),
    ).toEqual(writtenPayload);
  });

  it('rejects a payload without provenance and names the missing property', () => {
    const { provenance: _provenance, ...withoutProvenance } = validPayload;
    expect(() =>
      validateCodingResearchPayload(
        ReportType.CodingResearch,
        withoutProvenance,
      ),
    ).toThrow(/provenance/);
    expect(() =>
      validateCodingResearchPayload(
        ReportType.CodingResearch,
        withoutProvenance,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a CODING_RESEARCH payload under another envelope type', () => {
    expect(() =>
      validateCodingResearchPayload(ReportType.Snapshot, validPayload),
    ).toThrow(BadRequestException);
  });

  it('ignores other report types', () => {
    expect(
      validateCodingResearchPayload(ReportType.Snapshot, { summary: 'ok' }),
    ).toBeUndefined();
  });
});
