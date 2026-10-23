import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { ProjectConversationAgentNode } from './agent.node';
import { ProjectConversationEndNode } from './end.node';
import { ProjectConversationRecoveryNode } from './recovery.node';
import { ProjectConversationWelcomeNode } from './welcome.node';

@Module({
  providers: [
    ProjectConversationWelcomeNode,
    ProjectConversationAgentNode,
    ProjectConversationRecoveryNode,
    ProjectConversationEndNode,
  ],
  exports: [
    ProjectConversationWelcomeNode,
    ProjectConversationAgentNode,
    ProjectConversationRecoveryNode,
    ProjectConversationEndNode,
  ],
})
export class ProjectConversationNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly welcomeNode: ProjectConversationWelcomeNode,
    private readonly agentNode: ProjectConversationAgentNode,
    private readonly recoveryNode: ProjectConversationRecoveryNode,
    private readonly endNode: ProjectConversationEndNode,
  ) {}

  onModuleInit(): void {
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.agentNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
  }
}
