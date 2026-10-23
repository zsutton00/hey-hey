import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@temporalio/client';
import { v4 as uuidv4 } from 'uuid';
import { TEMPORAL_CLIENT } from 'src/prisma/temporal.module';
import {
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  WorkflowId,
} from 'src/types';
import { taskDependencyInferenceWorkflow } from 'src/workflows/task-dependency-inference.workflow';
import { TaskDependencyInferenceWorkflowInput } from 'src/workflows/task-dependency-inference.types';

type PendingInference = {
  organizationId: OrganizationId;
  initiativeId: InitiativeId;
  projectId: ProjectId;
  targetTaskIds: Set<TaskId>;
  timeoutId: NodeJS.Timeout;
  lastUpdate: Date;
};

@Injectable()
export class TaskDependencyInferenceService implements OnModuleDestroy {
  private readonly logger = new Logger(TaskDependencyInferenceService.name);
  private readonly pendingInferences = new Map<string, PendingInference>();
  private readonly DEBOUNCE_DELAY_MS = 2500;

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporalClient: Client,
  ) {}

  queueInference(params: {
    organizationId: OrganizationId;
    initiativeId: InitiativeId;
    projectId: ProjectId;
    taskId: TaskId;
  }): void {
    const key = this.buildKey(params.organizationId, params.initiativeId);
    const existing = this.pendingInferences.get(key);

    if (existing) {
      existing.targetTaskIds.add(params.taskId);
      existing.lastUpdate = new Date();
      clearTimeout(existing.timeoutId);
      existing.timeoutId = this.createTimeout(key);
      return;
    }

    const timeoutId = this.createTimeout(key);

    this.pendingInferences.set(key, {
      organizationId: params.organizationId,
      initiativeId: params.initiativeId,
      projectId: params.projectId,
      targetTaskIds: new Set([params.taskId]),
      timeoutId,
      lastUpdate: new Date(),
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const pending of this.pendingInferences.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingInferences.clear();
  }

  private createTimeout(key: string): NodeJS.Timeout {
    return setTimeout(
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      () => this.executeInference(key),
      this.DEBOUNCE_DELAY_MS,
    );
  }

  private buildKey(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
  ): string {
    return `${organizationId}|${initiativeId}`;
  }

  private async executeInference(key: string): Promise<void> {
    const pending = this.pendingInferences.get(key);
    if (!pending) {
      return;
    }

    this.pendingInferences.delete(key);

    const workflowId = uuidv4() as WorkflowId;

    const input: TaskDependencyInferenceWorkflowInput = {
      organizationId: pending.organizationId,
      projectId: pending.projectId,
      initiativeId: pending.initiativeId,
      targetTaskIds: Array.from(pending.targetTaskIds),
      trigger: 'batch',
    };

    await this.temporalClient.workflow.start(taskDependencyInferenceWorkflow, {
      taskQueue: 'conversation-queue',
      workflowId,
      args: [input],
    });

    this.logger.debug('Queued task dependency inference', {
      organizationId: pending.organizationId,
      initiativeId: pending.initiativeId,
      projectId: pending.projectId,
      targetTaskCount: pending.targetTaskIds.size,
      workflowId,
    });
  }
}
