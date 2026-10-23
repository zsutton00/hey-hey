import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { StagedContentModule } from '../../../modules/staged-content.module';
import { BrainstormRefinementWelcomeNode } from './welcome.node';
import { BrainstormRefinementAgentAnalysisNode } from './agent_refiner.node';
import { BrainstormRefinementFinalizeNode } from './finalize_action.node';
import { BrainstormRefinementRecoveryNode } from './recovery.node';
import { BrainstormRefinementEndNode } from './end.node';

@Module({
  imports: [StagedContentModule],
  providers: [
    BrainstormRefinementWelcomeNode,
    BrainstormRefinementAgentAnalysisNode,
    BrainstormRefinementFinalizeNode,
    BrainstormRefinementRecoveryNode,
    BrainstormRefinementEndNode,
  ],
  exports: [
    BrainstormRefinementWelcomeNode,
    BrainstormRefinementAgentAnalysisNode,
    BrainstormRefinementFinalizeNode,
    BrainstormRefinementRecoveryNode,
    BrainstormRefinementEndNode,
  ],
})
export class BrainstormRefinementNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private welcomeNode: BrainstormRefinementWelcomeNode,
    private agentAnalysisNode: BrainstormRefinementAgentAnalysisNode,
    private finalizeNode: BrainstormRefinementFinalizeNode,
    private recoveryNode: BrainstormRefinementRecoveryNode,
    private endNode: BrainstormRefinementEndNode,
  ) {}

  onModuleInit() {
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(
      this.agentAnalysisNode as unknown as BrainstormRefinementWelcomeNode,
    );
    this.nodeRegistry.register(this.finalizeNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
  }
}
