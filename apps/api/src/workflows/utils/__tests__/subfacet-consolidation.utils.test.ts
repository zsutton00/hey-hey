import { SummaryCategory } from '@prisma/client';
import { topologyCategories } from 'src/flows/utils/topology-schemas';
import {
  buildCategorySummarizationRequestId,
  buildConsolidationRequestId,
  resolveConsolidationCategories,
} from '../subfacet-consolidation.utils';

describe('subfacet consolidation utils', () => {
  it('returns provided categories when present', () => {
    const categories = resolveConsolidationCategories([
      SummaryCategory.process,
    ]);
    expect(categories).toEqual([SummaryCategory.process]);
  });

  it('falls back to topology categories when none provided', () => {
    const categories = resolveConsolidationCategories(undefined);
    expect(categories).toEqual(topologyCategories);
    expect(categories).not.toBe(topologyCategories);
  });

  it('builds stable request ids', () => {
    const id = buildConsolidationRequestId(
      'wf-123' as any,
      SummaryCategory.people,
      2,
    );
    expect(id).toBe('subfacet-consolidation-people-wf-123-2');
  });

  it('builds stable category request ids', () => {
    const id = buildCategorySummarizationRequestId(
      'wf-456' as any,
      SummaryCategory.technology,
      1,
    );
    expect(id).toBe('category-summarization-technology-wf-456-1');
  });
});
