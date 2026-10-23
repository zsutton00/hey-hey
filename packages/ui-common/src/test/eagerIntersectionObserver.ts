export class EagerIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }

  disconnect(): void {}

  unobserve(): void {}
}
