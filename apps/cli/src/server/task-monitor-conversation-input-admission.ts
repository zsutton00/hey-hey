import type { LocalAgentService } from './local-agent-service';
import type { ServerLogger } from './logger';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';
import type { RunStore } from '../run-store';

export interface TaskMonitorConversationAdmissionInput {
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly messageId: string;
}

/** Verifies canonical Task Monitor ownership before ordinary conversation input reaches the machine. */
export class TaskMonitorConversationInputAdmission {
  public constructor(
    private readonly inputAdapter: TaskMonitorStateMachineInputAdapter,
    private readonly agentService: LocalAgentService,
    private readonly runStore: RunStore,
    private readonly logger: ServerLogger,
  ) {}

  public async admit(
    input: TaskMonitorConversationAdmissionInput,
  ): Promise<'accepted' | 'replayed' | 'rejected'> {
    this.logger.debug('task_monitor.conversation_input.admission.started', { ...input });
    const binding = await this.inputAdapter.resolveConversationBinding(input.taskMonitorId);
    if (
      !binding ||
      binding.organizationId !== input.organizationId ||
      binding.projectId !== input.projectId
    ) {
      this.logger.warn('task_monitor.conversation_input.admission.rejected', {
        ...input,
        reason: 'canonical_binding_mismatch',
      });
      return 'rejected';
    }
    const runId = this.runStore.lookupByConversationId(input.conversationId);
    const run = runId ? await this.runStore.getRun(runId) : null;
    if (run?.contextMetadata.taskMonitorId !== input.taskMonitorId) {
      this.logger.warn('task_monitor.conversation_input.admission.rejected', {
        ...input,
        runId,
        reason: 'canonical_coordinator_run_mismatch',
      });
      return 'rejected';
    }
    const message = await this.agentService.readUserMessage({
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
    if (!message) {
      this.logger.warn('task_monitor.conversation_input.admission.rejected', {
        ...input,
        reason: 'canonical_user_message_invalid',
      });
      return 'rejected';
    }
    const result = await this.inputAdapter.admitVerified({
      source: 'CONVERSATION_MESSAGE',
      identity: { machineType: 'TASK_MONITOR', instanceId: input.taskMonitorId },
      ingressId: `conversation-message:${input.messageId}`,
      taskMonitorId: input.taskMonitorId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
    const admitted = result.status === 'accepted' || result.status === 'replayed';
    this.logger.info('task_monitor.conversation_input.admission.completed', {
      ...input,
      admitted,
      replayed: result.status === 'replayed',
    });
    return admitted ? result.status : 'rejected';
  }
}
