import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WorkItemExecutionState } from '@hey-hey/contracts/api/models';

export type WorkItemExecutionStateType =
  WorkItemExecutionState['state']['type'];

export interface WorkItemExecutionPublication {
  workItem: { id: string; organizationId: string; projectId: string };
  reportingMachineId: string;
  /** Owner of the retained record, or null before the first accepted report. */
  storedOwnerMachineId: string | null;
}

export type WorkItemExecutionPublicationRefusal =
  | 'OWNER_UNAVAILABLE'
  | 'OWNER_CONFLICT'
  | 'OWNER_MISMATCH';

export type WorkItemExecutionPublicationDecision =
  | { authorized: true }
  | { authorized: false; code: WorkItemExecutionPublicationRefusal };

/**
 * Decides whether the reporting machine may publish this work item's
 * execution state: the first report, every later one, and a change of owner.
 * The platform holds no owner record of its own, so each participating type
 * answers from its own authoritative source. It runs inside the transaction
 * that serializes the item's retention write, and reads through that client.
 */
export type WorkItemExecutionPublicationPolicy = (
  publication: WorkItemExecutionPublication,
  tx: Prisma.TransactionClient,
) => Promise<WorkItemExecutionPublicationDecision>;

interface Participant {
  /** Work-item type whose items may report this execution state. */
  workItemType: string;
  publicationPolicy?: WorkItemExecutionPublicationPolicy;
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

  /**
   * A type without a registered policy has no publication authority, so its
   * reports are refused as OWNER_UNAVAILABLE rather than accepted from
   * whichever machine reports first.
   */
  publicationPolicyFor(
    stateType: WorkItemExecutionStateType,
  ): WorkItemExecutionPublicationPolicy | undefined {
    return this.participant(stateType).publicationPolicy;
  }

  registerPublicationPolicy(
    stateType: WorkItemExecutionStateType,
    publicationPolicy: WorkItemExecutionPublicationPolicy,
  ): void {
    this.participants.set(stateType, {
      ...this.participant(stateType),
      publicationPolicy,
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
