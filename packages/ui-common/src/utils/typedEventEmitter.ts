import log from "./logger";

/**
 * Minimal strongly-typed event emitter used to broadcast collaboration events.
 * Avoids pulling in additional dependencies while keeping APIs explicit.
 */
export type EventListener<T> = (payload: T) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<TEvents extends Record<string, any>> {
  private listeners: {
    [K in keyof TEvents]?: Set<EventListener<TEvents[K]>>;
  } = {};

  on<K extends keyof TEvents>(
    event: K,
    listener: EventListener<TEvents[K]>
  ): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event]!.add(listener);

    return () => {
      this.listeners[event]?.delete(listener);
      if (this.listeners[event]?.size === 0) {
        delete this.listeners[event];
      }
    };
  }

  once<K extends keyof TEvents>(
    event: K,
    listener: EventListener<TEvents[K]>
  ): () => void {
    const wrapper: EventListener<TEvents[K]> = (payload) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof TEvents>(
    event: K,
    listener: EventListener<TEvents[K]>
  ): void {
    this.listeners[event]?.delete(listener);
    if (this.listeners[event]?.size === 0) {
      delete this.listeners[event];
    }
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    log.debug("collab", "[emit]", { event, payload });
    this.listeners[event]?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        // Surface listener errors to console to aid debugging without
        // interrupting other listeners.
        console.error(
          "[TypedEventEmitter] listener error",
          event as string,
          error
        );
      }
    });
  }

  removeAllListeners(): void {
    (Object.keys(this.listeners) as Array<keyof TEvents>).forEach((key) => {
      this.listeners[key]?.clear();
      delete this.listeners[key];
    });
  }
}
