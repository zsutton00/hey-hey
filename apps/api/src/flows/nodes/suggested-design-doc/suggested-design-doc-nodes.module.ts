import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { CreateSuggestedDesignDocNode } from './create-suggested-design-doc.node';

@Module({
  providers: [CreateSuggestedDesignDocNode],
  exports: [CreateSuggestedDesignDocNode],
})
export class SuggestedDesignDocNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly createSuggestedDesignDocNode: CreateSuggestedDesignDocNode,
  ) {}

  onModuleInit() {
    this.nodeRegistry.register(this.createSuggestedDesignDocNode);
  }
}
