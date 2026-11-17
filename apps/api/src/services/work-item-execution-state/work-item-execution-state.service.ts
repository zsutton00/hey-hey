import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  WorkItemExecutionState,
  WorkItemExecutionStateBatchItemDto,
  WorkItemExecutionStateObservation,
  WorkItemExecutionStateObservationReceipt,
} from '@hey-hey/contracts/api/models';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { MachinePresenceService } from 'src/core/websockets/machine-presence.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MachineId, OrganizationId, ProjectId, UserId } from 'src/types';
import { parseWorkItemExecutionStateObservation } from './work-item-execution-state.boundary';
import {
  WorkItemExecutionStateDelivery,
  WorkItemExecutionStateDeliverySink,
} from './work-item-execution-state.delivery';
import {
  StoredExecutionState,
  toWorkItemExecutionState,
} from './work-item-execution-state.record';
import { WorkItemExecutionStateRegistry } from './work-item-execution-state.registry';

export type { WorkItemExecutionStateChange } from './work-item-execution-state.delivery';

export type WorkItemExecutionStateRejection = NonNullable<
  WorkItemExecutionStateObservationReceipt['code']
>;

type ReportedWorkItem = {
  id: string;
  organizationId: string;
  projectId: string;
};

const STORED_COLUMNS = Prisma.sql`
  work_item_id AS "workItemId",
  organization_id AS "organizationId",
  project_id AS "projectId",
  payload,
  owner_machine_id AS "ownerMachineId",
  source_revision AS "sourceRevision",
  revision,
  owner_connected AS "ownerConnected",
  freshness_changed_at AS "freshnessChangedAt",
  accepted_at AS "acceptedAt"
`;

/** Columns are TIMESTAMP(3) holding UTC, matching Prisma-managed tables. */
const UTC_NOW = Prisma.sql`timezone('utc', now())`;

/**
 * Retains the latest owner-reported execution state of each participating
 * work item: one PostgreSQL row per item, replaced in place.
 *
 * Ordering. `sourceRevision` belongs to the owner and orders that owner's
 * reports only: higher replaces, equal is a duplicate, lower is stale. A
 * different machine never competes on revision; it replaces the row only when
 * the type's owner rule confirms the takeover, and then starts its own
 * sequence. `revision` is assigned here, increases on every accepted change
 * (state, owner or freshness), and is what consumers order deliveries by.
 *
 * Ownership. Every report, the first included, must be authorized by the
 * type's publication policy from the type's own authoritative evidence. The
 * policy runs inside one transaction per item, under an item-scoped advisory
 * lock, together with the retention write and its outbox notification, so an
 * owner decision and the write it permits cannot interleave with another
 * instance's.
 *
 * Freshness. `ownerConnected` is stored beside the payload and never folded
 * into it. Connection changes touch freshness and `revision` only, so a
 * disconnect can neither clear a retained failure nor assert a healthy state.
 * Freshness changes only on events this server observes: authentication,
 * last local socket close, credential revocation and an owner's replay. Reads
 * additionally qualify a stored CURRENT state as LAST_KNOWN when owner
 * presence is missing or cannot be checked, without writing. No timer, lease
 * or scan runs; an owner server that crashes unobserved while the owner never
 * reconnects leaves the last report in place until the owner returns.
 */
@Injectable()
export class WorkItemExecutionStateService {
  private readonly logger = new Logger(WorkItemExecutionStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly machinePresence: MachinePresenceService,
    private readonly registry: WorkItemExecutionStateRegistry,
    private readonly delivery: WorkItemExecutionStateDelivery,
  ) {}

  /** Every accepted change, from any instance, reaches this instance's sink. */
  startDelivery(sink: WorkItemExecutionStateDeliverySink): Promise<void> {
    return this.delivery.start(sink);
  }

  /**
   * Accept or reject one report from an authenticated CLI connection, and
   * answer with a receipt that certifies only what was retained. Project and
   * organization scope come from the work item, never the frame. Throws when
   * storage fails, which the caller reports as RECEIVE_FAILED.
   */
  async observe(
    reporter: { userId: UserId; machineId: MachineId },
    frame: unknown,
  ): Promise<WorkItemExecutionStateObservationReceipt> {
    const parsed = parseWorkItemExecutionStateObservation(frame);
    if (!parsed.valid) {
      this.logger.warn('[execution-state] observation rejected', {
        code: 'MALFORMED' satisfies WorkItemExecutionStateRejection,
        machineId: reporter.machineId,
        failures: parsed.failures,
      });
      return {
        ...reportedIdentity(frame),
        outcome: 'REJECTED',
        code: 'MALFORMED',
      };
    }

    const observation = parsed.value;
    const reporterCheck = await this.authorizeReporter(reporter, observation);
    if (reporterCheck.code) {
      return this.reject(reporterCheck.code, observation);
    }

    return this.prisma.$transaction((tx) =>
      this.retain(tx, observation, reporterCheck.workItem),
    );
  }

