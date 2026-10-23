import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { StagedContentModule } from '../../../modules/staged-content.module';
import { DecisionRefinementWelcomeNode } from './welcome.node';
import { DecisionRefinementAgentAnalysisNode } from './agent_refiner.node';
import { DecisionRefinementFinalizeNode } from './finalize_action.node';
import { DecisionRefinementRecoveryNode } from './recovery.node';
import { DecisionRefinementEndNode } from './end.node';

@Module({
  imports: [StagedContentModule],
  providers: [
    DecisionRefinementWelcomeNode,
    DecisionRefinementAgentAnalysisNode,
    DecisionRefinementFinalizeNode,
    DecisionRefinementRecoveryNode,
    DecisionRefinementEndNode,
  ],
  exports: [
    DecisionRefinementWelcomeNode,
    DecisionRefinementAgentAnalysisNode,
    DecisionRefinementFinalizeNode,
    DecisionRefinementRecoveryNode,
    DecisionRefinementEndNode,
  ],
})
export class DecisionRefinementNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private welcomeNode: DecisionRefinementWelcomeNode,
    private agentAnalysisNode: DecisionRefinementAgentAnalysisNode,
    private finalizeNode: DecisionRefinementFinalizeNode,
    private recoveryNode: DecisionRefinementRecoveryNode,
    private endNode: DecisionRefinementEndNode,
  ) {}

  onModuleInit() {
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(
      this.agentAnalysisNode as unknown as DecisionRefinementWelcomeNode,
    );
    this.nodeRegistry.register(this.finalizeNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
  }
}
