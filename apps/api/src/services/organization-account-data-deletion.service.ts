import { Injectable, Logger } from '@nestjs/common';
import {
  AccountAccessStatus,
  OrganizationClosureExecution,
  OrganizationClosureExecutionStage,
  OrganizationClosureProjectionConsumer,
  OrganizationClosureProjectionOutcome,
  Prisma,
} from '@prisma/client';
import { OrganizationConnectionEvictionService } from '../core/websockets/organization-connection-eviction.service';
import { PrismaService } from '../prisma/prisma.service';
import type { OrganizationId } from '../types';
import { OrganizationAccountDataDeletionOwner } from './organization-account-data-deletion.owner';
import {
  MAX_ORGANIZATION_CLOSURE_ATTEMPTS,
  OrganizationClosureDueWorkService,
} from './organization-closure-due-work.service';
import { AccountEntitlementService } from './account-entitlement.service';
import { PaymentProviderBindingService } from './payment-entitlement/payment-provider-binding.service';

const RETAINED_ORGANIZATION_TABLES = new Set([
  'organization_deletion_markers',
  'organization_closure_projection_commands',
  'organization_closure_executions',
  'organization_closure_provider_correlation_tombstones',
  'outbox_events',
  // Outlives tenancy deletion until its demo user is removed.
  'demo_sandboxes',
]);
const MAX_FAILURE_LENGTH = 2000;

interface OrganizationTableRow {
  tableName: string;
}

export interface OrganizationForeignKeyRow {
  childTableName: string;
  parentTableName: string;
}

export function orderOrganizationScopedTables(
  tableNames: readonly string[],
  foreignKeys: readonly OrganizationForeignKeyRow[],
): string[] {
  const sortedTableNames = [...new Set(tableNames)].sort();
  const tableSet = new Set(sortedTableNames);
  const dependencies = new Map<string, Set<string>>(
    sortedTableNames.map((tableName) => [tableName, new Set<string>()]),
  );

  for (const { childTableName, parentTableName } of foreignKeys) {
    if (
      childTableName === parentTableName ||
      !tableSet.has(childTableName) ||
      !tableSet.has(parentTableName)
    ) {
      continue;
    }
    dependencies.get(childTableName)!.add(parentTableName);
  }

  // A child must be deleted before the parent it references. With edges
  // child -> parent, the incoming edge count is the number of child tables
  // that still need to be removed before a table can be processed.
  const incomingEdgeCounts = new Map(
    sortedTableNames.map((tableName) => [tableName, 0]),
  );
  for (const parents of dependencies.values()) {
    for (const parentTableName of parents) {
      incomingEdgeCounts.set(
        parentTableName,
        incomingEdgeCounts.get(parentTableName)! + 1,
      );
    }
  }

  const ready = sortedTableNames.filter(
    (tableName) => incomingEdgeCounts.get(tableName) === 0,
  );
  const ordered: string[] = [];
  while (ready.length > 0) {
    const tableName = ready.shift()!;
    ordered.push(tableName);

    for (const parentTableName of [...dependencies.get(tableName)!].sort()) {
      const remainingChildren = incomingEdgeCounts.get(parentTableName)! - 1;
      incomingEdgeCounts.set(parentTableName, remainingChildren);
      if (remainingChildren === 0) {
        ready.push(parentTableName);
        ready.sort();
      }
    }
  }

  if (ordered.length !== sortedTableNames.length) {
    const remainingTables = sortedTableNames.filter(
      (tableName) => !ordered.includes(tableName),
    );
    const cycle = findOrganizationTableDependencyCycle(
      remainingTables,
      dependencies,
    );
    const diagnostic = cycle?.join(' -> ') ?? remainingTables.join(', ');
    throw new Error(
      `Organization-scoped table foreign-key dependency cycle detected: ${diagnostic}`,
    );
  }

  return ordered;
}