  /** The serialized part: owner decision, write and notification together. */
  private async retain(
    tx: Prisma.TransactionClient,
    observation: WorkItemExecutionStateObservation,
    workItem: ReportedWorkItem,
  ): Promise<WorkItemExecutionStateObservationReceipt> {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`work-item-execution-state:${workItem.id}`}, 0))`,
    );
    const stored = await this.findStored(tx, observation.workItemId);
    const decision = await this.decidePublication(
      tx,
      observation,
      workItem,
      stored,
    );
    if (!decision.authorized) {
      return this.reject(decision.code, observation, stored);
    }

    const takeoverFrom =
      stored && stored.ownerMachineId !== observation.machineId
        ? stored.ownerMachineId
        : null;
    const written = await this.writeAccepted(
      tx,
      observation,
      workItem,
      takeoverFrom,
    );
    if (!written) {
      return this.classifyUnwritten(tx, observation);
    }

    await this.delivery.notifyInTransaction(tx, written);
    this.logger.log('[execution-state] observation accepted', {
      workItemId: observation.workItemId,
      machineId: observation.machineId,
      sourceRevision: observation.sourceRevision,
      revision: Number(written.revision),
      ownerChanged: takeoverFrom !== null,
    });

    return {
      workItemId: observation.workItemId,
      sourceRevision: observation.sourceRevision,
      outcome: 'ACCEPTED',
      revision: Number(written.revision),
    };
  }

  private async decidePublication(
    tx: Prisma.TransactionClient,
    observation: WorkItemExecutionStateObservation,
    workItem: ReportedWorkItem,
    stored: StoredExecutionState | null,
  ) {
    const policy = this.registry.publicationPolicyFor(observation.state.type);
    if (!policy) {
      return { authorized: false as const, code: 'OWNER_UNAVAILABLE' as const };
    }

    return policy(
      {
        workItem,
        reportingMachineId: observation.machineId,
        storedOwnerMachineId: stored?.ownerMachineId ?? null,
      },
      tx,
    );
  }

  /**
   * The machine's last authenticated connection ended or its credential was
   * revoked: its retained states become last-known. Payloads are untouched.
   */
  async markMachineDisconnected(machineId: MachineId): Promise<number> {
    return this.setMachineConnected(machineId, false);
  }

  /** The machine authenticated: its retained states are current again. */
  async markMachineConnected(machineId: MachineId): Promise<number> {
    return this.setMachineConnected(machineId, true);
  }

  /**
   * Latest retained state or an explicit missing result for each requested
   * identity, in request order. An identity that is not a visible work item
   * of this project is MISSING, so another project's state is never disclosed.
   */
  async readForProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
    workItemIds: readonly string[],
  ): Promise<WorkItemExecutionStateBatchItemDto[]> {
    const visible = await this.prisma.db.task.findMany({
      where: {
        id: { in: [...workItemIds] },
        organizationId,
        projectId,
        archivedAt: null,
      },
      select: { id: true },
    });
    const stored = await this.prisma.db.workItemExecutionState.findMany({
      where: {
        workItemId: { in: visible.map(({ id }) => id) },
        organizationId,
        projectId,
      },
    });
    const present = await this.presentMachines(
      stored
        .filter((row) => row.ownerConnected)
        .map((row) => row.ownerMachineId),
    );
    const retained = new Map<string, WorkItemExecutionState>();

    for (const row of stored) {
      // Read-only qualification: the recorded connection-change time stands.
      const ownerSilent =
        row.ownerConnected && !present.has(row.ownerMachineId);
      const executionState = toWorkItemExecutionState(
        ownerSilent ? { ...row, ownerConnected: false } : row,
        this.logger,
      );
      if (executionState) {
        retained.set(row.workItemId, executionState);
      }
    }

    return workItemIds.map((workItemId) => {
      const executionState = retained.get(workItemId);

      return executionState
        ? { result: 'RETAINED' as const, workItemId, executionState }
        : { result: 'MISSING' as const, workItemId };
    });
  }

  /** Checks that need no serialization: who reports, about what, where. */
  private async authorizeReporter(
    reporter: { userId: UserId; machineId: MachineId },
    observation: WorkItemExecutionStateObservation,
  ): Promise<
    | { code: WorkItemExecutionStateRejection }
    | { code?: undefined; workItem: ReportedWorkItem }
  > {
    if (observation.machineId !== reporter.machineId) {
      return { code: 'MACHINE_MISMATCH' };
    }

    const machine = await this.prisma.db.machine.findUnique({
      where: { id: reporter.machineId },
      select: { revokedAt: true },
    });
    if (!machine || machine.revokedAt) {
      return { code: 'MACHINE_REVOKED' };
    }

    const workItem = await this.prisma.db.task.findFirst({
      where: { id: observation.workItemId, archivedAt: null },
      select: { id: true, type: true, organizationId: true, projectId: true },
    });
    if (!workItem) {
      return { code: 'ITEM_NOT_FOUND' };
    }

    if (
      workItem.type !== this.registry.workItemTypeFor(observation.state.type)
    ) {
      return { code: 'TYPE_NOT_PARTICIPATING' };
    }

    const accessibleProject = await this.prisma.db.project.findFirst({
      where: {
        ...this.projectAccess.projectWhere(reporter.userId),
        id: workItem.projectId,
      },
      select: { id: true },
    });
    if (!accessibleProject) {
      return { code: 'PROJECT_FORBIDDEN' };
    }

    return {
      workItem: {
        id: workItem.id,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
      },
    };
  }

  /**
   * One statement decides the write, so concurrent API instances cannot both
   * win or regress the row. Returns nothing when the report is not newer.
   */
  private async writeAccepted(
    tx: Prisma.TransactionClient,
    observation: WorkItemExecutionStateObservation,
    workItem: ReportedWorkItem,
    confirmedTakeoverFrom: string | null,
  ): Promise<StoredExecutionState | undefined> {
    const rows = await tx.$queryRaw<StoredExecutionState[]>(
      Prisma.sql`
        INSERT INTO work_item_execution_states AS retained (
          work_item_id, organization_id, project_id, state_type, payload,
          owner_machine_id, source_revision, revision, owner_connected,
          freshness_changed_at, accepted_at, updated_at
        )
        VALUES (
          ${observation.workItemId}, ${workItem.organizationId},
          ${workItem.projectId}, ${observation.state.type},
          ${JSON.stringify(observation.state)}::jsonb,
          ${observation.machineId}, ${observation.sourceRevision}::bigint, 1,
          TRUE, ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW}
        )
        ON CONFLICT (work_item_id) DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          project_id = EXCLUDED.project_id,
          state_type = EXCLUDED.state_type,
          payload = EXCLUDED.payload,
          owner_machine_id = EXCLUDED.owner_machine_id,
          source_revision = EXCLUDED.source_revision,
          revision = retained.revision + 1,
          owner_connected = TRUE,
          freshness_changed_at = CASE
            WHEN retained.owner_connected
              AND retained.owner_machine_id = EXCLUDED.owner_machine_id
            THEN retained.freshness_changed_at
            ELSE EXCLUDED.freshness_changed_at
          END,
          accepted_at = EXCLUDED.accepted_at,
          updated_at = EXCLUDED.updated_at
        WHERE (
            retained.owner_machine_id = EXCLUDED.owner_machine_id
            AND retained.source_revision < EXCLUDED.source_revision
          )
          OR retained.owner_machine_id = ${confirmedTakeoverFrom}::text
        RETURNING ${STORED_COLUMNS}
      `,
    );

    return rows[0];
  }

  /** Nothing was written: say why from the row that won. */
  private async classifyUnwritten(
    tx: Prisma.TransactionClient,
    observation: WorkItemExecutionStateObservation,
  ): Promise<WorkItemExecutionStateObservationReceipt> {
    const stored = await this.findStored(tx, observation.workItemId);
    if (!stored) {
      // The work item, and its row with it, was deleted while we wrote.
      return this.reject('ITEM_NOT_FOUND', observation);
    }
    if (stored.ownerMachineId !== observation.machineId) {
      return this.reject('OWNER_MISMATCH', observation, stored);
    }
    if (Number(stored.sourceRevision) > observation.sourceRevision) {
      return this.reject('STALE', observation, stored);
    }

    // The owner replayed its latest committed state, as it does on reconnect.
    // The payload stands; the replay only proves the owner is connected.
    const restored = await tx.$queryRaw<StoredExecutionState[]>(
      Prisma.sql`
        UPDATE work_item_execution_states
        SET owner_connected = TRUE,
            freshness_changed_at = ${UTC_NOW},
            revision = revision + 1,
            updated_at = ${UTC_NOW}
        WHERE work_item_id = ${observation.workItemId}
          AND owner_machine_id = ${observation.machineId}
          AND source_revision = ${observation.sourceRevision}::bigint
          AND NOT owner_connected
        RETURNING ${STORED_COLUMNS}
      `,
    );
    for (const row of restored) {
      await this.delivery.notifyInTransaction(tx, row);
    }
    this.logger.verbose('[execution-state] duplicate observation', {
      workItemId: observation.workItemId,
      machineId: observation.machineId,
      sourceRevision: observation.sourceRevision,
      freshnessRestored: restored.length > 0,
    });

    return {
      workItemId: observation.workItemId,
      sourceRevision: observation.sourceRevision,
      outcome: 'DUPLICATE',
    };
  }

  private async setMachineConnected(
    machineId: MachineId,
    connected: boolean,
  ): Promise<number> {
    const changed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<StoredExecutionState[]>(
        Prisma.sql`
          UPDATE work_item_execution_states
          SET owner_connected = ${connected},
              freshness_changed_at = ${UTC_NOW},
              revision = revision + 1,
              updated_at = ${UTC_NOW}
          WHERE owner_machine_id = ${machineId}
            AND owner_connected <> ${connected}
          RETURNING ${STORED_COLUMNS}
        `,
      );
      for (const row of rows) {
        await this.delivery.notifyInTransaction(tx, row);
      }

      return rows;
    });
    if (changed.length > 0) {
      this.logger.log('[execution-state] owner freshness changed', {
        machineId,
        connected,
        workItems: changed.length,
      });
    }

    return changed.length;
  }

  private async findStored(
    tx: Prisma.TransactionClient,
    workItemId: string,
  ): Promise<StoredExecutionState | null> {
    return tx.workItemExecutionState.findUnique({ where: { workItemId } });
  }

  /** One batched lookup; an owner whose presence is unknown is not present. */
  private async presentMachines(
    machineIds: readonly string[],
  ): Promise<Set<string>> {
    try {
      const { present, failed } = await this.machinePresence.arePresent(
        machineIds as readonly MachineId[],
      );
      failed.forEach((error, machineId) =>
        this.logger.warn('[execution-state] presence check failed on read', {
          machineId,
          error,
        }),
      );

      return present;
    } catch (error) {
      this.logger.warn('[execution-state] presence batch failed on read', {
        owners: new Set(machineIds).size,
        error: error instanceof Error ? error.message : String(error),
      });

      return new Set();
    }
  }

  private reject(
    code: WorkItemExecutionStateRejection,
    observation: WorkItemExecutionStateObservation,
    stored?: StoredExecutionState | null,
  ): WorkItemExecutionStateObservationReceipt {
    this.logger.warn('[execution-state] observation rejected', {
      code,
      workItemId: observation.workItemId,
      machineId: observation.machineId,
      stateType: observation.state.type,
      sourceRevision: observation.sourceRevision,
      ...(stored
        ? {
            storedOwnerMachineId: stored.ownerMachineId,
            storedSourceRevision: Number(stored.sourceRevision),
            revision: Number(stored.revision),
          }
        : {}),
    });

    return {
      workItemId: observation.workItemId,
      sourceRevision: observation.sourceRevision,
      outcome: 'REJECTED',
      code,
    };
  }
}

/** Identity echoed on a receipt for a frame that failed validation. */
function reportedIdentity(
  frame: unknown,
): Pick<
  WorkItemExecutionStateObservationReceipt,
  'workItemId' | 'sourceRevision'
> {
  if (typeof frame !== 'object' || frame === null) {
    return {};
  }

  const { workItemId, sourceRevision } = frame as Record<string, unknown>;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return {
    ...(typeof workItemId === 'string' && uuid.test(workItemId)
      ? { workItemId }
      : {}),
    ...(Number.isSafeInteger(sourceRevision) && (sourceRevision as number) >= 0
      ? { sourceRevision: sourceRevision as number }
      : {}),
  };
}
