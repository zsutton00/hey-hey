import { Injectable } from '@nestjs/common';
import type { WorkItemExecutionState } from '@hey-hey/contracts/api/models';

export type WorkItemExecutionStateType =
  WorkItemExecutionState['state']['type'];

export interface WorkItemExecutionOwnerChange {
  workItem: { id: string; organizationId: string; projectId: string };
  storedOwnerMachineId: string;
  reportingMachineId: string;
}

/**
 * Decides whether a different machine may take over a work item's retained
 * execution state. The platform holds no owner record of its own, so each
 * participating type supplies the rule from its own authoritative source.
 */
export type WorkItemExecutionOwnerRule = (
  change: WorkItemExecutionOwnerChange,
) => Promise<boolean>;

interface Participant {
  /** Work-item type whose items may report this execution state. */
  workItemType: string;
  ownerRule?: WorkItemExecutionOwnerRule;
}

/** Participating execution-state types and their per-type ownership policy. */
@Injectable()
export class WorkItemExecutionStateRegistry {
  private readonly participants = new Map<
    WorkItemExecutionStateType,
    Participant
  >([['TASK_MONITOR', { workItemType: 'TASK_MONITOR' }]]);

  workItemTypeFor(stateType: WorkItemExecutionStateType): string {
    return this.participant(stateType).workItemType;
  }

  ownerRuleFor(
    stateType: WorkItemExecutionStateType,
  ): WorkItemExecutionOwnerRule | undefined {
    return this.participant(stateType).ownerRule;
  }

  registerOwnerRule(
    stateType: WorkItemExecutionStateType,
    ownerRule: WorkItemExecutionOwnerRule,
  ): void {
    this.participants.set(stateType, {
      ...this.participant(stateType),
      ownerRule,
    });
  }

  private participant(stateType: WorkItemExecutionStateType): Participant {
    const participant = this.participants.get(stateType);
    if (!participant) {
      throw new Error(`No participant registered for ${stateType}`);
    }

    return participant;
  }
}
