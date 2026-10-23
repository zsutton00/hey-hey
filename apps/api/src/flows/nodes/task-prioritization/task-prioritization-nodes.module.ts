import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { TaskPrioritizationWelcomeNode } from './welcome.node';
import { TaskPrioritizationGenerateNode } from './generate.node';
import { TaskPrioritizationEndNode } from './end.node';

@Module({
  providers: [
    TaskPrioritizationWelcomeNode,
    TaskPrioritizationGenerateNode,
    TaskPrioritizationEndNode,
  ],
  exports: [
    TaskPrioritizationWelcomeNode,
    TaskPrioritizationGenerateNode,
    TaskPrioritizationEndNode,
  ],
})
export class TaskPrioritizationNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly welcomeNode: TaskPrioritizationWelcomeNode,
    private readonly generateNode: TaskPrioritizationGenerateNode,
    private readonly endNode: TaskPrioritizationEndNode,
  ) {}

  onModuleInit() {
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.generateNode);
    this.nodeRegistry.register(this.endNode);
  }
}
