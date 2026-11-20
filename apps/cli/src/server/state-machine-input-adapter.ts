import type {
  MonitorCommandAcknowledgement,
  MonitorCommandBody1 as MonitorCommandBody,
} from '@hey-hey/contracts/agent-bridge';
import {
  interventionHold,
  type TaskMonitorMachineContext,
} from '../agents/task-monitor/state-machine/context';
import type {
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  TaskMonitorMachineEvent,
  VerifiedTaskMonitorInput,
  VerifiedTaskMonitorHumanDecisionInput,
} from '../agents/task-monitor/state-machine/events';
import type {
  TaskMonitorMachineLogic,
  TaskMonitorMachineState,
  TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';
import type {
  EffectDeclaration,
  EffectOutcome,
  MachineEvent,
  MachineLogic,
  MachineState,
  RuntimeEventResult,
  RuntimeRejectionCode,
} from '../state-machine';
import { AddressedMachineAdmission } from '../state-machine';
import { NOOP_LOGGER, type ServerLogger } from './logger';

export { AddressedMachineAdmission } from '../state-machine';

const rejectionReason = (
  code: RuntimeRejectionCode,
): Extract<MonitorCommandAcknowledgement, { status: 'REJECTED' }>['reason'] => {
  switch (code) {
    case 'identity_mismatch':
    case 'ingress_identity_mismatch':
      return 'ROUTING_MISMATCH';
    case 'unsupported_initial_event':
    case 'transition_rejected':
      return 'INVALID_LIFECYCLE';
    case 'unknown_machine_type':
    case 'input_rejected':
      return 'ROUTE_REJECTED';
  }
};

type TaskMonitorAddressedAdmission = AddressedMachineAdmission<
  string,
  TaskMonitorMachineState,
  TaskMonitorMachineEvent,
  TaskMonitorMachineContext,
  TaskMonitorMachineLogic,
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  VerifiedTaskMonitorInput
>;

export type TaskMonitorVerifiedAdmissionResult = RuntimeEventResult<
  string,
  TaskMonitorMachineState,
  TaskMonitorMachineContext,
  TaskMonitorMachineEffect
>;

export interface TaskMonitorPermissionDecisionInput {
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly providerActionId: string;
  readonly providerSessionId: string;
  readonly decision: 'approve' | 'always_approve' | 'deny' | 'whitelist';
  readonly decidedAt: string;
  readonly userId: string;
  readonly authenticatedAt: string;
  readonly ingressId: string;
}

/** Owns Task Monitor transport translation and acknowledgement mapping. */
export class TaskMonitorStateMachineInputAdapter {
  public constructor(
    private readonly admission: TaskMonitorAddressedAdmission,
    private readonly logger: ServerLogger = NOOP_LOGGER,
    private readonly stateStore?: TaskMonitorStateStore,
  ) {}

  public async admit(input: MonitorCommandBody): Promise<MonitorCommandAcknowledgement> {
    const identity = {
      machineType: input.target.workItemType,
      instanceId: input.target.workItemId,
    };
    this.logger.debug('task_monitor.state_machine_input.admission.started', {
      machineType: identity.machineType,
      instanceId: identity.instanceId,
      commandId: input.commandId,
    });

    const result = await this.admission.admit({
      identity,
      ingressId: input.commandId,
      verifiedInput: input,
    });
    if (result.status === 'accepted' || result.status === 'replayed') {
      this.logger.info('task_monitor.state_machine_input.admission.completed', {
        machineType: identity.machineType,
        instanceId: identity.instanceId,
        commandId: input.commandId,
        revision: result.snapshot.revision,
        replayed: result.status === 'replayed',
      });
      return {
        status: 'ADMITTED',
        commandId: result.ingressId,
        replayed: result.status === 'replayed',
      };
    }

    this.logger.warn('task_monitor.state_machine_input.admission.rejected', {
      machineType: identity.machineType,
      instanceId: identity.instanceId,
      commandId: input.commandId,
      code: result.code,
      reason: result.reason,
    });
    return {
      status: 'REJECTED',
      commandId: input.commandId,
      stage: 'ADMISSION',
      reason: rejectionReason(result.code),
      message: result.reason,
    };
  }

  public admitVerified(
    input: Exclude<VerifiedTaskMonitorInput, MonitorCommandBody>,
  ): Promise<TaskMonitorVerifiedAdmissionResult> {
    this.logger.debug('task_monitor.state_machine_input.verified_admission.started', {
      machineType: input.identity.machineType,
      instanceId: input.identity.instanceId,
      ingressId: input.ingressId,
      source: input.source,
    });
    return this.admission.admit({
      identity: input.identity,
      ingressId: input.ingressId,
      verifiedInput: input,
    });
  }

  public async resolveConversationBinding(taskMonitorId: string): Promise<{
    organizationId: string;
    projectId: string;
  } | null> {
    if (!this.stateStore) {
      throw new Error('Task Monitor conversation admission requires the durable state store.');
    }
    const instance = await this.stateStore.findByInstanceId(taskMonitorId);
    const context = instance?.snapshot.context;
    if (
      !instance ||
      instance.snapshot.identity.machineType !== 'TASK_MONITOR' ||
      context?.organizationId === null ||
      context?.projectId === null ||
      context === undefined
    ) {
      return null;
    }
    return {
      organizationId: context.organizationId,
      projectId: context.projectId,
    };
  }

  /**
   * Only a running monitor answers permission requests. A stopped, completed or missing monitor
   * cannot admit a decision, so its requests are answered on the provider path instead of being
   * rejected by a machine that no longer handles them.
   */
  public async isAdmittingPermissionDecisions(taskMonitorId: string): Promise<boolean> {
    if (!this.stateStore) {
      return false;
    }
    const instance = await this.stateStore.findByInstanceId(taskMonitorId);
    const running =
      instance !== null &&
      instance.snapshot.identity.machineType === 'TASK_MONITOR' &&
      typeof instance.snapshot.state !== 'string';
    this.logger.debug('task_monitor.permission_decision.monitor_availability', {
      taskMonitorId,
      running,
      state:
        instance === null
          ? 'absent'
          : typeof instance.snapshot.state === 'string'
            ? instance.snapshot.state
            : 'RUNNING',
    });

    return running;
  }

  public async admitPermissionDecision(
    input: TaskMonitorPermissionDecisionInput,
  ): Promise<TaskMonitorVerifiedAdmissionResult> {
    if (!this.stateStore) {
      throw new Error(
        'Task Monitor permission-decision admission requires the durable state store.',
      );
    }
    this.logger.debug('task_monitor.permission_decision.snapshot_lookup.started', {
      taskMonitorId: input.taskMonitorId,
      runId: input.runId,
      providerActionId: input.providerActionId,
      ingressId: input.ingressId,
    });
    const instance = await this.stateStore.findByInstanceId(input.taskMonitorId);
    const pending = instance?.snapshot.context.pendingIntervention ?? null;
    const logContext = {
      taskMonitorId: input.taskMonitorId,
      runId: input.runId,
      providerActionId: input.providerActionId,
      ingressId: input.ingressId,
    };
    if (
      !instance ||
      instance.snapshot.identity.machineType !== 'TASK_MONITOR' ||
      pending === null ||
      pending.runId !== input.runId ||
      pending.providerActionId !== input.providerActionId ||
      pending.providerSessionId !== input.providerSessionId
    ) {
      const cause = !instance
        ? 'machine_not_found'
        : pending === null
          ? 'no_pending_intervention'
          : 'pending_intervention_mismatch';
      this.logger.warn('task_monitor.permission_decision.rejected', {
        ...logContext,
        owner: null,
        cause,
      });
      return {
        status: 'rejected',
        code: 'input_rejected',
        reason:
          'This request is no longer waiting for an answer: it was already decided or is not held by this Task Monitor.',
      };
    }

    const hold = interventionHold(pending);
    if (hold !== 'HUMAN_HELD') {
      const cause = hold === 'SETTLED' ? 'already_settled' : 'held_by_monitor';
      this.logger.warn('task_monitor.permission_decision.rejected', {
        ...logContext,
        interventionId: pending.interventionId,
        owner: hold,
        cause,
      });
      return {
        status: 'rejected',
        code: 'input_rejected',
        reason:
          hold === 'SETTLED'
            ? 'This request was already decided, so this answer was not applied.'
            : 'The Task Monitor is still deciding this request; it can be answered once it is handed to a person.',
      };
    }

    this.logger.info('task_monitor.permission_decision.snapshot_lookup.completed', {
      taskMonitorId: input.taskMonitorId,
      runId: input.runId,
      providerActionId: input.providerActionId,
      interventionId: pending.interventionId,
      ingressId: input.ingressId,
    });
    const verifiedInput: VerifiedTaskMonitorHumanDecisionInput = {
      source: 'HUMAN_DECISION',
      identity: { machineType: 'TASK_MONITOR', instanceId: input.taskMonitorId },
      ingressId: input.ingressId,
      taskMonitorId: input.taskMonitorId,
      interventionId: pending.interventionId,
      providerActionId: pending.providerActionId,
      runId: pending.runId,
      agentSessionId: pending.agentSessionId,
      fingerprint: pending.fingerprint,
      resolution: input.decision === 'deny' ? 'DENY' : 'APPROVE',
      providerDecision: input.decision,
      decidedAt: input.decidedAt,
      human: {
        userId: input.userId,
        authenticatedAt: input.authenticatedAt,
      },
    };
    return this.admitVerified(verifiedInput);
  }
}
