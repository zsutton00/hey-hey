import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  EntityType,
  OpenItemLineageEntry,
  OpenItemPresentation,
  OpenItemGoalTrackedWorkFilter,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { v4 as uuidv4 } from 'uuid';
import type {
  OpenItemGroupRow,
  OpenItemRow,
  OpenItemsChangeSet,
  OpenItemsState,
} from './open-items.domain';

export interface OpenItemsScope {
  organizationId: OrganizationId;
  projectId: ProjectId;
  userId: UserId;
}

export interface LockedOpenItemsCollection {
  id: string;
  revision: number;
  /** True when this transaction inserted the collection row. */
  created: boolean;
}

export interface OpenItemsIdempotencyRecord {
  operation: string;
  requestFingerprint: string;
  result: unknown;
}

/** Removed rows are kept this long so delayed retries cannot resurrect them. */
export const REMOVAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Idempotency results are kept for the whole of this window. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Upper bound on rows deleted per cleanup pass. */
export const CLEANUP_BATCH_SIZE = 500;

type ItemRecord = Prisma.OpenItemGetPayload<object>;
type GroupRecord = Prisma.OpenItemGroupGetPayload<object>;

const toItemRow = (record: ItemRecord): OpenItemRow => ({
  id: record.id,
  // Rows are only written from contract-validated input.
  entityType: record.entityType as EntityType,
  entityId: record.entityId,
  note: record.note,
  pinned: record.pinned,
  position: record.position,
  groupId: record.groupId,
  memberPosition: record.memberPosition,
  goalTrackedWorkFilter:
    record.goalTrackedWorkFilter as OpenItemGoalTrackedWorkFilter,
  goalCollapsed: record.goalCollapsed,
  revision: Number(record.revision),
  lineage: record.lineage as unknown as OpenItemLineageEntry[],
  presentation: record.presentation as unknown as OpenItemPresentation,
  removedAt: record.removedAt,
  updatedAt: record.updatedAt,
});

const toGroupRow = (record: GroupRecord): OpenItemGroupRow => ({
  id: record.id,
  name: record.name,
  position: record.position,
  collapsed: record.collapsed,
  revision: Number(record.revision),
  updatedAt: record.updatedAt,
});

const itemData = (row: OpenItemRow) => ({
  note: row.note,
  pinned: row.pinned,
  position: row.position,
  groupId: row.groupId,
  memberPosition: row.memberPosition,
  goalTrackedWorkFilter: row.goalTrackedWorkFilter,
  goalCollapsed: row.goalCollapsed,
  revision: BigInt(row.revision),
  lineage: row.lineage as unknown as Prisma.InputJsonValue,
  presentation: row.presentation as unknown as Prisma.InputJsonValue,
  removedAt: row.removedAt,
  updatedAt: row.updatedAt,
});

const groupData = (row: OpenItemGroupRow) => ({
  name: row.name,
  position: row.position,
  collapsed: row.collapsed,
  revision: BigInt(row.revision),
  updatedAt: row.updatedAt,
});

