import { Module, OnModuleInit } from '@nestjs/common';
import { ContextModule } from 'src/context/context.module';
import { NodeRegistry } from '../node-registry.service';
import { SubfacetConsolidationNode } from './subfacet-consolidation.node';
import { CategorySummarizationNode } from './category-summarization.node';
import { SubfacetSummarizationNode } from './subfacet-summarization.node';
import { SummarizeNode } from './entity-summarize.node';
import { TopologyAuditService } from 'src/services/audit/topology-audit.service';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { TopologyCategorySummaryService } from 'src/services/topology/topology-category-summary.service';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { SubfacetCandidateService } from 'src/services/entity-summary/subfacet-candidate.service';
import { SubfacetLifecycleService } from 'src/services/entity-summary/subfacet-lifecycle.service';
import { PlanModule } from 'src/services/plan/plan.module';

@Module({
  imports: [ContextModule, PlanModule],
  providers: [
    SubfacetConsolidationNode,
    CategorySummarizationNode,
    SubfacetSummarizationNode,
    SummarizeNode,
    TopologyAuditService,
    SubfacetService,
    EntitySummaryService,
    SubfacetCandidateService,
    SubfacetLifecycleService,
    TopologyCategorySummaryService,
  ],
  exports: [
    SubfacetConsolidationNode,
    CategorySummarizationNode,
    SubfacetSummarizationNode,
    SummarizeNode,
    TopologyAuditService,
    SubfacetService,
    EntitySummaryService,
    SubfacetCandidateService,
    SubfacetLifecycleService,
    TopologyCategorySummaryService,
  ],
})
export class TopologyNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly consolidationNode: SubfacetConsolidationNode,
    private readonly categoryConsolidationNode: CategorySummarizationNode,
    private readonly subfacetSummarizationNode: SubfacetSummarizationNode,
    private readonly summarizeNode: SummarizeNode,
  ) {}

  onModuleInit() {
    this.nodeRegistry.register(this.consolidationNode);
    this.nodeRegistry.register(this.categoryConsolidationNode);
    this.nodeRegistry.register(this.subfacetSummarizationNode);
    this.nodeRegistry.register(this.summarizeNode);
  }
}
