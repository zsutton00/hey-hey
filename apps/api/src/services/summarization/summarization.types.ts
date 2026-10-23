import { SummaryCategory } from '@prisma/client';
import {
  subfacetTopologySchema,
  topLevelTopologySchema,
} from 'src/flows/utils/topology-schemas';
import { OrganizationId, ProjectId, WorkflowAboutType } from 'src/types';
import { z } from 'zod';

export type SummarizationTriggerType = 'on_demand' | 'scheduled';

export interface SummarizationJobInput {
  organizationId: OrganizationId;
  projectId: ProjectId;
  workflowAboutType: WorkflowAboutType;
  trigger: SummarizationTriggerType;
  workflowAboutId?: string;
  since?: string;
}

export type SummarizationStatus = 'completed' | 'failed';

export const subfacetTopologyResponseSchema = subfacetTopologySchema;
export const categoryTopologyResponseSchema = topLevelTopologySchema.pick({
  categories: true,
});

export type SubfacetTopologyResponse = z.infer<
  typeof subfacetTopologyResponseSchema
>;
export type CategoryTopologyResponse = z.infer<
  typeof categoryTopologyResponseSchema
>;

export type SubfacetSummaryResult = {
  subfacet: string;
  category: SummaryCategory;
  summary?: SubfacetTopologyResponse;
  status: SummarizationStatus;
  error?: string;
};

export type CategorySummaryResult = {
  category: SummaryCategory;
  summary?: CategoryTopologyResponse['categories'][number];
  status: SummarizationStatus;
  error?: string;
};

export type SummarizationRunResult = {
  trigger: SummarizationTriggerType;
  since?: string;
};
