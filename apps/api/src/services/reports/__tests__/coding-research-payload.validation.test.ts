import { BadRequestException } from '@nestjs/common';
import { ReportType } from 'src/generated';
import { validateCodingResearchPayload } from '../coding-research-payload.validation';

const validPayload = {
  reportType: 'CODING_RESEARCH',
  summary: 'handoff',
  analysis: 'analysis',
  frame: {},
  provenance: { discoveryCalls: [], edgesTraversed: [] },
  updates: [],
};

describe('CODING_RESEARCH submission boundary', () => {
  it('accepts a payload that satisfies the schema', () => {
    expect(
      validateCodingResearchPayload(ReportType.CodingResearch, validPayload),
    ).toEqual(validPayload);
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
