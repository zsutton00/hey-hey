import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { CodingPromptResearchAgentNode } from './agent.node';
import { CodingPromptResearchEndNode } from './end.node';

@Module({
  providers: [CodingPromptResearchAgentNode, CodingPromptResearchEndNode],
  exports: [CodingPromptResearchAgentNode, CodingPromptResearchEndNode],
})
export class CodingPromptResearchNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly agentNode: CodingPromptResearchAgentNode,
    private readonly endNode: CodingPromptResearchEndNode,
  ) {}

  onModuleInit(): void {
    this.nodeRegistry.register(this.agentNode);
    this.nodeRegistry.register(this.endNode);
  }
}
