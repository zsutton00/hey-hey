import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { RfcClassifyMessageNode } from './classify_message.node';
import { RfcConversationNode } from './conversation.node';
import { RfcQuestionsNode } from './questions.node';
import { RfcGenerateNode } from './generate.node';
import { RfcEndNode } from './end.node';
import { RfcRecoveryNode } from './recovery.node';

/**
 * Module for RFC (Request for Comments) flow nodes
 *
 * Registers all RFC-related nodes with the NodeRegistry
 * during module initialization.
 */
@Module({
  providers: [
    RfcClassifyMessageNode,
    RfcConversationNode,
    RfcQuestionsNode,
    RfcGenerateNode,
    RfcEndNode,
    RfcRecoveryNode,
  ],
  exports: [
    RfcClassifyMessageNode,
    RfcConversationNode,
    RfcQuestionsNode,
    RfcGenerateNode,
    RfcEndNode,
    RfcRecoveryNode,
  ],
})
export class RfcNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private classifyNode: RfcClassifyMessageNode,
    private conversationNode: RfcConversationNode,
    private questionsNode: RfcQuestionsNode,
    private generateNode: RfcGenerateNode,
    private endNode: RfcEndNode,
    private recoveryNode: RfcRecoveryNode,
  ) {}

  onModuleInit() {
    // Register all RFC nodes with the registry
    this.nodeRegistry.register(this.classifyNode);
    this.nodeRegistry.register(this.conversationNode);
    this.nodeRegistry.register(this.questionsNode);
    this.nodeRegistry.register(this.generateNode);
    this.nodeRegistry.register(this.endNode);
    this.nodeRegistry.register(this.recoveryNode);
  }
}
