import { Injectable } from '@nestjs/common';
import { SummaryCategory } from '@prisma/client';
import { EntitySummaryService } from '../entity-summary/entity-summary.service';
import {
  CategoryTopologyResponse,
  SubfacetTopologyResponse,
  SummarizationJobInput,
} from './summarization.types';
import { FlowContext } from 'src/types/flow-internal.types';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from 'src/types';

export type UpdatedSubfacet = { category: SummaryCategory; subfacet: string };

@Injectable()
export class SummarizationService {
  constructor(private readonly entitySummaryService: EntitySummaryService) {}

  async getUpdatedSubfacets(
    organizationId: OrganizationId,
    projectId: ProjectId,
    since?: Date,
  ): Promise<UpdatedSubfacet[]> {
    const summaries =
      await this.entitySummaryService.getCurrentSummariesByCategory({
        organizationId,
        projectId,
        since,
      });

    const seen = new Set<string>();
    const updated: UpdatedSubfacet[] = [];
    for (const item of summaries) {
      for (const sf of item.subfacets || []) {
        const key = `${item.category}:${sf.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        updated.push({ category: item.category, subfacet: sf.name });
      }
    }

    return updated;
  }

  buildFlowContext(
    job: SummarizationJobInput,
    workflowId: WorkflowId,
    metadata?: Record<string, unknown>,
    options?: {
      flowId?: string;
      workflowAboutId?: string;
      workflowAboutType?: WorkflowAboutType;
    },
  ): FlowContext {
    const flowId = options?.flowId ?? 'topology-summarization';
    const workflowAboutId =
      options?.workflowAboutId ?? job.workflowAboutId ?? job.projectId;
    const workflowAboutType =
      options?.workflowAboutType ?? job.workflowAboutType;

    return {
      core: {
        workflowId,
        projectId: job.projectId,
        organizationId: job.organizationId,
        conversationId: `summarization-${workflowId}` as ConversationId,
        workflowAboutId,
        workflowAboutType,
        user: { id: 'system' as UserId, role: 'system' },
        session: { startTime: new Date(), interactionCount: 0 },
      },
      flowId,
      flowPath: { pathTaken: [] },
      metadata,
    };
  }

  extractCategoryResult(
    category: SummaryCategory,
    response: CategoryTopologyResponse,
  ): CategoryTopologyResponse['categories'][number] | undefined {
    return (
      response.categories?.find((c) => c.category === category) ||
      response.categories?.[0]
    );
  }

  extractSubfacetResult(
    response: SubfacetTopologyResponse,
  ): SubfacetTopologyResponse {
    return response;
  }
}