/** Relational persistence for Open Items; every write runs in a caller transaction. */
@Injectable()
export class OpenItemsRepository {
  private readonly logger = new Logger(OpenItemsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: AnyTransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.db.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 15_000,
    });
  }

  /** Non-locking canonical read. */
  async readState(scope: OpenItemsScope): Promise<OpenItemsState | null> {
    const collection = await this.prisma.db.openItemCollection.findUnique({
      where: {
        projectId_userId: { projectId: scope.projectId, userId: scope.userId },
      },
      select: { id: true, revision: true },
    });
    if (!collection) {
      this.logger.debug(
        `No Open Items collection for user ${scope.userId} in project ${scope.projectId}`,
      );
      return null;
    }
    return this.loadState(
      this.prisma.db,
      {
        id: collection.id,
        revision: Number(collection.revision),
        created: false,
      },
      { includeRemoved: false },
    );
  }

  /**
   * Locks the scope's collection row for the rest of the transaction,
   * inserting it first when `createIfAbsent` is set. Concurrent mutations of
   * one collection therefore serialize on this row.
   */
  async lockCollection(
    tx: AnyTransactionClient,
    scope: OpenItemsScope,
    createIfAbsent: boolean,
  ): Promise<LockedOpenItemsCollection | null> {
    let created = false;
    if (createIfAbsent) {
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "open_item_collections"
          ("id", "organization_id", "project_id", "user_id", "revision")
        VALUES (${uuidv4()}, ${scope.organizationId}, ${scope.projectId}, ${scope.userId}, 0)
        ON CONFLICT ("project_id", "user_id") DO NOTHING
        RETURNING "id"`;
      created = inserted.length > 0;
    }
    const rows = await tx.$queryRaw<{ id: string; revision: bigint }[]>`
      SELECT "id", "revision" FROM "open_item_collections"
      WHERE "project_id" = ${scope.projectId} AND "user_id" = ${scope.userId}
      FOR UPDATE`;
    if (rows.length === 0) {
      this.logger.debug(
        `Collection absent for user ${scope.userId} in project ${scope.projectId}`,
      );
      return null;
    }
    const locked = {
      id: rows[0].id,
      revision: Number(rows[0].revision),
      created,
    };
    this.logger.debug(
      `Locked collection ${locked.id} at revision ${locked.revision}${created ? ' (created)' : ''}`,
    );
    return locked;
  }

  async loadState(
    tx: AnyTransactionClient,
    collection: LockedOpenItemsCollection,
    options: { includeRemoved: boolean },
  ): Promise<OpenItemsState> {
    const [items, groups] = await Promise.all([
      tx.openItem.findMany({
        where: {
          collectionId: collection.id,
          ...(options.includeRemoved ? {} : { removedAt: null }),
        },
      }) as Promise<ItemRecord[]>,
      tx.openItemGroup.findMany({
        where: { collectionId: collection.id },
      }) as Promise<GroupRecord[]>,
    ]);
    return {
      revision: collection.revision,
      items: items.map(toItemRow),
      groups: groups.map(toGroupRow),
    };
  }

  async findIdempotencyRecord(
    tx: AnyTransactionClient,
    collectionId: string,
    idempotencyKey: string,
  ): Promise<OpenItemsIdempotencyRecord | null> {
    const record: OpenItemsIdempotencyRecord | null =
      await tx.openItemIdempotencyRecord.findUnique({
        where: {
          collectionId_idempotencyKey: { collectionId, idempotencyKey },
        },
        select: { operation: true, requestFingerprint: true, result: true },
      });
    return record;
  }

  async recordIdempotencyResult(
    tx: AnyTransactionClient,
    collectionId: string,
    idempotencyKey: string,
    record: OpenItemsIdempotencyRecord,
    now: Date,
  ): Promise<void> {
    await tx.openItemIdempotencyRecord.create({
      data: {
        collectionId,
        idempotencyKey,
        operation: record.operation,
        requestFingerprint: record.requestFingerprint,
        result: record.result as Prisma.InputJsonValue,
        createdAt: now,
      },
    });
  }

  /** Finish the same idempotent intent in the collection publication transaction. */
  async replaceIdempotencyResult(
    tx: AnyTransactionClient,
    collectionId: string,
    idempotencyKey: string,
    result: unknown,
  ): Promise<void> {
    await tx.openItemIdempotencyRecord.update({
      where: { collectionId_idempotencyKey: { collectionId, idempotencyKey } },
      data: { result: result as Prisma.InputJsonValue },
    });
  }

  /**
   * Writes a change set in foreign-key-safe order: clear, group upserts, item
   * upserts (which may reference new groups and release deleted ones), then
   * group deletes.
   */
  async applyChanges(
    tx: AnyTransactionClient,
    collectionId: string,
    changes: OpenItemsChangeSet,
  ): Promise<void> {
    if (changes.clearCollection) {
      const items = await tx.openItem.deleteMany({ where: { collectionId } });
      const groups = await tx.openItemGroup.deleteMany({
        where: { collectionId },
      });
      this.logger.debug(
        `Cleared collection ${collectionId}: ${items.count} item row(s), ${groups.count} group(s)`,
      );
    }
    for (const group of changes.groups.values()) {
      if (changes.createdGroupIds.has(group.id)) {
        await tx.openItemGroup.create({
          data: { id: group.id, collectionId, ...groupData(group) },
        });
      } else {
        await tx.openItemGroup.update({
          where: { id: group.id },
          data: groupData(group),
        });
      }
    }
    for (const item of changes.items.values()) {
      if (changes.createdItemIds.has(item.id)) {
        await tx.openItem.create({
          data: {
            id: item.id,
            collectionId,
            entityType: item.entityType,
            entityId: item.entityId,
            ...itemData(item),
          },
        });
      } else {
        await tx.openItem.update({
          where: { id: item.id },
          data: itemData(item),
        });
      }
    }
    if (changes.deletedGroupIds.length > 0) {
      await tx.openItemGroup.deleteMany({
        where: { collectionId, id: { in: changes.deletedGroupIds } },
      });
    }
    this.logger.debug(
      `Applied changes to ${collectionId}: ${changes.groups.size} group write(s), ${changes.items.size} item write(s), ${changes.deletedGroupIds.length} group delete(s)`,
    );
  }

  async advanceRevision(
    tx: AnyTransactionClient,
    collectionId: string,
    revision: number,
    now: Date,
  ): Promise<void> {
    await tx.openItemCollection.update({
      where: { id: collectionId },
      data: { revision: BigInt(revision), updatedAt: now },
    });
  }

  /**
   * Bounded cleanup of expired removal tombstones and idempotency records for
   * one collection. Runs inside the mutation transaction that holds the lock.
   */
  async cleanup(
    tx: AnyTransactionClient,
    collectionId: string,
    now: Date,
  ): Promise<{ removedItems: number; idempotencyRecords: number }> {
    const removalCutoff = new Date(now.getTime() - REMOVAL_RETENTION_MS);
    const idempotencyCutoff = new Date(
      now.getTime() - IDEMPOTENCY_RETENTION_MS,
    );
    const removedItems = await tx.$executeRaw`
      DELETE FROM "open_items" WHERE "id" IN (
        SELECT "id" FROM "open_items"
        WHERE "collection_id" = ${collectionId}
          AND "removed_at" IS NOT NULL AND "removed_at" < ${removalCutoff}
        LIMIT ${CLEANUP_BATCH_SIZE})`;
    // Only expired records are deleted: a retry anywhere inside the
    // retention window must still find its recorded result.
    const idempotencyRecords = await tx.$executeRaw`
      DELETE FROM "open_item_idempotency_records"
      WHERE "collection_id" = ${collectionId} AND "idempotency_key" IN (
        SELECT "idempotency_key" FROM "open_item_idempotency_records"
        WHERE "collection_id" = ${collectionId}
          AND "created_at" < ${idempotencyCutoff}
        LIMIT ${CLEANUP_BATCH_SIZE})`;
    if (removedItems > 0 || idempotencyRecords > 0) {
      this.logger.debug(
        `Cleanup for ${collectionId}: ${removedItems} expired removal(s), ${idempotencyRecords} idempotency record(s)`,
      );
    }
    return { removedItems, idempotencyRecords };
  }
}
