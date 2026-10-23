import type { CollectionItem, StorageId } from "./types";
import type {
  DataVariantQueryKeyField,
  QueryKey,
  QueryKeyField,
  QueryKeyValue,
} from "./QueryKey";

type QueryKeyFields = Record<
  string,
  DataVariantQueryKeyField<QueryKeyValue> | QueryKeyField<QueryKeyValue>
>;

export class CollectionMap<T> {
  private readonly items: Map<StorageId, CollectionItem<T>>;
  private readonly entityIndex: Map<string, Set<StorageId>>;

  constructor(
    source?:
      | CollectionMap<T>
      | Map<StorageId, CollectionItem<T>>
      | Iterable<[StorageId, CollectionItem<T>]>
  ) {
    this.items = new Map();
    this.entityIndex = new Map();

    if (!source) {
      return;
    }

    if (source instanceof CollectionMap) {
      source.entries().forEach(([storageId, item]) => {
        this.setByStorageId(storageId, item);
      });
      return;
    }

    if (source instanceof Map) {
      source.forEach((item, storageId) => {
        this.setByStorageId(storageId, item);
      });
      return;
    }

    for (const [storageId, item] of source) {
      this.setByStorageId(storageId, item);
    }
  }

  size(): number {
    return this.items.size;
  }

  entries(): Array<[StorageId, CollectionItem<T>]> {
    return Array.from(this.items.entries());
  }

  values(): CollectionItem<T>[] {
    return Array.from(this.items.values());
  }

  hasByStorageId(storageId: StorageId): boolean {
    return this.items.has(storageId);
  }

  getByStorageId(storageId: StorageId): CollectionItem<T> | undefined {
    return this.items.get(storageId);
  }

  get(
    entityId: string,
    queryKey: QueryKey<QueryKeyFields>
  ): CollectionItem<T> | undefined {
    return this.getByStorageId(queryKey.getId(entityId));
  }

  set(
    entityId: string,
    queryKey: QueryKey<QueryKeyFields>,
    item: CollectionItem<T>
  ): StorageId {
    const storageId = queryKey.getId(entityId);
    this.setByStorageId(storageId, item);
    return storageId;
  }

  setByStorageId(storageId: StorageId, item: CollectionItem<T>): void {
    this.items.set(storageId, item);
    const entityId = item.id;
    const existing = this.entityIndex.get(entityId);
    if (existing) {
      existing.add(storageId);
      return;
    }
    this.entityIndex.set(entityId, new Set([storageId]));
  }

  delete(entityId: string, queryKey: QueryKey<QueryKeyFields>): boolean {
    const storageId = queryKey.getId(entityId);
    return this.deleteByStorageId(storageId);
  }

  deleteByStorageId(storageId: StorageId): boolean {
    const item = this.items.get(storageId);
    if (!item) {
      return false;
    }

    const entityId = item.id;
    this.items.delete(storageId);
    const existing = this.entityIndex.get(entityId);
    if (existing) {
      existing.delete(storageId);
      if (existing.size === 0) {
        this.entityIndex.delete(entityId);
      }
    }

    return true;
  }

  getAllByEntityId(entityId: string): CollectionItem<T>[] {
    const storageIds = this.entityIndex.get(entityId);
    if (!storageIds) {
      return [];
    }
    const items: CollectionItem<T>[] = [];
    storageIds.forEach((storageId) => {
      const item = this.items.get(storageId);
      if (item) {
        items.push(item);
      }
    });
    return items;
  }

  getStorageIdsByEntityId(entityId: string): StorageId[] {
    const storageIds = this.entityIndex.get(entityId);
    if (!storageIds) {
      return [];
    }
    return Array.from(storageIds);
  }

  forEach(
    callback: (item: CollectionItem<T>, storageId: StorageId) => void
  ): void {
    this.items.forEach((item, storageId) => {
      callback(item, storageId);
    });
  }
}
