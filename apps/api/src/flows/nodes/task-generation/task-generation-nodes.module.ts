import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { TaskGenerationWelcomeNode } from './welcome.node';
import { TaskGenerationConversationNode } from './conversation.node';
import { TaskGenerationGenerateStubsNode } from './generate-stubs.node';
import { TaskGenerationGenerateNode } from './generate.node';
import { TaskGenerationRecoveryNode } from './recovery.node';
import { TaskGenerationEndNode } from './end.node';

/**
 * Module for Task Generation flow nodes
 *
 * Registers all task generation-related nodes with the NodeRegistry
 * during module initialization.
 */
@Module({
  providers: [
    TaskGenerationWelcomeNode,
    TaskGenerationConversationNode,
    TaskGenerationGenerateStubsNode,
    TaskGenerationGenerateNode,
    TaskGenerationRecoveryNode,
    TaskGenerationEndNode,
  ],
  exports: [
    TaskGenerationWelcomeNode,
    TaskGenerationConversationNode,
    TaskGenerationGenerateStubsNode,
    TaskGenerationGenerateNode,
    TaskGenerationRecoveryNode,
    TaskGenerationEndNode,
  ],
})
export class TaskGenerationNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private welcomeNode: TaskGenerationWelcomeNode,
    private conversationNode: TaskGenerationConversationNode,
    private generateStubsNode: TaskGenerationGenerateStubsNode,
    private generateNode: TaskGenerationGenerateNode,
    private recoveryNode: TaskGenerationRecoveryNode,
    private endNode: TaskGenerationEndNode,
  ) {}

  onModuleInit() {
    // Register all task generation nodes with the registry
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.conversationNode);
    this.nodeRegistry.register(this.generateStubsNode);
    this.nodeRegistry.register(this.generateNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
  }
}
