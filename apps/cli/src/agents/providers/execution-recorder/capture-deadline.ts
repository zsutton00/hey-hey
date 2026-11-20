/** Stops awaiting filesystem work that cannot be cancelled by the operating system. */
export class CaptureDeadline {
  private readonly controller = new AbortController();
  private readonly timer = setTimeout(() => {
    this.controller.abort(new Error('Capture operation exceeded its two-second budget'));
  }, 2000);
  public readonly signal: AbortSignal;

  public constructor(parent?: AbortSignal) {
    this.signal = parent
      ? AbortSignal.any([parent, this.controller.signal])
      : this.controller.signal;
    this.timer.unref();
  }

  public async wait<T>(work: Promise<T>): Promise<T> {
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => {
        const reason: unknown = this.signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new Error('Capture operation aborted', { cause: reason }),
        );
      };
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) {
        abort();
      }
    });
    try {
      const result = await Promise.race([work, cancelled]);
      this.signal.throwIfAborted();
      return result;
    } finally {
      this.signal.removeEventListener('abort', abort);
    }
  }

  public close(): void {
    clearTimeout(this.timer);
  }
}
