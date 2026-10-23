import { Module, OnModuleInit } from '@nestjs/common';
import { WorkItemModule } from '../../../services/work-item.module';
import { NodeRegistry } from '../node-registry.service';
import { TaskRefinementWelcomeNode } from './welcome.node';
import { TaskRefinementFinalizeNode } from './finalize_action.node';
import { TaskRefinementPromptNextInputNode } from './prompt_input.node';
import { TaskRefinementRecoveryNode } from './recovery.node';
import { TaskRefinementEndNode } from './end.node';
import { TaskRefinementAgentEditorNode } from './agent_editor.node';
import { TaskRefinementAgentNextLevelNode } from './agent_next_level.node';

/**
 * Module for task refinement flow nodes
 *
 * Registers all task-refinement-related nodes with the NodeRegistry
 * during module initialization.
 *
 * Imports:
 * - WorkItemModule: Provides TaskService and other work item services
 */
@Module({
  imports: [WorkItemModule],
  providers: [
    TaskRefinementWelcomeNode,
    TaskRefinementFinalizeNode,
    TaskRefinementPromptNextInputNode,
    TaskRefinementRecoveryNode,
    TaskRefinementEndNode,
    // AGENT nodes
    TaskRefinementAgentEditorNode,
    TaskRefinementAgentNextLevelNode,
  ],
  exports: [
    TaskRefinementWelcomeNode,
    TaskRefinementFinalizeNode,
    TaskRefinementPromptNextInputNode,
    TaskRefinementRecoveryNode,
    TaskRefinementEndNode,
    // AGENT nodes
    TaskRefinementAgentEditorNode,
    TaskRefinementAgentNextLevelNode,
  ],
})
export class TaskRefinementNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private welcomeNode: TaskRefinementWelcomeNode,
    private finalizeNode: TaskRefinementFinalizeNode,
    private promptNextInputNode: TaskRefinementPromptNextInputNode,
    private recoveryNode: TaskRefinementRecoveryNode,
    private endNode: TaskRefinementEndNode,
    private agentEditorNode: TaskRefinementAgentEditorNode,
    private agentNextLevelNode: TaskRefinementAgentNextLevelNode,
  ) {}

  onModuleInit() {
    // Register all task-refinement nodes with the registry
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.finalizeNode);
    this.nodeRegistry.register(this.promptNextInputNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
    // Register AGENT nodes
    this.nodeRegistry.register(this.agentEditorNode as any);
    this.nodeRegistry.register(this.agentNextLevelNode as any);
  }
}
