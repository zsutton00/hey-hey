import {
  CategorySummarizationRun,
  SubfacetConsolidationRun,
  SubfacetSummarizationRun,
  SummaryCategory,
} from '@prisma/client';
import { z } from 'zod';
import {
  categoryConsolidationSchema,
  subfacetSummarizationSchema,
  topologyConsolidationSchema,
} from 'src/flows/utils/topology-schemas';
import {
  SummarizationJobInput,
  SummarizationTriggerType,
} from '../summarization/summarization.types';

export type ConsolidationAuditMap = Partial<
  Record<SummaryCategory, SubfacetConsolidationRun | null>
>;

export type CategorySummarizationAuditMap = Partial<
  Record<SummaryCategory, CategorySummarizationRun | null>
>;

export type SubfacetSummarizationAuditMap = Partial<
  Record<string, SubfacetSummarizationRun | null>
>;

export interface SubfacetConsolidationJobInput extends SummarizationJobInput {
  since: string;
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  categories?: SummaryCategory[];
  threshold?: number;
  auditByCategory?: ConsolidationAuditMap;
  maxIterations?: number;
  maxEntitiesPerRun?: number;
  maxEntitiesPerSubfacet?: number;
}

export interface CategorySummarizationJobInput extends SummarizationJobInput {
  since: string;
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  categoryPromptMode?: 'legacy' | 'large';
  maxSubfacetsInPrompt?: number;
  changedEntitySamplePerSubfacet?: number;
  categories?: SummaryCategory[];
  maxPerCategory?: number;
  maxPerSubfacet?: number;
  auditByCategory?: CategorySummarizationAuditMap;
}

export interface SubfacetSummarizationJobInput extends SummarizationJobInput {
  since: string;
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  categories?: SummaryCategory[];
  subfacetIds?: string[];
  maxEntities?: number;
  auditBySubfacet?: SubfacetSummarizationAuditMap;
}

export type SubfacetConsolidationResult = {
  category: SummaryCategory;
  requestId: string;
  response?: z.infer<typeof topologyConsolidationSchema>;
  error?: string;
  previousAudit?: SubfacetConsolidationRun | null;
};

export type CategorySummarizationResult = {
  category: SummaryCategory;
  requestId: string;
  response?: z.infer<typeof categoryConsolidationSchema>;
  error?: string;
  previousAudit?: CategorySummarizationRun | null;
};

export type SubfacetSummarizationResult = {
  subfacetId: string;
  subfacetSlug: string;
  category: SummaryCategory;
  requestId: string;
  response?: z.infer<typeof subfacetSummarizationSchema>;
  error?: string;
  previousAudit?: SubfacetSummarizationRun | null;
};

export type SubfacetConsolidationRunResult = {
  trigger: SummarizationTriggerType;
  since: string;
  categories: SubfacetConsolidationResult[];
};

export type CategorySummarizationRunResult = {
  trigger: SummarizationTriggerType;
  since: string;
  categories: CategorySummarizationResult[];
};

export type SubfacetSummarizationRunResult = {
  trigger: SummarizationTriggerType;
  since: string;
  subfacets: SubfacetSummarizationResult[];
};

export interface TopologyScheduledConsolidationWorkflowInput {
  organizationId: string;
  projectId: string;
  since: string;
  topologyConsolidationRunId: string;
  temporalWorkflowId: string;
  workflowAboutType: 'project';
  workflowAboutId: string;
  trigger: 'scheduled';
  categoryPromptMode?: 'legacy' | 'large';
  maxSubfacetsInPrompt?: number;
  changedEntitySamplePerSubfacet?: number;
  categories?: SummaryCategory[];
  threshold?: number;
  maxIterations?: number;
  maxEntitiesPerRun?: number;
  maxEntitiesPerSubfacet?: number;
  maxEntitiesPerSubfacetSummary?: number;
  maxPerCategory?: number;
  maxPerSubfacet?: number;
}

export type TopologyScheduledConsolidationWorkflowResult = {
  since: string;
  trigger: 'scheduled';
  hadUpstreamChanges: boolean;
  ranCategorySummarization: boolean;
  subfacetSummarization: SubfacetSummarizationRunResult;
  subfacetConsolidation: SubfacetConsolidationRunResult;
  categorySummarization?: CategorySummarizationRunResult;
};
