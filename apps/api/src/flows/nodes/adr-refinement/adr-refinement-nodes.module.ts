import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { StagedContentModule } from '../../../modules/staged-content.module';
import { AdrRefinementWelcomeNode } from './welcome.node';
import { AdrRefinementAgentAnalysisNode } from './agent_refiner.node';
import { AdrRefinementAgentNextLevelNode } from './agent_next_level.node';
import { AdrRefinementStartingAgentNode } from './starting_agent.node';
import { AdrRefinementFinalizeNode } from './finalize_action.node';
import { AdrRefinementRecoveryNode } from './recovery.node';
import { AdrRefinementEndNode } from './end.node';

/**
 * Module for ADR Refinement flow nodes
 *
 * Registers all ADR refinement-related nodes with the NodeRegistry
 * during module initialization.
 *
 * Imports:
 * - StagedContentModule: Provides DesignDocService for ADR operations
 *
 * Note: LLM services (LLMClientService, PromptBuilderService, etc.) are available
 * globally from WorkflowModule
 */
@Module({
  imports: [StagedContentModule],
  providers: [
    AdrRefinementWelcomeNode,
    AdrRefinementAgentAnalysisNode,
    AdrRefinementAgentNextLevelNode,
    AdrRefinementStartingAgentNode,
    AdrRefinementFinalizeNode,
    AdrRefinementRecoveryNode,
    AdrRefinementEndNode,
  ],
  exports: [
    AdrRefinementWelcomeNode,
    AdrRefinementAgentAnalysisNode,
    AdrRefinementAgentNextLevelNode,
    AdrRefinementStartingAgentNode,
    AdrRefinementFinalizeNode,
    AdrRefinementRecoveryNode,
    AdrRefinementEndNode,
  ],
})
export class AdrRefinementNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private welcomeNode: AdrRefinementWelcomeNode,
    private agentAnalysisNode: AdrRefinementAgentAnalysisNode,
    private agentNextLevelNode: AdrRefinementAgentNextLevelNode,
    private startingAgentNode: AdrRefinementStartingAgentNode,
    private finalizeNode: AdrRefinementFinalizeNode,
    private recoveryNode: AdrRefinementRecoveryNode,
    private endNode: AdrRefinementEndNode,
  ) {}

  onModuleInit() {
    // Register all ADR refinement nodes with the registry
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(
      this.agentAnalysisNode as unknown as AdrRefinementWelcomeNode,
    );
    this.nodeRegistry.register(
      this.agentNextLevelNode as unknown as AdrRefinementWelcomeNode,
    );
    this.nodeRegistry.register(
      this.startingAgentNode as unknown as AdrRefinementWelcomeNode,
    );
    this.nodeRegistry.register(this.finalizeNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
  }
}
