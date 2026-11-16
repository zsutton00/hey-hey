import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  Prisma,
  WorkItemExecutionState as StoredExecutionStateModel,
} from '@prisma/client';
import type {
  WorkItemExecutionState,
  WorkItemExecutionStateBatchItemDto,
  WorkItemExecutionStateObservation,
} from '@hey-hey/contracts/api/models';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { MachinePresenceService } from 'src/core/websockets/machine-presence.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MachineId, OrganizationId, ProjectId, UserId } from 'src/types';
import {
  parseStoredWorkItemExecutionStatePayload,
  parseWorkItemExecutionStateObservation,
} from './work-item-execution-state.boundary';
import { WorkItemExecutionStateRegistry } from './work-item-execution-state.registry';

export type WorkItemExecutionStateRejection =
  | 'MALFORMED'
  | 'MACHINE_MISMATCH'
  | 'MACHINE_REVOKED'
  | 'ITEM_NOT_FOUND'
  | 'TYPE_NOT_PARTICIPATING'
  | 'PROJECT_FORBIDDEN'
  | 'OWNER_MISMATCH'
  | 'STALE';

export type WorkItemExecutionStateObservationResult =
  | { outcome: 'ACCEPTED'; revision: number }
  | { outcome: 'DUPLICATE'; freshnessRestored: boolean }
  | { outcome: 'REJECTED'; code: WorkItemExecutionStateRejection };

/** One accepted change to a retained record, scoped for project fan-out. */
export interface WorkItemExecutionStateChange {
  organizationId: string;
  projectId: string;
  executionState: WorkItemExecutionState;
}

type StoredExecutionState = Pick<
  StoredExecutionStateModel,
  | 'workItemId'
  | 'organizationId'
  | 'projectId'
  | 'payload'
  | 'ownerMachineId'
  | 'sourceRevision'
  | 'revision'
  | 'ownerConnected'
  | 'freshnessChangedAt'
  | 'acceptedAt'
>;

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
 * Freshness. `ownerConnected` is stored beside the payload and never folded
 * into it. Connection changes touch freshness and `revision` only, so a
 * disconnect can neither clear a retained failure nor assert a healthy state.
 */
