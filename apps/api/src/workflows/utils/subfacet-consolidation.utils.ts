import { SummaryCategory } from '@prisma/client';
import { topologyCategories } from 'src/flows/utils/topology-schemas';
import { WorkflowId } from 'src/types';

export function resolveConsolidationCategories(
  categories?: SummaryCategory[],
): SummaryCategory[] {
  return categories?.length ? categories : [...topologyCategories];
}

export function buildConsolidationRequestId(
  workflowId: WorkflowId,
  category: SummaryCategory,
  index: number | string,
): string {
  return `subfacet-consolidation-${category}-${workflowId}-${index}`;
}

export function buildCategorySummarizationRequestId(
  workflowId: WorkflowId,
  category: SummaryCategory,
  index: number,
): string {
  return `category-summarization-${category}-${workflowId}-${index}`;
}

export function buildSubfacetSummarizationRequestId(
  workflowId: WorkflowId,
  subfacetSlug: string,
  index: number,
): string {
  return `subfacet-summarization-${subfacetSlug}-${workflowId}-${index}`;
}
