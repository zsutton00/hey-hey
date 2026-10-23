import { describe, expect, it } from 'vitest';

import {
  CODING_AGENT_REPORT_TYPES,
  prependPriorReports,
  renderReportChainBlock,
} from './report-chain';
import type { ReportChainEntry } from '../../run/types';

const makeEntry = (overrides?: Partial<ReportChainEntry>): ReportChainEntry => ({
  createdAt: '2026-04-26T01:00:00.000Z',
  phase: 'startup_session' as ReportChainEntry['phase'],
  reportId: 'rep-1',
  reportType: 'SESSION_SUMMARY' as ReportChainEntry['reportType'],
  summary: 'first summary',
  audience: 'EXTERNAL',
  ...overrides,
});

describe('renderReportChainBlock', () => {
  it('renders a self-introducing header, per-entry metadata, and summary body for a single entry', () => {
    const block = renderReportChainBlock([
      makeEntry({
        createdAt: '2026-04-26T01:00:00.000Z',
        phase: 'startup_session' as ReportChainEntry['phase'],
        reportId: 'rep-startup',
        reportType: 'SESSION_SUMMARY' as ReportChainEntry['reportType'],
        summary: 'startup body',
        audience: 'EXTERNAL',
      }),
    ]);

    expect(block).toContain('## Prior reports on this task');
    expect(block).toContain('get_report_body');
    expect(block).toContain('### SESSION_SUMMARY report — 2026-04-26T01:00:00.000Z');
    expect(block).toContain('- reportId: `rep-startup`');
    expect(block).toContain('- phase: startup_session');
    expect(block).toContain('- audience: EXTERNAL');
    expect(block).toContain('startup body');
  });

  it('renders a placeholder when the summary is empty so the gap is legible', () => {
    const block = renderReportChainBlock([makeEntry({ reportId: 'rep-blank', summary: '' })]);

    expect(block).toContain('- reportId: `rep-blank`');
    expect(block).toContain('no summary recorded');
    expect(block).toContain('get_report_body');
  });

  it('preserves insertion order across entries', () => {
    const block = renderReportChainBlock([
      makeEntry({ reportId: 'rep-first', summary: 'first body' }),
      makeEntry({
        reportId: 'rep-second',
        summary: 'second body',
        createdAt: '2026-04-26T03:00:00.000Z',
      }),
    ]);

    const firstIdx = block.indexOf('rep-first');
    const secondIdx = block.indexOf('rep-second');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });
});

describe('prependPriorReports', () => {
  it('returns the body unchanged when the chain is empty', () => {
    const body = 'system prompt body';
    expect(prependPriorReports(body, [])).toBe(body);
  });

  it('prepends the rendered chain block above the body with a separator', () => {
    const body = 'system prompt body';
    const result = prependPriorReports(body, [makeEntry({ summary: 'chain body' })]);

    expect(result).toContain('## Prior reports on this task');
    expect(result).toContain('chain body');
    expect(result.endsWith(body)).toBe(true);
    expect(result).toContain('\n\n---\n\n');
  });
});

describe('CODING_AGENT_REPORT_TYPES', () => {
  it('contains the types produced by coding agents', () => {
    expect(CODING_AGENT_REPORT_TYPES.has('PLAN')).toBe(true);
    expect(CODING_AGENT_REPORT_TYPES.has('IMPLEMENT')).toBe(true);
    expect(CODING_AGENT_REPORT_TYPES.has('FEATURE_SYNC')).toBe(true);
    expect(CODING_AGENT_REPORT_TYPES.has('FEATURE_SYNC_HANDOFF')).toBe(true);
    expect(CODING_AGENT_REPORT_TYPES.has('CODING_RESEARCH')).toBe(true);
    expect(CODING_AGENT_REPORT_TYPES.size).toBe(5);
  });

  it('excludes non-coding report types', () => {
    expect(CODING_AGENT_REPORT_TYPES.has('GOAL_PROGRESS')).toBe(false);
    expect(CODING_AGENT_REPORT_TYPES.has('SESSION_SUMMARY')).toBe(false);
    expect(CODING_AGENT_REPORT_TYPES.has('DAILY_SESSION')).toBe(false);
  });

  it('filters out a GOAL_PROGRESS entry when applied to a chain', () => {
    const chain = [
      makeEntry({ reportId: 'rep-plan', reportType: 'PLAN' as ReportChainEntry['reportType'] }),
      makeEntry({
        reportId: 'rep-goal',
        reportType: 'GOAL_PROGRESS' as ReportChainEntry['reportType'],
      }),
      makeEntry({
        reportId: 'rep-impl',
        reportType: 'IMPLEMENT' as ReportChainEntry['reportType'],
      }),
    ];
    const filtered = chain.filter((e) => CODING_AGENT_REPORT_TYPES.has(e.reportType));
    expect(filtered.map((e) => e.reportId)).toEqual(['rep-plan', 'rep-impl']);
    const block = renderReportChainBlock(filtered);
    expect(block).toContain('rep-plan');
    expect(block).toContain('rep-impl');
    expect(block).not.toContain('rep-goal');
  });
});