@Injectable()
export class WorkItemExecutionStateService
  implements OnModuleInit, OnModuleDestroy
{
  static readonly FRESHNESS_SWEEP_INTERVAL_MS = 60_000;
  static readonly FRESHNESS_SWEEP_MACHINE_LIMIT = 200;

  private readonly logger = new Logger(WorkItemExecutionStateService.name);
  private changeSink?: (change: WorkItemExecutionStateChange) => void;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly machinePresence: MachinePresenceService,
    private readonly registry: WorkItemExecutionStateRegistry,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.sweepTimer = setInterval(() => {
      void this.reconcileFreshnessWithPresence().catch((error: unknown) => {
        this.logger.error('[execution-state] freshness sweep failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, WorkItemExecutionStateService.FRESHNESS_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.sweepTimer = undefined;
  }

  /** Receives every accepted change so the gateway can fan it out. */
  setChangeSink(sink: (change: WorkItemExecutionStateChange) => void): void {
    this.changeSink = sink;
  }

  /**
   * Accept or reject one report from an authenticated CLI connection.
   * Project and organization scope come from the work item, never the frame.
   */
  async observe(
    reporter: { userId: UserId; machineId: MachineId },
    frame: unknown,
  ): Promise<WorkItemExecutionStateObservationResult> {
    const parsed = parseWorkItemExecutionStateObservation(frame);
    if (!parsed.valid) {
      this.logger.warn('[execution-state] observation rejected', {
        code: 'MALFORMED' satisfies WorkItemExecutionStateRejection,
        machineId: reporter.machineId,
        failures: parsed.failures,
      });
      return { outcome: 'REJECTED', code: 'MALFORMED' };
    }

    const observation = parsed.value;
    const rejection = await this.authorizeReport(reporter, observation);
    if (rejection.code) {
      return this.reject(rejection.code, observation, rejection.stored);
    }

    const written = await this.writeAccepted(
      observation,
      rejection.workItem,
      rejection.confirmedTakeoverFrom,
    );
    if (written) {
      this.logger.log('[execution-state] observation accepted', {
        workItemId: observation.workItemId,
        machineId: observation.machineId,
        sourceRevision: observation.sourceRevision,
        revision: Number(written.revision),
        ownerChanged: rejection.confirmedTakeoverFrom !== null,
      });
      this.publish(written);
      return { outcome: 'ACCEPTED', revision: Number(written.revision) };
    }

    return this.classifyUnwritten(observation);
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
    const readAt = new Date();
    const retained = new Map<string, WorkItemExecutionState>();

    for (const row of stored) {
      const ownerSilent =
        row.ownerConnected && !present.has(row.ownerMachineId);
      const executionState = this.toExecutionState(
        ownerSilent
          ? { ...row, ownerConnected: false, freshnessChangedAt: readAt }
          : row,
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

  /**
   * Bring stored freshness in line with machine presence in both directions.
   * Covers an API instance that died without handling a disconnect, and a
   * connected machine whose rows were marked last-known after presence was
   * lost (for example a Redis restart) and has since been seen again.
   */
  async reconcileFreshnessWithPresence(): Promise<void> {
    const owners = await this.prisma.db.workItemExecutionState.findMany({
      distinct: ['ownerMachineId', 'ownerConnected'],
      select: { ownerMachineId: true, ownerConnected: true },
      take: WorkItemExecutionStateService.FRESHNESS_SWEEP_MACHINE_LIMIT,
      orderBy: { updatedAt: 'asc' },
    });

    for (const owner of owners) {
      const machineId = owner.ownerMachineId as MachineId;
      let present: boolean;
      try {
        present = await this.machinePresence.isPresent(machineId);
      } catch (error) {
        // Presence unknown: leave stored freshness alone. Reads already
        // report last-known while presence cannot be confirmed.
        this.logger.warn('[execution-state] presence check failed in sweep', {
          machineId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (present !== owner.ownerConnected) {
        await this.setMachineConnected(machineId, present);
      }
    }
  }

  private async authorizeReport(
    reporter: { userId: UserId; machineId: MachineId },
    observation: WorkItemExecutionStateObservation,
  ): Promise<
    | {
        code: WorkItemExecutionStateRejection;
        stored?: StoredExecutionState | null;
      }
    | {
        code?: undefined;
        workItem: { id: string; organizationId: string; projectId: string };
        confirmedTakeoverFrom: string | null;
      }
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

    const stateType = observation.state.type;
    if (workItem.type !== this.registry.workItemTypeFor(stateType)) {
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

    const stored = await this.findStored(observation.workItemId);
    if (!stored || stored.ownerMachineId === reporter.machineId) {
      return { workItem, confirmedTakeoverFrom: null };
    }

    const ownerRule = this.registry.ownerRuleFor(stateType);
    const confirmed = ownerRule
      ? await ownerRule({
          workItem,
          storedOwnerMachineId: stored.ownerMachineId,
          reportingMachineId: reporter.machineId,
        })
      : false;
    if (!confirmed) {
      return { code: 'OWNER_MISMATCH', stored };
    }

    return { workItem, confirmedTakeoverFrom: stored.ownerMachineId };
  }

  /**
   * One statement decides the write, so concurrent API instances cannot both
   * win or regress the row. Returns nothing when the report is not newer.
   */
  private async writeAccepted(
    observation: WorkItemExecutionStateObservation,
    workItem: { organizationId: string; projectId: string },
    confirmedTakeoverFrom: string | null,
  ): Promise<StoredExecutionState | undefined> {
    const rows = await this.prisma.$queryRaw<StoredExecutionState[]>(
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
    observation: WorkItemExecutionStateObservation,
  ): Promise<WorkItemExecutionStateObservationResult> {
    const stored = await this.findStored(observation.workItemId);
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
    const restored = await this.prisma.$queryRaw<StoredExecutionState[]>(
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
    restored.forEach((row) => this.publish(row));
    this.logger.verbose('[execution-state] duplicate observation', {
      workItemId: observation.workItemId,
      machineId: observation.machineId,
      sourceRevision: observation.sourceRevision,
      freshnessRestored: restored.length > 0,
    });

    return { outcome: 'DUPLICATE', freshnessRestored: restored.length > 0 };
  }

  private async setMachineConnected(
    machineId: MachineId,
    connected: boolean,
  ): Promise<number> {
    const changed = await this.prisma.$queryRaw<StoredExecutionState[]>(
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
    changed.forEach((row) => this.publish(row));
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
    workItemId: string,
  ): Promise<StoredExecutionState | null> {
    return this.prisma.db.workItemExecutionState.findUnique({
      where: { workItemId },
    });
  }

  private async presentMachines(
    machineIds: readonly string[],
  ): Promise<Set<string>> {
    const present = new Set<string>();

    for (const machineId of new Set(machineIds)) {
      try {
        if (await this.machinePresence.isPresent(machineId as MachineId)) {
          present.add(machineId);
        }
      } catch (error) {
        // Presence unknown is not evidence the owner is connected.
        this.logger.warn('[execution-state] presence check failed on read', {
          machineId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return present;
  }

  private publish(row: StoredExecutionState): void {
    const executionState = this.toExecutionState(row);
    if (!executionState) {
      return;
    }

    this.changeSink?.({
      organizationId: row.organizationId,
      projectId: row.projectId,
      executionState,
    });
  }

  /**
   * A retained payload written under an older contract may no longer match
   * it. That state is unavailable to consumers, not silently reshaped.
   */
  private toExecutionState(
    row: StoredExecutionState,
  ): WorkItemExecutionState | undefined {
    const state = parseStoredWorkItemExecutionStatePayload(row.payload);
    if (!state.valid) {
      this.logger.error('[execution-state] retained state unreadable', {
        code: 'STORED_STATE_INVALID',
        workItemId: row.workItemId,
        ownerMachineId: row.ownerMachineId,
        revision: Number(row.revision),
        failures: state.failures,
      });
      return undefined;
    }

    return {
      workItemId: row.workItemId,
      state: state.value,
      revision: Number(row.revision),
      ownerMachineId: row.ownerMachineId,
      acceptedAt: row.acceptedAt.toISOString(),
      freshness: {
        status: row.ownerConnected ? 'CURRENT' : 'LAST_KNOWN',
        changedAt: row.freshnessChangedAt.toISOString(),
      },
    } satisfies WorkItemExecutionState;
  }

  private reject(
    code: WorkItemExecutionStateRejection,
    observation: WorkItemExecutionStateObservation,
    stored?: StoredExecutionState | null,
  ): WorkItemExecutionStateObservationResult {
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

    return { outcome: 'REJECTED', code };
  }
}
