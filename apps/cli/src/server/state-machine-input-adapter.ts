import { setTimeout as delay } from 'node:timers/promises';
import type {
  MonitorCommandAcknowledgement,
  MonitorCommandBody1 as MonitorCommandBody,
} from '@hey-hey/contracts/agent-bridge';
import {
  findMonitoredRequest,
  type TaskMonitorInterventionDecision,
  type TaskMonitorMachineContext,
} from '../agents/task-monitor/state-machine/context';
import type { ApplyTaskMonitorDecisionEffect } from '../agents/task-monitor/state-machine/effects';
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
import type { CommittedEffect } from '../state-machine/types';
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

/** What happened to one person's answer, in the terms the person is told. */
export type PermissionAnswerDisposition =
  | { readonly result: 'APPLIED' }
  | {
      readonly result: 'ALREADY_DECIDED';
      readonly decidedBy: 'PERSON' | 'TASK_MONITOR';
      readonly decidedByUserId: string | null;
      readonly decidedAt: string;
    }
  | {
      readonly result: 'REFUSED' | 'UNKNOWN_REQUEST' | 'NOT_DELIVERED' | 'DELIVERY_UNCERTAIN';
      readonly reason: string;
    };

export type TaskMonitorPermissionAdmissionResult = TaskMonitorVerifiedAdmissionResult & {
  readonly disposition: PermissionAnswerDisposition;
};

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

type PermissionRequestIdentity = Pick<
  TaskMonitorPermissionDecisionInput,
  'runId' | 'providerActionId' | 'providerSessionId'
>;

type PermissionApplication = CommittedEffect<
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome
> & { readonly effect: ApplyTaskMonitorDecisionEffect };

// The committed effect outlives the pending prompt and records its original decider.
const findPermissionApplication = (
  instance: Awaited<ReturnType<TaskMonitorStateStore['findByInstanceId']>>,
  request: PermissionRequestIdentity,
): PermissionApplication | undefined =>
  instance?.effects.find(
    (record): record is PermissionApplication =>
      record.effect.type === 'APPLY_TASK_MONITOR_DECISION' &&
      record.effect.requestKind !== 'SERVICE_SCOPE' &&
      record.effect.runId === request.runId &&
      record.effect.providerSessionId === request.providerSessionId &&
      record.effect.providerActionId === request.providerActionId,
  );

