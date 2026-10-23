import { Injectable, Logger } from '@nestjs/common';
import { EntityType, SummaryCategory } from '@prisma/client';
import { OrganizationId, ProjectId } from 'src/types';
import { SubfacetCandidateService } from './subfacet-candidate.service';
import { SubfacetService } from './subfacet.service';
import { shouldAllowDirectProvisionalCreate } from './subfacet-lifecycle.policy';

export interface HandleProposedSubfacetInput {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category: SummaryCategory;
  proposedNewSubfacetName: string;
  proposedNewSubfacetConfidence?: number;
  proposedNewSubfacetRationale?: string;
  sourceEntityType: EntityType;
  sourceEntityId: string;
  activeCount: number;
  provisionalCount: number;
  directCreatesThisRunForCategory: number;
}

export interface HandleProposedSubfacetResult {
  selectedSubfacetName?: string;
  activeCount: number;
  provisionalCount: number;
  directCreatesThisRunForCategory: number;
}

@Injectable()
export class SubfacetLifecycleService {
  private readonly logger = new Logger(SubfacetLifecycleService.name);

  constructor(
    private readonly subfacetService: SubfacetService,
    private readonly subfacetCandidateService: SubfacetCandidateService,
  ) {}

  async handleProposedSubfacet(
    input: HandleProposedSubfacetInput,
  ): Promise<HandleProposedSubfacetResult> {
    const proposedName = input.proposedNewSubfacetName.trim();
    if (!proposedName) {
      return {
        activeCount: input.activeCount,
        provisionalCount: input.provisionalCount,
        directCreatesThisRunForCategory: input.directCreatesThisRunForCategory,
      };
    }

    const shouldDirectCreate = shouldAllowDirectProvisionalCreate({
      activeCount: input.activeCount,
      provisionalCount: input.provisionalCount,
      directCreatesThisRunForCategory: input.directCreatesThisRunForCategory,
    });

    if (shouldDirectCreate) {
      const subfacet = await this.subfacetService.createProvisionalSubfacet({
        organizationId: input.organizationId,
        projectId: input.projectId,
        category: input.category,
        name: proposedName,
      });

      return {
        selectedSubfacetName: subfacet.name,
        activeCount: input.activeCount,
        provisionalCount: input.provisionalCount + 1,
        directCreatesThisRunForCategory:
          input.directCreatesThisRunForCategory + 1,
      };
    }

    const candidateResult = await this.subfacetCandidateService.recordCandidate(
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        category: input.category,
        name: proposedName,
        confidence: input.proposedNewSubfacetConfidence,
        rationale: input.proposedNewSubfacetRationale,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
      },
    );
    this.logger.log('[handleProposedSubfacet] recorded subfacet candidate', {
      entityType: input.sourceEntityType,
      entityId: input.sourceEntityId,
      category: input.category,
      proposedNewSubfacetName: proposedName,
      candidateId: candidateResult.candidateId,
      skippedReason: candidateResult.skippedReason,
    });

    return {
      activeCount: input.activeCount,
      provisionalCount: input.provisionalCount,
      directCreatesThisRunForCategory: input.directCreatesThisRunForCategory,
    };
  }
}
