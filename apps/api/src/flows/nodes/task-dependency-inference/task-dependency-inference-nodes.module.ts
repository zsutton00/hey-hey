import { Module, OnModuleInit } from '@nestjs/common';
import { NodeRegistry } from '../node-registry.service';
import { TaskDependencyInferenceNode } from './task-dependency-inference.node';

@Module({
  providers: [TaskDependencyInferenceNode],
  exports: [TaskDependencyInferenceNode],
})
export class TaskDependencyInferenceNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly taskDependencyInferenceNode: TaskDependencyInferenceNode,
  ) {}

  onModuleInit() {
    this.nodeRegistry.register(this.taskDependencyInferenceNode);
  }
}
