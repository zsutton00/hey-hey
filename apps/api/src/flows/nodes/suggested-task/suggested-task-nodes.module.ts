import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { CreateSuggestedTaskNode } from './create-suggested-task.node';

@Module({
  providers: [CreateSuggestedTaskNode],
  exports: [CreateSuggestedTaskNode],
})
export class SuggestedTaskNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly createSuggestedTaskNode: CreateSuggestedTaskNode,
  ) {}

  onModuleInit() {
    this.nodeRegistry.register(this.createSuggestedTaskNode);
  }
}
