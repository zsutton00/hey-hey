import { describe, expect, it } from 'vitest';
import {
  filterEvalReportsFromToolResult,
  withholdEvalMutationTools,
} from './eval-execution-context';

describe('withholdEvalMutationTools', () => {
  it('drops direct mutation tools and keeps reads and proposal authoring', () => {
    expect(
      withholdEvalMutationTools([
        'get_context',
        'unified_search',
        'create_edge',
        'delete_edge',
        'update_edge',
        'update_proposal',
        'edit_work_item',
        'create_work_item',
        'list_reports_by_entity',
      ]),
    ).toEqual([
      'get_context',
      'unified_search',
      'edit_work_item',
      'create_work_item',
      'list_reports_by_entity',
    ]);
  });
});

describe('filterEvalReportsFromToolResult', () => {
  it('removes eval reports from listed results', () => {
    const listing = {
      reports: [
        { id: 'r1', reportType: 'PLAN' },
        { id: 'r2', reportType: 'EVAL_RUN' },
        { id: 'r3', payload: { reportType: 'EVAL_ATTEMPT' } },
        { id: 'r4', reportType: 'EVAL_HUMAN_REVIEW' },
      ],
    };
    const result = filterEvalReportsFromToolResult({
      content: [{ type: 'text', text: JSON.stringify(listing) }],
      structuredContent: listing,
    });
    expect(result).toEqual({
      content: [
        { type: 'text', text: JSON.stringify({ reports: [{ id: 'r1', reportType: 'PLAN' }] }) },
      ],
      structuredContent: { reports: [{ id: 'r1', reportType: 'PLAN' }] },
    });
  });

  it('answers a direct read of an eval report as not found', () => {
    expect(
      filterEvalReportsFromToolResult({
        content: [{ type: 'text', text: JSON.stringify({ id: 'r2', reportType: 'EVAL_ATTEMPT' }) }],
      }),
    ).toEqual({ isError: true, content: [{ type: 'text', text: 'Report not found.' }] });
  });

  it('leaves ordinary results untouched', () => {
    const result = { content: [{ type: 'text', text: 'plain words' }] };
    expect(filterEvalReportsFromToolResult(result)).toEqual(result);
  });
});