const deliveryUncertain = {
  result: 'DELIVERY_UNCERTAIN',
  reason: 'We could not confirm whether the coding agent received your answer.',
} as const;

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
   * The machine's recorded request, not whether the monitor is running, decides who may answer. A
   * stopped monitor keeps the requests it handed to a person, so those are still answered here;
   * a request the machine has no record of belongs to the provider path.
   */
  public async holdsPermissionRequest(
    taskMonitorId: string,
    request: PermissionRequestIdentity,
  ): Promise<boolean> {
    if (!this.stateStore) {
      throw new Error('Task Monitor permission-decision routing requires the durable state store.');
    }
    const instance = await this.stateStore.findByInstanceId(taskMonitorId);
    return (
      instance?.snapshot.identity.machineType === 'TASK_MONITOR' &&
      (findPermissionApplication(instance, request) !== undefined ||
        findMonitoredRequest(instance.snapshot.context, request.runId, request.providerActionId) !==
          null)
    );
  }

  public async admitPermissionDecision(
    input: TaskMonitorPermissionDecisionInput,
  ): Promise<TaskMonitorPermissionAdmissionResult> {
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
    const found =
      instance === null
        ? null
        : findMonitoredRequest(instance.snapshot.context, input.runId, input.providerActionId);
    const logContext = {
      taskMonitorId: input.taskMonitorId,
      runId: input.runId,
      providerActionId: input.providerActionId,
      ingressId: input.ingressId,
    };
    const existing = findPermissionApplication(instance, input);
    if (existing) {
      return alreadyDecided(existing.effect);
    }

    if (
      !instance ||
      instance.snapshot.identity.machineType !== 'TASK_MONITOR' ||
      found === null ||
      found.request.providerSessionId !== input.providerSessionId
    ) {
      const cause = !instance
        ? 'machine_not_found'
        : found === null
          ? 'no_pending_intervention'
          : 'pending_intervention_mismatch';
      this.logger.warn('task_monitor.permission_decision.rejected', {
        ...logContext,
        owner: null,
        cause,
      });
      const reason =
        'This request is no longer waiting for an answer: it was already decided or is not held by this Task Monitor.';

      return {
        status: 'rejected',
        code: 'input_rejected',
        reason,
        disposition: { result: 'UNKNOWN_REQUEST', reason },
      };
    }

    const { request: pending, hold } = found;
    if (hold !== 'HUMAN_HELD') {
      const cause =
        hold === 'SETTLED'
          ? 'already_settled'
          : hold === 'QUEUED'
            ? 'queued_behind_another_request'
            : 'held_by_monitor';
      this.logger.warn('task_monitor.permission_decision.rejected', {
        ...logContext,
        interventionId: pending.interventionId,
        owner: hold,
        cause,
      });
      const reason =
        hold === 'SETTLED'
          ? 'This request was already decided, so this answer was not applied.'
          : hold === 'QUEUED'
            ? 'This request is waiting behind another one that needs an answer first.'
            : 'The Task Monitor is still deciding this request; it can be answered once it is handed to a person.';

      if (hold === 'SETTLED' && 'decision' in pending && pending.decision !== null) {
        return alreadyDecided(pending.decision);
      }
      return {
        status: 'rejected',
        code: 'input_rejected',
        reason,
        disposition: { result: 'REFUSED', reason },
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
    const admission = await this.admitVerified(verifiedInput);
    const latest = await this.stateStore.findByInstanceId(input.taskMonitorId);
    const application = findPermissionApplication(latest, input);

    if (admission.status !== 'accepted') {
      if (application) {
        return alreadyDecided(application.effect);
      }
      const reason =
        admission.status === 'rejected'
          ? admission.reason
          : 'This answer has already been submitted.';
      return {
        status: 'rejected',
        code: 'input_rejected',
        reason,
        disposition: { result: 'REFUSED', reason },
      };
    }

    if (!application) {
      return { ...admission, disposition: deliveryUncertain };
    }
    return {
      ...admission,
      disposition: await this.awaitPermissionApplication(this.stateStore, input, application),
    };
  }

  private async awaitPermissionApplication(
    store: TaskMonitorStateStore,
    input: TaskMonitorPermissionDecisionInput,
    application: PermissionApplication,
  ): Promise<PermissionAnswerDisposition> {
    const deadline = performance.now() + 10_000;
    while (application.status !== 'settled' && performance.now() < deadline) {
      await delay(250);
      const latest = await store.findByInstanceId(input.taskMonitorId);
      application = findPermissionApplication(latest, input) ?? application;
    }

    if (application.status !== 'settled' || application.settlement.status === 'uncertain') {
      this.logger.warn('task_monitor.permission_decision.delivery_unconfirmed', {
        taskMonitorId: input.taskMonitorId,
        runId: input.runId,
        providerActionId: input.providerActionId,
        effectId: application.effectId,
        cause:
          application.status === 'settled' ? 'uncertain_provider_delivery' : 'delivery_pending',
      });
      return deliveryUncertain;
    }
    if (application.settlement.outcome.type === 'DECISION_APPLIED') {
      return { result: 'APPLIED' };
    }
    return {
      result: 'NOT_DELIVERED',
      reason: 'Your answer could not be delivered to the coding agent.',
    };
  }
}

const alreadyDecided = (
  decision: Pick<TaskMonitorInterventionDecision, 'human' | 'decidedAt'>,
): TaskMonitorPermissionAdmissionResult => ({
  status: 'rejected',
  code: 'input_rejected',
  reason: 'This request was already decided, so this answer was not applied.',
  disposition: {
    result: 'ALREADY_DECIDED',
    decidedBy: decision.human === null ? 'TASK_MONITOR' : 'PERSON',
    decidedByUserId: decision.human?.userId ?? null,
    decidedAt: decision.decidedAt,
  },
});
