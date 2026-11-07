/**
 * Collects every key requested in the same tick and loads them with one call,
 * caching results for the rest of the request. Resolvers ask for one key; the
 * loader turns N field resolutions into one service read.
 */
export class RequestBatchLoader<K, V> {
  private readonly cache = new Map<K, Promise<V | undefined>>();
  private pending: Array<{
    key: K;
    resolve: (value: V | undefined) => void;
    reject: (error: unknown) => void;
  }> = [];

  /** `loadMany` returns values keyed by request key; missing keys load as undefined. */
  constructor(
    private readonly loadMany: (keys: K[]) => Promise<Map<K, V>>,
    private readonly maxBatchSize: number,
  ) {}

  load(key: K): Promise<V | undefined> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const promise = new Promise<V | undefined>((resolve, reject) => {
      this.pending.push({ key, resolve, reject });
      if (this.pending.length === 1) {
        process.nextTick(() => this.dispatch());
      }
    });
    this.cache.set(key, promise);

    return promise;
  }

  /** Seeds a value already read by a parent query so it is not fetched again. */
  prime(key: K, value: V): void {
    if (!this.cache.has(key)) {
      this.cache.set(key, Promise.resolve(value));
    }
  }

  private dispatch(): void {
    const batch = this.pending;
    this.pending = [];

    for (let start = 0; start < batch.length; start += this.maxBatchSize) {
      const chunk = batch.slice(start, start + this.maxBatchSize);
      this.loadMany(chunk.map((entry) => entry.key)).then(
        (values) => {
          for (const entry of chunk) {
            entry.resolve(values.get(entry.key));
          }
        },
        (error: unknown) => {
          for (const entry of chunk) {
            this.cache.delete(entry.key);
            entry.reject(error);
          }
        },
      );
    }
  }
}