function findOrganizationTableDependencyCycle(
  tableNames: readonly string[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): string[] | null {
  const tableSet = new Set(tableNames);
  const states = new Map<string, 'visiting' | 'visited'>();
  const path: string[] = [];

  const visit = (tableName: string): string[] | null => {
    states.set(tableName, 'visiting');
    path.push(tableName);

    for (const parentTableName of [...(dependencies.get(tableName) ?? [])]
      .filter((name) => tableSet.has(name))
      .sort()) {
      const state = states.get(parentTableName);
      if (state === 'visiting') {
        const cycleStart = path.indexOf(parentTableName);
        return [...path.slice(cycleStart), parentTableName];
      }
      if (!state) {
        const cycle = visit(parentTableName);
        if (cycle) return cycle;
      }
    }

    path.pop();
    states.set(tableName, 'visited');
    return null;
  };

  for (const tableName of [...tableNames].sort()) {
    if (!states.has(tableName)) {
      const cycle = visit(tableName);
      if (cycle) return cycle;
    }
  }
  return null;
}

@Injectable()
export class OrganizationAccountDataDeletionService extends OrganizationAccountDataDeletionOwner {
  private readonly logger = new Logger(
    OrganizationAccountDataDeletionService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly dueWork: OrganizationClosureDueWorkService,
    private readonly connectionEviction: OrganizationConnectionEvictionService,
    private readonly accountEntitlements: AccountEntitlementService,
    private readonly paymentProviderBindings: PaymentProviderBindingService,
  ) {
    super();
  }

  async executeForOrganization(
    organizationId: OrganizationId,
  ): Promise<boolean> {
    const existing =
      await this.prisma.db.organizationClosureExecution.findUnique({
        where: { organizationId },
      });
    if (!existing) {
      await this.dueWork.materializeReachedSnapshot(organizationId);
    }
    const execution = await this.dueWork.claimNext(new Date(), organizationId);
    if (!execution) return false;
    await this.execute(execution);
    return true;
  }

  async execute(execution: OrganizationClosureExecution): Promise<void> {
    try {
      this.logger.debug({
        event: 'organization_closure_pre_projection_entry_received',
        organizationId: execution.organizationId,
        markerId: execution.markerId,
        stage: execution.stage,
        attemptCount: execution.attemptCount,
        claimedAt: execution.claimedAt?.toISOString() ?? null,
        leaseExpiresAt: execution.leaseExpiresAt?.toISOString() ?? null,
      });
      if (
        execution.stage === OrganizationClosureExecutionStage.COMPLETED ||
        execution.stage === OrganizationClosureExecutionStage.FAILED
      ) {
        this.logger.debug({
          event: 'organization_closure_terminal_stage_skipped',
          organizationId: execution.organizationId,
          markerId: execution.markerId,
          stage: execution.stage,
          attemptCount: execution.attemptCount,
        });
        return;
      }

      if (
        execution.stage ===
          OrganizationClosureExecutionStage.AUTHORITY_REVOKED ||
        execution.stage === OrganizationClosureExecutionStage.CONTENT_DELETED ||
        execution.stage ===
          OrganizationClosureExecutionStage.PROJECTIONS_INVALIDATED ||
        execution.stage === OrganizationClosureExecutionStage.VERIFIED
      ) {
        // This is the pre-projection entrypoint. Any later stage is resumed by
        // the projection coordinator, which owns the ordering gate.
        this.logger.warn({
          event: 'organization_closure_pre_projection_stage_deferred',
          organizationId: execution.organizationId,
          markerId: execution.markerId,
          stage: execution.stage,
          attemptCount: execution.attemptCount,
          expectedResumeOwner:
            'OrganizationProjectionDeletionCoordinatorService',
          claimRemainsLeased: execution.leaseExpiresAt !== null,
          leaseExpiresAt: execution.leaseExpiresAt?.toISOString() ?? null,
        });
        return;
      }

      if (execution.stage !== OrganizationClosureExecutionStage.PENDING) {
        throw new Error(
          `Unsupported organization closure stage: ${execution.stage}`,
        );
      }

      this.assertClaim(execution);
      this.logger.log({
        event: 'organization_closure_stage_started',
        organizationId: execution.organizationId,
        stage: execution.stage,
        attemptCount: execution.attemptCount,
      });
      await this.revokeAuthority(execution);
    } catch (error) {
      await this.recordFailure(execution, error);
      throw error;
    }
  }

  async executeAfterProjectionDeletion(
    execution: OrganizationClosureExecution,
  ): Promise<void> {
    try {
      if (
        execution.stage ===
          OrganizationClosureExecutionStage.AUTHORITY_REVOKED ||
        execution.stage === OrganizationClosureExecutionStage.CONTENT_DELETED ||
        execution.stage ===
          OrganizationClosureExecutionStage.PROJECTIONS_INVALIDATED ||
        execution.stage === OrganizationClosureExecutionStage.VERIFIED
      ) {
        await this.assertProjectionDeletionVerified(execution);
      }

      let current = execution;
      while (
        current.stage !== OrganizationClosureExecutionStage.COMPLETED &&
        current.stage !== OrganizationClosureExecutionStage.FAILED
      ) {
        this.assertClaim(current);
        this.logger.log({
          event: 'organization_closure_post_projection_stage_started',
          organizationId: current.organizationId,
          stage: current.stage,
          attemptCount: current.attemptCount,
        });
        if (
          current.stage !==
            OrganizationClosureExecutionStage.AUTHORITY_REVOKED &&
          current.stage !== OrganizationClosureExecutionStage.CONTENT_DELETED &&
          current.stage !==
            OrganizationClosureExecutionStage.PROJECTIONS_INVALIDATED &&
          current.stage !== OrganizationClosureExecutionStage.VERIFIED
        ) {
          throw new Error(
            `Post-projection deletion started at unsupported stage: ${current.stage}`,
          );
        }
        current = await this.executeStage(current);
      }
    } catch (error) {
      await this.recordFailure(execution, error);
      throw error;
    }
  }

  private async assertProjectionDeletionVerified(
    execution: OrganizationClosureExecution,
  ): Promise<void> {
    const commands =
      await this.prisma.db.organizationClosureProjectionCommand.findMany({
        where: {
          organizationId: execution.organizationId,
          markerId: execution.markerId,
        },
      });

    for (const consumer of [
      OrganizationClosureProjectionConsumer.GRAPH,
      OrganizationClosureProjectionConsumer.EMBEDDINGS,
    ]) {
      const command = commands.find(
        (candidate) => candidate.consumer === consumer,
      );
      if (
        !command ||
        command.organizationId !== execution.organizationId ||
        command.markerId !== execution.markerId ||
        command.irreversibleClosureAt.getTime() !==
          execution.effectiveClosureAt.getTime() ||
        command.deletionDeadline.getTime() !==
          execution.deletionDeadline.getTime() ||
        !command.acknowledgedAt ||
        command.verifiedOutcome !==
          OrganizationClosureProjectionOutcome.VERIFIED
      ) {
        throw new Error(
          `Projection deletion is not durably verified for ${consumer}`,
        );
      }
    }
  }

  private async executeStage(
    execution: OrganizationClosureExecution,
  ): Promise<OrganizationClosureExecution> {
    switch (execution.stage) {
      case OrganizationClosureExecutionStage.PENDING:
        return this.revokeAuthority(execution);
      case OrganizationClosureExecutionStage.AUTHORITY_REVOKED:
        return this.deleteContent(execution);
      case OrganizationClosureExecutionStage.CONTENT_DELETED:
        return this.markProjectionInvalidation(execution);
      case OrganizationClosureExecutionStage.PROJECTIONS_INVALIDATED:
        return this.verifyDeletion(execution);
      case OrganizationClosureExecutionStage.VERIFIED:
        return this.complete(execution);
      default:
        throw new Error(
          `Unsupported organization closure stage: ${execution.stage}`,
        );
    }
  }

  private async revokeAuthority(
    execution: OrganizationClosureExecution,
  ): Promise<OrganizationClosureExecution> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const [organization, lifecycle, entitlement, marker] = await Promise.all([
        tx.organization.findUnique({
          where: { id: execution.organizationId },
          select: { id: true },
        }),
        tx.organizationAccountLifecycle.findUnique({
          where: { organizationId: execution.organizationId },
        }),
        tx.accountEntitlement.findUnique({
          where: { organizationId: execution.organizationId },
        }),
        tx.organizationDeletionMarker.findUnique({
          where: { organizationId: execution.organizationId },
        }),
      ]);

      if (!organization && !lifecycle && !entitlement) {
        const markerMatchesExecution =
          marker !== null &&
          marker.organizationId === execution.organizationId &&
          marker.id === execution.markerId &&
          marker.effectiveClosureAt.getTime() ===
            execution.effectiveClosureAt.getTime() &&
          marker.deletionDeadline.getTime() ===
            execution.deletionDeadline.getTime();
        if (!markerMatchesExecution) {
          throw new Error(
            'Retained closure marker does not match the claimed execution',
          );
        }
        await this.advanceStage(
          tx,
          execution,
          OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
          now,
        );
        return;
      }

      if (!organization || !lifecycle || !entitlement) {
        throw new Error(
          'Partial live organization state cannot resume closure execution',
        );
      }
      if (
        !lifecycle.irreversibleClosureAt ||
        lifecycle.irreversibleClosureAt.getTime() > now.getTime()
      ) {
        throw new Error('Closure snapshot has not been reached');
      }
      await tx.organization.update({
        where: { id: execution.organizationId },
        data: { isActive: false },
      });
      await this.accountEntitlements.transitionInTransaction(
        tx,
        execution.organizationId as OrganizationId,
        entitlement.revision,
        {
          subscriptionType: entitlement.subscriptionType,
          accessStatus: AccountAccessStatus.REVOKED,
          accessThroughAt: entitlement.accessThroughAt,
          paidThroughAt: entitlement.paidThroughAt,
        },
        {
          actor: 'account-closure-worker',
          reason: 'Effective organization closure',
        },
      );
      await tx.apiKey.updateMany({
        where: { organizationId: execution.organizationId, isActive: true },
        data: { isActive: false },
      });
      await this.advanceStage(
        tx,
        execution,
        OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
        now,
      );
    });

    const disconnected = await this.connectionEviction.evictOrganization(
      execution.organizationId as OrganizationId,
    );
    this.logger.log({
      event: 'organization_closure_connections_disconnected',
      organizationId: execution.organizationId,
      disconnected,
    });
    return this.loadClaimed(execution);
  }

  private async deleteContent(
    execution: OrganizationClosureExecution,
  ): Promise<OrganizationClosureExecution> {
    // Repeat cluster-wide eviction on resumed deletion attempts so a crash
    // after the stage transition cannot leave an already-authorized channel.
    await this.connectionEviction.evictOrganization(
      execution.organizationId as OrganizationId,
    );
    const tables = await this.organizationScopedTables();
    await this.prisma.$transaction(async (tx) => {
      await tx.outboxEvent.deleteMany({
        where: {
          organizationId: execution.organizationId,
          eventType: { not: 'organization.closed' },
        },
      });

      await this.paymentProviderBindings.snapshotForClosure(
        tx,
        execution.organizationId as OrganizationId,
        execution.markerId,
      );

      // The organization FK graph is the primary bounded deletion mechanism.
      // The catalog sweep that follows removes organization-keyed operational
      // rows which intentionally have no FK to the organization aggregate.
      await tx.organization.deleteMany({
        where: { id: execution.organizationId },
      });

      for (const tableName of tables) {
        if (
          RETAINED_ORGANIZATION_TABLES.has(tableName) ||
          tableName === 'organizations'
        ) {
          continue;
        }
        const quotedTable = this.quoteCatalogIdentifier(tableName);
        await tx.$executeRawUnsafe(
          `DELETE FROM ${quotedTable} WHERE organization_id = $1`,
          execution.organizationId,
        );
      }
      await this.advanceStage(
        tx,
        execution,
        OrganizationClosureExecutionStage.CONTENT_DELETED,
        new Date(),
      );
    });
    return this.loadClaimed(execution);
  }

  private async markProjectionInvalidation(
    execution: OrganizationClosureExecution,
  ): Promise<OrganizationClosureExecution> {
    // The retained marker and organization.closed outbox event are the durable
    // projection fence. Consumers must apply them before replayed mutations.
    await this.prisma.$transaction((tx) =>
      this.advanceStage(
        tx,
        execution,
        OrganizationClosureExecutionStage.PROJECTIONS_INVALIDATED,
        new Date(),
      ),
    );
    return this.loadClaimed(execution);
  }

  private async verifyDeletion(
    execution: OrganizationClosureExecution,
  ): Promise<OrganizationClosureExecution> {
    const tables = await this.organizationScopedTables();
    for (const tableName of tables) {
      if (RETAINED_ORGANIZATION_TABLES.has(tableName)) continue;
      const quotedTable = this.quoteCatalogIdentifier(tableName);
      const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM ${quotedTable} WHERE organization_id = $1`,
        execution.organizationId,
      );
      if ((rows[0]?.count ?? 0n) !== 0n) {
        throw new Error(
          `Authoritative deletion verification failed for ${tableName}`,
        );
      }
    }

    const [organizationCount, markerCount, closureEventCount, otherEventCount] =
      await Promise.all([
        this.prisma.db.organization.count({
          where: { id: execution.organizationId },
        }),
        this.prisma.db.organizationDeletionMarker.count({
          where: {
            organizationId: execution.organizationId,
            id: execution.markerId,
          },
        }),
        this.prisma.db.outboxEvent.count({
          where: {
            organizationId: execution.organizationId,
            eventType: 'organization.closed',
            aggregateId: execution.organizationId,
          },
        }),
        this.prisma.db.outboxEvent.count({
          where: {
            organizationId: execution.organizationId,
            eventType: { not: 'organization.closed' },
          },
        }),
      ]);
    if (organizationCount !== 0) {
      throw new Error(
        'Authoritative organization deletion verification failed',
      );
    }
    if (markerCount !== 1 || closureEventCount !== 1 || otherEventCount !== 0) {
      throw new Error('Retained closure evidence verification failed');
    }

    await this.prisma.$transaction((tx) =>
      this.advanceStage(
        tx,
        execution,
        OrganizationClosureExecutionStage.VERIFIED,
        new Date(),
      ),
    );
    this.logger.log({
      event: 'organization_closure_verified',
      organizationId: execution.organizationId,
      checkedTableCount: tables.length,
    });
    return this.loadClaimed(execution);
  }

  private async complete(
    execution: OrganizationClosureExecution,
  ): Promise<OrganizationClosureExecution> {
    const now = new Date();
    const updated =
      await this.prisma.db.organizationClosureExecution.updateMany({
        where: this.claimWhere(execution),
        data: {
          stage: OrganizationClosureExecutionStage.COMPLETED,
          completedAt: now,
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          nextRetryAt: null,
          revision: { increment: 1 },
        },
      });
    if (updated.count !== 1)
      throw new Error('Organization closure claim was lost');
    this.logger.log({
      event: 'organization_closure_completed',
      organizationId: execution.organizationId,
    });
    return this.prisma.db.organizationClosureExecution.findUniqueOrThrow({
      where: { organizationId: execution.organizationId },
    });
  }

  private async advanceStage(
    tx: Prisma.TransactionClient,
    execution: OrganizationClosureExecution,
    stage: OrganizationClosureExecutionStage,
    now: Date,
  ): Promise<void> {
    const updated = await tx.organizationClosureExecution.updateMany({
      where: this.claimWhere(execution),
      data: { stage, updatedAt: now, revision: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new Error('Organization closure claim was lost');
    this.logger.log({
      event: 'organization_closure_stage_completed',
      organizationId: execution.organizationId,
      stage,
    });
  }

  private async loadClaimed(
    execution: OrganizationClosureExecution,
  ): Promise<OrganizationClosureExecution> {
    return this.prisma.db.organizationClosureExecution.findUniqueOrThrow({
      where: { organizationId: execution.organizationId },
    });
  }

  private claimWhere(execution: OrganizationClosureExecution) {
    return {
      organizationId: execution.organizationId,
      claimToken: execution.claimToken,
      attemptId: execution.attemptId,
    };
  }

  private assertClaim(execution: OrganizationClosureExecution): void {
    if (!execution.claimToken || !execution.attemptId || !execution.claimedAt) {
      throw new Error('Organization closure execution is not claimed');
    }
  }

  private async recordFailure(
    execution: OrganizationClosureExecution,
    error: unknown,
  ): Promise<void> {
    const failureType =
      error instanceof Error ? error.constructor.name : 'UnknownError';
    const failureEvidence = `${execution.stage}:${failureType}`.slice(
      0,
      MAX_FAILURE_LENGTH,
    );
    const exhausted =
      execution.attemptCount >= MAX_ORGANIZATION_CLOSURE_ATTEMPTS;
    const retryAt = new Date(
      Date.now() +
        Math.min(
          60_000 * 2 ** Math.max(execution.attemptCount - 1, 0),
          3_600_000,
        ),
    );
    await this.prisma.db.organizationClosureExecution.updateMany({
      where: this.claimWhere(execution),
      data: {
        ...(exhausted
          ? {
              stage: OrganizationClosureExecutionStage.FAILED,
              failedAt: new Date(),
              nextRetryAt: null,
            }
          : { nextRetryAt: retryAt }),
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastFailure: failureEvidence,
        revision: { increment: 1 },
      },
    });
    this.logger.error({
      event: 'organization_closure_failed',
      organizationId: execution.organizationId,
      stage: execution.stage,
      attemptCount: execution.attemptCount,
      failureType,
      terminal: exhausted,
    });
  }

  private async organizationScopedTables(): Promise<string[]> {
    const [tableRows, foreignKeyRows] = await Promise.all([
      this.prisma.$queryRaw<OrganizationTableRow[]>(Prisma.sql`
        SELECT table_name AS "tableName"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND column_name = 'organization_id'
        ORDER BY table_name
      `),
      this.prisma.$queryRaw<OrganizationForeignKeyRow[]>(Prisma.sql`
        SELECT DISTINCT
          tc.table_name AS "childTableName",
          ccu.table_name AS "parentTableName"
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_schema = tc.constraint_schema
         AND ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_schema = current_schema()
          AND tc.table_schema = current_schema()
          AND ccu.table_schema = current_schema()
          AND tc.constraint_type = 'FOREIGN KEY'
        ORDER BY "childTableName", "parentTableName"
      `),
    ]);
    return orderOrganizationScopedTables(
      tableRows.map((row) => row.tableName),
      foreignKeyRows,
    );
  }

  private quoteCatalogIdentifier(identifier: string): string {
    if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
      throw new Error('Unsafe PostgreSQL catalog identifier');
    }
    return `"${identifier}"`;
  }
}
