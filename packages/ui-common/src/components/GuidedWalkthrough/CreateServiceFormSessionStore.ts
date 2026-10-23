import type { CreateServiceFormInstanceId } from "./types";

/** Live state of the CreateServiceForm instance the walkthrough can follow. */
export interface CreateServiceFormSession {
  formInstanceId: CreateServiceFormInstanceId;
  /** A name has been entered and a type is chosen. */
  detailsReady: boolean;
}

type SessionListener = () => void;

/**
 * Holds the most recently published CreateServiceForm session. Disposal is
 * token-checked so a closing instance cannot clear a newer one.
 */
export class CreateServiceFormSessionStore {
  private entry: { token: symbol; session: CreateServiceFormSession } | null =
    null;
  private readonly listeners = new Set<SessionListener>();

  current(): CreateServiceFormSession | null {
    return this.entry?.session ?? null;
  }

  /** Publishes a session snapshot; returns a disposer for this owner token. */
  publish(token: symbol, session: CreateServiceFormSession): () => void {
    this.entry = { token, session };
    this.notify();
    return () => {
      if (this.entry?.token !== token) return;
      this.entry = null;
      this.notify();
    };
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
