import type {
  DataVariantQueryKeyField,
  QueryKey as QueryKeyObject,
  QueryKeyField,
  QueryKeyValue,
} from "./QueryKey";

type QueryKeyFields = Record<
  string,
  DataVariantQueryKeyField<QueryKeyValue> | QueryKeyField<QueryKeyValue>
>;
type QueryKey = QueryKeyObject<QueryKeyFields>;

export class ListQueryMap {
  private readonly items: Map<string, string[]>;

  constructor(source?: ListQueryMap | Map<string, string[]>) {
    this.items = new Map();

    if (!source) {
      return;
    }

    if (source instanceof ListQueryMap) {
      source.entries().forEach(([queryKey, ids]) => {
        this.items.set(queryKey, [...ids]);
      });
      return;
    }

    source.forEach((ids, queryKey) => {
      this.items.set(queryKey, [...ids]);
    });
  }

  get(queryKey: QueryKey): string[] | undefined {
    return this.items.get(queryKey.toKey());
  }

  getByKeyString(queryKey: string): string[] | undefined {
    return this.items.get(queryKey);
  }

  set(queryKey: QueryKey, ids: string[]): void {
    this.items.set(queryKey.toKey(), [...ids]);
  }

  setByKeyString(queryKey: string, ids: string[]): void {
    this.items.set(queryKey, [...ids]);
  }

  has(queryKey: QueryKey): boolean {
    return this.items.has(queryKey.toKey());
  }

  hasByKeyString(queryKey: string): boolean {
    return this.items.has(queryKey);
  }

  delete(queryKey: QueryKey): boolean {
    return this.items.delete(queryKey.toKey());
  }

  deleteByKeyString(queryKey: string): boolean {
    return this.items.delete(queryKey);
  }

  size(): number {
    return this.items.size;
  }

  entries(): Array<[string, string[]]> {
    return Array.from(this.items.entries());
  }

  forEach(callback: (ids: string[], queryKey: string) => void): void {
    this.items.forEach((ids, queryKey) => callback(ids, queryKey));
  }

  /**
   * Find all query key strings that contain a specific field=value segment.
   * Uses the serialized `field=value` format from QueryKey.toKey().
   */
  findKeysByFieldValue(field: string, value: string | null): string[] {
    const segment = `${field}=${value}`;
    const matches: string[] = [];
    this.items.forEach((_, queryKey) => {
      if (queryKey.includes(segment)) {
        matches.push(queryKey);
      }
    });
    return matches;
  }
}
