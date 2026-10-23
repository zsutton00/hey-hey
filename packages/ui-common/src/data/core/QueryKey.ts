export type QueryKeyValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean>;

type QueryKeyFields = Record<
  string,
  DataVariantQueryKeyField<QueryKeyValue> | QueryKeyField<QueryKeyValue>
>;

const queryKeyInstanceCache = new Map<
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  Function,
  Map<string, QueryKey<QueryKeyFields>>
>();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const getQueryKeyCache = (ctor: Function) => {
  const existing = queryKeyInstanceCache.get(ctor);
  if (existing) {
    return existing;
  }
  const created = new Map<string, QueryKey<QueryKeyFields>>();
  queryKeyInstanceCache.set(ctor, created);
  return created;
};

const buildKeyString = (fields: QueryKeyFields): string =>
  Object.values(fields)
    .map((value) => `${value.field}=${value.value}`)
    .join("::");

export class QueryKeyField<T extends QueryKeyValue> {
  field: string;
  value: T;
  constructor(field: string, value: T) {
    this.field = field;
    this.value = value;
  }
}

export class DataVariantQueryKeyField<T extends QueryKeyValue> {
  field: string;
  value: T;
  constructor(field: string, value: T) {
    this.field = field;
    this.value = value;
  }
}

export abstract class QueryKey<F extends QueryKeyFields> {
  private readonly fields: F;
  private readonly dataVariant: string | undefined;
  private readonly key: string;

  constructor(fields: F) {
    this.fields = fields;
    this.key = buildKeyString(fields);
    const dataVariantParts: string[] = [];
    for (const value of Object.values(fields)) {
      if (value instanceof DataVariantQueryKeyField) {
        dataVariantParts.push(`${value.field}=${value.value}`);
      }
    }
    this.dataVariant =
      dataVariantParts.length > 0 ? dataVariantParts.join("::") : undefined;
  }

  protected static memoize<F extends QueryKeyFields, T extends QueryKey<F>>(
    this: new (fields: F) => T,
    fields: F
  ): T {
    const key = buildKeyString(fields);
    const cache = getQueryKeyCache(this);
    const existing = cache.get(key) as T | undefined;
    if (existing) {
      return existing;
    }
    const created = new this(fields);
    cache.set(key, created as QueryKey<QueryKeyFields>);
    return created;
  }

  toKey(): string {
    return this.key;
  }

  getFields(): F {
    return this.fields;
  }

  getId(id: string) {
    if (this.dataVariant) {
      return `${this.dataVariant}::${id}`;
    }
    return id;
  }
}
