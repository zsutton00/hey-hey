import { Module, OnModuleInit } from '@nestjs/common';
import { PlanModule } from 'src/services/plan/plan.module';
import { NodeRegistry } from '../node-registry.service';
import { EntityConversationAgentNode } from './agent.node';
import { EntityConversationEndNode } from './end.node';
import { EntityConversationRecoveryNode } from './recovery.node';
import { EntityConversationWelcomeNode } from './welcome.node';

@Module({
  imports: [PlanModule],
  providers: [
    EntityConversationWelcomeNode,
    EntityConversationAgentNode,
    EntityConversationRecoveryNode,
    EntityConversationEndNode,
  ],
  exports: [
    EntityConversationWelcomeNode,
    EntityConversationAgentNode,
    EntityConversationRecoveryNode,
    EntityConversationEndNode,
  ],
})
export class EntityConversationNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly welcomeNode: EntityConversationWelcomeNode,
    private readonly agentNode: EntityConversationAgentNode,
    private readonly recoveryNode: EntityConversationRecoveryNode,
    private readonly endNode: EntityConversationEndNode,
  ) {}

  onModuleInit(): void {
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.agentNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
  }
}
