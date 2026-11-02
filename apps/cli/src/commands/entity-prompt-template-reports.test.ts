import { describe, expect, it } from 'vitest';
import { EntityPromptTemplateSyntaxVersion } from '../shared/api/generated/api';
import { parseEntityPromptTemplate } from '../shared/api/generated/entity-prompt-template-language';
import {
  buildReportValue,
  collectReferencedReportTypes,
  selectNewestReport,
} from './entity-prompt-template-reports';
import { entityPromptTemplateLanguageFor } from './entity-prompt-template-renderer';

const report = (reportId: string, createdAt: string) => ({
  reportId,
  reportType: 'CODING_RESEARCH',
  createdAt,
});

describe('selectNewestReport', () => {
  it('chooses by creation time rather than position and collapses duplicate identities', () => {
    const newest = report('report-b', '2026-11-02T10:00:00.000Z');
    const selected = selectNewestReport([
      newest,
      report('report-a', '2026-11-01T10:00:00.000Z'),
      report('report-a', '2026-11-01T10:00:00.000Z'),
    ]);

    expect(selected).toEqual(newest);
  });

  it('breaks equal timestamps by identity so every read picks the same report', () => {
    const at = '2026-11-02T10:00:00.000Z';

    expect(selectNewestReport([report('report-a', at), report('report-b', at)])?.reportId).toBe(
      'report-b',
    );
    expect(selectNewestReport([report('report-b', at), report('report-a', at)])?.reportId).toBe(
      'report-b',
    );
  });

  it('returns null when nothing was saved', () => {
    expect(selectNewestReport([])).toBeNull();
  });
});

describe('collectReferencedReportTypes', () => {
  it('finds report types in conditions, nested branches and substitutions only', () => {
    const template =
      '{{#if reports.CODING_RESEARCH.latest}}{{reports.CODING_RESEARCH.latest.summary}}' +
      '{{else}}{{#if reports.PLAN.latest}}x{{/if}}{{entity.name}}{{/if}}';
    const { nodes } = parseEntityPromptTemplate(
      template,
      entityPromptTemplateLanguageFor(EntityPromptTemplateSyntaxVersion.V1),
    );

    expect([...collectReferencedReportTypes(nodes)].sort()).toEqual(['CODING_RESEARCH', 'PLAN']);
  });
});

describe('buildReportValue', () => {
  const saved = report('report-a', '2026-11-02T10:00:00.000Z');

  it('shows a dated research memo for CODING_RESEARCH and keeps the summary separate', () => {
    const value = buildReportValue(saved, {
      reportType: 'CODING_RESEARCH',
      summary: 'Short handoff',
      analysis: 'Full analysis text',
      frame: { focalId: 'task-1' },
      provenance: { discoveryCalls: [], edgesTraversed: [] },
      updates: [],
    });

    expect(value.summary).toBe('Short handoff');
    expect(value.latest).toContain('2026-11-02T10:00:00.000Z');
    expect(value.latest).toContain('## Research frame');
    expect(value.latest).toContain('Full analysis text');
  });

  it('falls back to the dated summary for a type without a dedicated formatter', () => {
    const value = buildReportValue(
      { ...saved, reportType: 'DECISION_NEEDED' },
      {
        reportType: 'DECISION_NEEDED',
        summary: 'Pick a path',
        question: 'Which path?',
        options: [{ description: 'A' }],
      },
    );

    expect(value.summary).toBe('Pick a path');
    expect(value.latest).toBe(
      '### DECISION_NEEDED report — 2026-11-02T10:00:00.000Z\n\nPick a path',
    );
  });
});
