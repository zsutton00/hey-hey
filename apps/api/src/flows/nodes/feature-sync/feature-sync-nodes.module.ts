import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { FeatureSyncAnalyzeNode } from './analyze.node';
import { FeatureSyncCodingPlanNode } from './coding-plan.node';
import { FeatureSyncEndNode } from './end.node';
import { FeatureSyncImplementNode } from './implement.node';
import { ImplementRuntimeService } from './implement-runtime.service';
import { FeatureSyncIterateNode } from './iterate.node';
import { FeatureSyncOpenerNode } from './opener.node';
import { FeatureSyncImplementationReadinessReviewNode } from './implementation-readiness-review.node';

@Module({
  providers: [
    ImplementRuntimeService,
    FeatureSyncOpenerNode,
    FeatureSyncAnalyzeNode,
    FeatureSyncIterateNode,
    FeatureSyncImplementationReadinessReviewNode,
    FeatureSyncCodingPlanNode,
    FeatureSyncImplementNode,
    FeatureSyncEndNode,
  ],
  exports: [
    FeatureSyncOpenerNode,
    FeatureSyncAnalyzeNode,
    FeatureSyncIterateNode,
    FeatureSyncImplementationReadinessReviewNode,
    FeatureSyncCodingPlanNode,
    FeatureSyncImplementNode,
    FeatureSyncEndNode,
  ],
})
export class FeatureSyncNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly openerNode: FeatureSyncOpenerNode,
    private readonly analyzeNode: FeatureSyncAnalyzeNode,
    private readonly iterateNode: FeatureSyncIterateNode,
    private readonly implementationReadinessReviewNode: FeatureSyncImplementationReadinessReviewNode,
    private readonly codingPlanNode: FeatureSyncCodingPlanNode,
    private readonly implementNode: FeatureSyncImplementNode,
    private readonly endNode: FeatureSyncEndNode,
  ) {}

  onModuleInit(): void {
    this.nodeRegistry.register(this.openerNode);
    this.nodeRegistry.register(this.analyzeNode);
    this.nodeRegistry.register(this.iterateNode);
    this.nodeRegistry.register(this.implementationReadinessReviewNode);
    this.nodeRegistry.register(this.codingPlanNode);
    this.nodeRegistry.register(this.implementNode);
    this.nodeRegistry.register(this.endNode);
  }
}
