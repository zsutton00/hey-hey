import type { WalkthroughEvent } from "./types";

export type WalkthroughEventListener = (event: WalkthroughEvent) => void;

/**
 * Typed in-app channel for completion events. Owning components emit; the
 * runner subscribes. Completion is never inferred from DOM structure.
 */
export class WalkthroughEventChannel {
  private readonly listeners = new Set<WalkthroughEventListener>();

  emit(event: WalkthroughEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: WalkthroughEventListener): () => void {
    // Wrap so the same function subscribed twice gets independent disposal.
    const entry: WalkthroughEventListener = (event) => listener(event);
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }
}
