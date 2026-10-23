import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { DailySessionAgentNode } from './agent.node';
import { DailySessionEndNode } from './end.node';
import { DailySessionRecoveryNode } from './recovery.node';
import { DailySessionWelcomeNode } from './welcome.node';

@Module({
  providers: [
    DailySessionWelcomeNode,
    DailySessionAgentNode,
    DailySessionRecoveryNode,
    DailySessionEndNode,
  ],
  exports: [
    DailySessionWelcomeNode,
    DailySessionAgentNode,
    DailySessionRecoveryNode,
    DailySessionEndNode,
  ],
})
export class DailySessionNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly welcomeNode: DailySessionWelcomeNode,
    private readonly agentNode: DailySessionAgentNode,
    private readonly recoveryNode: DailySessionRecoveryNode,
    private readonly endNode: DailySessionEndNode,
  ) {}

  onModuleInit(): void {
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.agentNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.endNode);
  }
}
