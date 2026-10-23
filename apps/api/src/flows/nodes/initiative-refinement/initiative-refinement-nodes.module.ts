import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';

// Node imports
import { InitiativeRefinementAgentEditorNode } from './agent_editor.node';
import { InitiativeRefinementAgentNextLevelNode } from './agent_next_level.node';
import { InitiativeRefinementEndNode } from './initiative-refinement-end.node';
import { InitiativeRefinementFinalizeNode } from './initiative-refinement-finalize.node';
import { InitiativeRefinementRecoveryNode } from './initiative-refinement-recovery.node';
import { InitiativeRefinementWelcomeNode } from './initiative-refinement-welcome.node';

// Module imports
import { WorkItemModule } from '../../../services/work-item.module';
import { InitiativeRefinementPromptNextInputNode } from './initiative-refinement-prompt-next-input.node';

/**
 * Initiative Refinement Nodes Module
 *
 * Provides all nodes for the initiative refinement workflow.
 * Nodes are registered with NodeRegistry on module initialization.
 *
 * Imports:
 * - WorkItemModule: Provides InitiativeService, InitiativeOptimizationService, and other work item services
 */
@Module({
  imports: [WorkItemModule],
  providers: [
    // Nodes
    InitiativeRefinementWelcomeNode,
    InitiativeRefinementPromptNextInputNode,

    InitiativeRefinementFinalizeNode,
    InitiativeRefinementEndNode,
    InitiativeRefinementRecoveryNode,
    // AGENT nodes
    InitiativeRefinementAgentEditorNode,
    InitiativeRefinementAgentNextLevelNode,
  ],
  exports: [
    // Export nodes for use in other modules
    InitiativeRefinementWelcomeNode,
    InitiativeRefinementPromptNextInputNode,
    InitiativeRefinementFinalizeNode,
    InitiativeRefinementEndNode,
    InitiativeRefinementRecoveryNode,
    // AGENT nodes
    InitiativeRefinementAgentEditorNode,
    InitiativeRefinementAgentNextLevelNode,
  ],
})
export class InitiativeRefinementNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly welcomeNode: InitiativeRefinementWelcomeNode,
    private readonly finalizeNode: InitiativeRefinementFinalizeNode,
    private readonly endNode: InitiativeRefinementEndNode,
    private readonly recoveryNode: InitiativeRefinementRecoveryNode,
    private readonly agentEditor: InitiativeRefinementAgentEditorNode,
    private readonly agentNextLevel: InitiativeRefinementAgentNextLevelNode,
    private readonly initiativeRefinementPromptNextInputNode: InitiativeRefinementPromptNextInputNode,
  ) {}

  /**
   * Register all nodes with the NodeRegistry on module initialization
   */
  onModuleInit() {
    // Register all converted nodes
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.finalizeNode);
    this.nodeRegistry.register(this.initiativeRefinementPromptNextInputNode);
    this.nodeRegistry.register(this.agentEditor as any);
    this.nodeRegistry.register(this.agentNextLevel as any);
    this.nodeRegistry.register(this.endNode);
    this.nodeRegistry.register(this.recoveryNode);
  }
}
