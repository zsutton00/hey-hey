import type { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { EntityActivation } from "../contexts/EntityActivationContext";
import type {
  OpenItemsApiInterface,
  OpenItemsCollection,
  OpenItemsMutationResult,
  OpenItemRef,
  PromoteGroupToGoalRequest,
} from "../api";
import { openItemsClient } from "../clients/serviceClients";
import { readOpenItemsBrowserRecord } from "./openItemsBrowserRecord";
import {
  openItemsGroupRows,
  openItemsLineage,
  openItemsMigration,
  openItemsPresentation,
  openItemsRef,
  openItemsRows,
  type OpenItemsIdentity,
} from "./openItemsMapping";
import type { OpenItemsBrowserRecord } from "./openItemsModel";
import {
  parseOpenItemsJson,
  readOpenItemsCache,
  readOpenItemsQueue,
} from "./openItemsPersistence";
import {
  validOpenItemsCollection,
  validOpenItemsMigration,
  validOpenItemsMutationResult,
  validGroupPromotionResult,
} from "./openItemsValidation";

export interface OpenItemsScope {
  organizationId: string;
  projectId: string;
  userId: string;
}
type MutationName = Exclude<
  keyof OpenItemsApiInterface,
  | "getOpenItems"
  | "migrateOpenItems"
  | "resetOpenItems"
  | "resolveOpenItemsTriageSession"
  | "promoteGroupToGoal"
>;
export type OpenItemsOperation = {
  [K in MutationName]: {
    kind: K;
    parameters: Omit<
      Parameters<OpenItemsApiInterface[K]>[0],
      "organizationId" | "projectId"
    >;
  };
}[MutationName];
/** Non-collection Open Items state. The collection itself lives only in the query cache. */
export interface OpenItemsStatus {
  preferences: OpenItemsBrowserRecord;
  pending: number;
  queued: number;
  offline: boolean;
  error: Error | null;
}

export const openItemsKeys = {
  root: () => ["openItems"] as const,
  collection: (scope: OpenItemsScope) =>
    [
      "openItems",
      scope.organizationId,
      scope.projectId,
      scope.userId,
      "collection",
    ] as const,
};

const identityKey = (identity: OpenItemRef) =>
  `${identity.entityType}:${identity.entityId}`;
const safeOffline = (operation: OpenItemsOperation) =>
  operation.kind === "activateOpenItem" ||
  operation.kind === "setOpenItemNote" ||
  operation.kind === "setOpenItemPin";
const errorValue = (error: unknown) =>
  error instanceof Error
    ? error
    : new Error("Unable to synchronize Open Items");
const networkFailure = (error: unknown) =>
  isAxiosError(error) && !error.response;

// Preference/disclosure edits must not reconstruct unchanged base rows.
// Collections are immutable authoritative snapshots in the query cache.
const rowProjections = new WeakMap<
  OpenItemsCollection,
  Pick<OpenItemsBrowserRecord, "items" | "groups">
>();

export function openItemsRecord(
  collection: OpenItemsCollection,
  preferences: OpenItemsBrowserRecord,
): OpenItemsBrowserRecord {
  let rows = rowProjections.get(collection);
  if (!rows) {
    rows = {
      items:
        collection.state === "PRESENT" ? openItemsRows(collection.items) : [],
      groups:
        collection.state === "PRESENT"
          ? openItemsGroupRows(collection.groups)
          : [],
    };
    rowProjections.set(collection, rows);
  }
  return { ...preferences, ...rows };
}

/**
 * Typed Open Items operations over the query cache: every authoritative
 * result is written to `openItemsKeys.collection(scope)` and saved to the
 * browser cache. Holds only the offline queue and non-collection status.
 */
export class OpenItemsAdapter {
  private listeners = new Set<() => void>();
  private queue: OpenItemsOperation[] = [];
  private activeMutations = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private status: OpenItemsStatus;
  /** Validated browser cache; a stale placeholder, never canonical data. */
  readonly cachedCollection: OpenItemsCollection | null;
  private legacyRecord: OpenItemsBrowserRecord | null;
  readonly cacheKey: string;
  readonly queryKey: ReturnType<typeof openItemsKeys.collection>;
  private migrationKey: string;
  private synchronized = false;

  constructor(
    readonly scope: OpenItemsScope,
    private queryClient: QueryClient,
    private client: OpenItemsApiInterface = openItemsClient,
    private storage: Storage | null = typeof localStorage === "undefined"
      ? null
      : localStorage,
  ) {
    this.queryKey = openItemsKeys.collection(scope);
    this.cacheKey = `open-items:cache:v2:${scope.userId}:${scope.organizationId}:${scope.projectId}`;
    this.migrationKey = `${this.cacheKey}:migration`;
    const cache = readOpenItemsCache(this.readStorage(this.cacheKey));
    this.queue = readOpenItemsQueue(this.readStorage(`${this.cacheKey}:queue`));
    this.cachedCollection = cache?.collection ?? null;
    this.legacyRecord = cache
      ? null
      : readOpenItemsBrowserRecord(
          this.readStorage(`open-items:v1:${scope.projectId}`),
        );
    this.status = {
      preferences: cache?.preferences ?? {
        ...this.legacyRecord!,
        items: [],
        groups: [],
      },
      pending: this.queue.length,
      queued: this.queue.length,
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      error: null,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getStatus = () => this.status;
  /** The canonical collection, or undefined before the first canonical read. */
  collection = () =>
    this.queryClient.getQueryData<OpenItemsCollection>(this.queryKey);
  /** Rows for a collection; before any collection, the legacy v1 record. */
  record(
    collection: OpenItemsCollection | null,
    preferences: OpenItemsBrowserRecord,
  ): OpenItemsBrowserRecord {
    if (collection) return openItemsRecord(collection, preferences);
    return this.legacyRecord ?? preferences;
  }
  private emit(update: Partial<OpenItemsStatus>) {
    this.status = { ...this.status, ...update };
    this.listeners.forEach((listener) => listener());
  }
  private readStorage(key: string) {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  private writeStorage(key: string, value: string) {
    try {
      this.storage?.setItem(key, value);
    } catch {
      /* Memory remains usable when storage is unavailable. */
    }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
  private saveCache() {
    const collection = this.collection() ?? this.cachedCollection;
    if (collection)
      this.writeStorage(
        this.cacheKey,
        JSON.stringify({
          version: 2,
          collection,
          preferences: { ...this.status.preferences, items: [], groups: [] },
        }),
      );
  }
  private saveQueue() {
    this.writeStorage(
      `${this.cacheKey}:queue`,
      JSON.stringify({ version: 1, operations: this.queue }),
    );
    this.emitPending();
  }
  private emitPending() {
    this.emit({
      queued: this.queue.length,
      pending: this.queue.length + this.activeMutations,
    });
  }
  markStale = () =>
    void this.queryClient.invalidateQueries({
      queryKey: this.queryKey,
      exact: true,
      refetchType: "none",
    });
  private fail(error: unknown) {
    this.emit({ error: errorValue(error) });
    this.markStale();
  }
  reportError = (error: unknown) => this.emit({ error: errorValue(error) });
  updatePreferences = (
    update: Pick<OpenItemsBrowserRecord, "sortDirection" | "disclosure">,
  ) => {
    this.emit({ preferences: { ...this.status.preferences, ...update } });
    this.saveCache();
  };
  setOffline = (offline: boolean) => {
    this.emit({ offline });
    if (offline) this.markStale();
  };

  private replace(collection: OpenItemsCollection) {
    if (!validOpenItemsCollection(collection))
      throw new Error("Invalid Open Items response");
    this.queryClient.setQueryData(this.queryKey, collection);
    this.legacyRecord = null;
    this.emit({ error: null });
    this.saveCache();
  }

  private apply(result: OpenItemsMutationResult) {
    if (!validOpenItemsMutationResult(result))
      throw new Error("Invalid Open Items mutation response");
    const collection = this.collection();
    if (
      collection?.state === "PRESENT" &&
      result.collectionRevision < collection.revision
    ) {
      if (!result.replayed) this.markStale();
      return;
    }
    const missedChanges =
      result.collectionRevision >
      (collection?.state === "PRESENT" ? collection.revision : 0) + 1;
    const items = new Map(
      (collection?.state === "PRESENT" ? collection.items : []).map((item) => [
        identityKey(item),
        item,
      ]),
    );
    for (const item of result.items) {
      if (item.removedAt !== null) items.delete(identityKey(item));
      else items.set(identityKey(item), item);
    }
    const groups = new Map(
      (collection?.state === "PRESENT" ? collection.groups : []).map(
        (group) => [group.groupId, group],
      ),
    );
    result.deletedGroupIds.forEach((id) => groups.delete(id));
    result.groups.forEach((group) => groups.set(group.groupId, group));
    this.replace({
      state: "PRESENT",
      revision: result.collectionRevision,
      items: [...items.values()],
      groups: [...groups.values()],
    });
    const advancedNoop =
      result.collectionRevision >
        (collection?.state === "PRESENT" ? collection.revision : 0) &&
      !result.items.some(
        (item) => item.revision === result.collectionRevision,
      ) &&
      !result.groups.some(
        (group) => group.revision === result.collectionRevision,
      ) &&
      result.deletedGroupIds.length === 0;
    return missedChanges || advancedNoop;
  }

  private applyOperation(
    operation: OpenItemsOperation,
    result: OpenItemsMutationResult,
  ) {
    const missedChanges = this.apply(result);
    const parameters = operation.parameters;
    // A concurrently removed target is a successful no-op. Read the full
    // collection to remove rows/groups that a partial result cannot name.
    const missingGroup =
      "groupId" in parameters &&
      !result.groups.some((group) => group.groupId === parameters.groupId) &&
      !result.deletedGroupIds.includes(parameters.groupId);
    const missingItem =
      "entityId" in parameters &&
      !result.items.some(
        (item) =>
          item.entityId === parameters.entityId &&
          item.entityType === parameters.entityType,
      );
    const missingRequestedItem =
      operation.kind === "removeOpenItems" &&
      operation.parameters.removeOpenItemsRequest.items.some(
        (ref) =>
          !result.items.some(
            (item) =>
              item.entityId === ref.entityId &&
              item.entityType === ref.entityType,
          ),
      );
    return missedChanges || missingGroup || missingItem || missingRequestedItem;
  }

  private async readCanonical() {
    let collection = (await this.client.getOpenItems(this.scope)).data.data;
    if (!validOpenItemsCollection(collection))
      throw new Error("Invalid Open Items response");
    if (collection.state === "ABSENT") {
      const saved = parseOpenItemsJson(this.readStorage(this.migrationKey));
      const migration = validOpenItemsMigration(saved)
        ? saved
        : openItemsMigration(
            readOpenItemsBrowserRecord(
              this.readStorage(`open-items:v1:${this.scope.projectId}`),
            ),
            crypto.randomUUID(),
          );
      if (migration.items.length || migration.groups.length) {
        this.writeStorage(this.migrationKey, JSON.stringify(migration));
        collection = (
          await this.client.migrateOpenItems({
            ...this.scope,
            migrateOpenItemsRequest: migration,
          })
        ).data.data;
      }
    }
    this.replace(collection);
    this.synchronized = true;
    return collection;
  }

  refreshForSignal = (revision: number) =>
    this.serial(async () => {
      // Recheck after any pending mutation: its response may already contain
      // this revision, or the tab may have become hidden while queued.
      if (document.visibilityState !== "visible" || this.status.offline) return;
      const current = this.collection();
      if (current?.state === "PRESENT" && current.revision >= revision) return;
      try {
        await this.readCanonical();
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });

  refresh = () =>
    this.serial(async () => {
      if (this.status.offline) throw new Error("Open Items is offline");
      try {
        await this.readCanonical();
        while (this.queue.length) {
          const operation = this.queue[0]!;
          try {
            if (this.applyOperation(operation, await this.dispatch(operation)))
              await this.readCanonical();
            this.queue.shift();
          } finally {
            this.saveQueue();
          }
        }
        return this.collection()!;
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });

  mutate = (operation: OpenItemsOperation): Promise<void> => {
    if (this.status.offline) {
      if (!safeOffline(operation)) {
        const error = new Error("This Open Items action requires a connection");
        this.reportError(error);
        return Promise.reject(error);
      }
      this.queue.push(operation);
      this.saveQueue();
      this.markStale();
      return Promise.resolve();
    }
    return this.executeOnlineOperation(operation, true).then(() => {});
  };

  /** Online manual operation exposing its scoped authoritative result. */
  mutateWithResult = (
    operation: OpenItemsOperation,
  ): Promise<OpenItemsMutationResult> =>
    this.executeOnlineOperation(operation, false);

  private executeOnlineOperation = (
    operation: OpenItemsOperation,
    queueNetworkFailure: boolean,
  ): Promise<OpenItemsMutationResult> => {
    if (this.status.offline)
      return Promise.reject(new Error("This action requires a connection"));
    this.activeMutations += 1;
    this.emitPending();
    return this.serial(async () => {
      try {
        if (!this.synchronized) await this.readCanonical();
        const result = await this.dispatch(operation);
        if (this.applyOperation(operation, result)) await this.readCanonical();
        return result;
      } catch (error) {
        if (
          queueNetworkFailure &&
          networkFailure(error) &&
          safeOffline(operation)
        ) {
          this.queue.push(operation);
          this.saveQueue();
        }
        this.fail(error);
        throw error;
      } finally {
        this.activeMutations -= 1;
        this.emitPending();
      }
    });
  };

  private async dispatch(
    operation: OpenItemsOperation,
  ): Promise<OpenItemsMutationResult> {
    const scope = this.scope;
    switch (operation.kind) {
      case "setOpenItemGoalFilter":
        return (
          await this.client.setOpenItemGoalFilter({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "setOpenItemGoalDisclosure":
        return (
          await this.client.setOpenItemGoalDisclosure({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "activateOpenItem":
        return (
          await this.client.activateOpenItem({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "setOpenItemNote":
        return (
          await this.client.setOpenItemNote({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "setOpenItemPin":
        return (
          await this.client.setOpenItemPin({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "removeOpenItem":
        return (
          await this.client.removeOpenItem({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "removeOpenItems":
        return (
          await this.client.removeOpenItems({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "moveOpenItem":
        return (
          await this.client.moveOpenItem({ ...scope, ...operation.parameters })
        ).data.data;
      case "createOpenItemGroup":
        return (
          await this.client.createOpenItemGroup({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "renameOpenItemGroup":
        return (
          await this.client.renameOpenItemGroup({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "deleteOpenItemGroup":
        return (
          await this.client.deleteOpenItemGroup({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "setOpenItemGroupDisclosure":
        return (
          await this.client.setOpenItemGroupDisclosure({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "assignOpenItemsToGroup":
        return (
          await this.client.assignOpenItemsToGroup({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "ungroupOpenItems":
        return (
          await this.client.ungroupOpenItems({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "moveOpenItemGroup":
        return (
          await this.client.moveOpenItemGroup({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
      case "moveOpenItemGroupMember":
        return (
          await this.client.moveOpenItemGroupMember({
            ...scope,
            ...operation.parameters,
          })
        ).data.data;
    }
  }

  ref(identity: OpenItemsIdentity): OpenItemRef {
    return openItemsRef(identity);
  }

  promoteGroupToGoal = (request: PromoteGroupToGoalRequest) =>
    this.serial(async () => {
      if (this.status.offline)
        throw new Error("Promotion requires a connection");
      this.activeMutations += 1;
      this.emitPending();
      try {
        if (!this.synchronized) await this.readCanonical();
        const result = (
          await this.client.promoteGroupToGoal({
            ...this.scope,
            promoteGroupToGoalRequest: request,
          })
        ).data.data;
        if (!validGroupPromotionResult(result))
          throw new Error("Invalid Open Items promotion response");
        const current = this.collection();
        if (
          current?.state !== "PRESENT" ||
          result.collection.revision >= current.revision
        )
          this.replace(result.collection);
        else this.markStale();
        return result;
      } catch (error) {
        this.fail(error);
        throw error;
      } finally {
        this.activeMutations -= 1;
        this.emitPending();
      }
    });
  activate = async (activation: EntityActivation) => {
    if (!this.synchronized && !this.status.offline) await this.refresh();
    return this.mutate({
      kind: "activateOpenItem",
      parameters: {
        activateOpenItemRequest: {
          idempotencyKey: crypto.randomUUID(),
          item: this.ref(activation),
          lineage: openItemsLineage(activation),
          presentation: openItemsPresentation(activation),
        },
      },
    });
  };
  reset = () =>
    this.serial(async () => {
      if (this.status.offline) throw new Error("Reset requires a connection");
      this.activeMutations += 1;
      this.emitPending();
      try {
        if (!this.synchronized) await this.readCanonical();
        this.replace(
          (
            await this.client.resetOpenItems({
              ...this.scope,
              resetOpenItemsRequest: {
                idempotencyKey: crypto.randomUUID(),
              },
            })
          ).data.data,
        );
        this.queue = [];
        this.saveQueue();
      } catch (error) {
        this.fail(error);
        throw error;
      } finally {
        this.activeMutations -= 1;
        this.emitPending();
      }
    });
}
