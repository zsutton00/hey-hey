export class PushableMessageStream<T> implements AsyncIterableIterator<T> {
  private queue: T[] = [];
  private readResolve?: ((value: IteratorResult<T>) => void) | undefined;
  private readReject?: ((reason?: unknown) => void) | undefined;
  private ended = false;
  private failure: Error | null = null;
  private consumed = false;

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.consumed) {
      throw new Error('Message stream can only be consumed once');
    }
    this.consumed = true;
    return this;
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      const value = this.queue.shift();
      if (value === undefined) {
        return { done: true, value: undefined };
      }
      return { done: false, value };
    }

    if (this.failure) {
      throw this.failure;
    }

    if (this.ended) {
      return { done: true, value: undefined };
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.readResolve = resolve;
      this.readReject = reject;
    });
  }

  push(value: T): void {
    if (this.ended || this.failure) {
      return;
    }

    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: false, value });
      return;
    }

    this.queue.push(value);
  }

  complete(): void {
    if (this.ended || this.failure) {
      return;
    }

    this.ended = true;

    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: true, value: undefined });
    }
  }

  fail(error: Error): void {
    if (this.ended || this.failure) {
      return;
    }

    this.failure = error;
    if (this.readReject) {
      const reject = this.readReject;
      this.readResolve = undefined;
      this.readReject = undefined;
      reject(error);
    }
  }

  async return(): Promise<IteratorResult<T>> {
    this.complete();
    return { done: true, value: undefined };
  }
}
