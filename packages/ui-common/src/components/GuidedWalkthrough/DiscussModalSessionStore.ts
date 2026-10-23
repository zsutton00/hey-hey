import type { DiscussModalInstanceId, GuidableEntity } from "./types";

/** Suggested-prompt availability inside one DiscussModal instance. */
export type DiscussSuggestionView =
  | { status: "none" }
  | { status: "available"; text: string }
  | { status: "protected"; text: string }
  | { status: "accepted"; text: string };

/**
 * Live state of the DiscussModal instance the walkthrough can follow. The
 * modal publishes immutable snapshots; the overlay renders the suggestion
 * helper into `guidanceContainer`, which sits inside the Dialog's
 * keyboard/focus boundary.
 */
export interface DiscussModalSession {
  entity: GuidableEntity;
  modalInstanceId: DiscussModalInstanceId;
  /** A suggestion was accepted or the prompt holds non-empty text. */
  promptReady: boolean;
  suggestion: DiscussSuggestionView;
  guidanceContainer: HTMLElement | null;
  /** Makes (or updates) the suggestion offered for this instance. */
  offerSuggestion: (text: string) => void;
  /** Fills the editor; returns false when user text is protected. */
  acceptSuggestion: () => boolean;
}

type SessionListener = () => void;

/**
 * Holds the most recently published DiscussModal session. Disposal is
 * token-checked so a closing instance cannot clear a newer one.
 */
export class DiscussModalSessionStore {
  private entry: { token: symbol; session: DiscussModalSession } | null = null;
  private readonly listeners = new Set<SessionListener>();

  current(): DiscussModalSession | null {
    return this.entry?.session ?? null;
  }

  /** Publishes a session snapshot; returns a disposer for this owner token. */
  publish(token: symbol, session: DiscussModalSession): () => void {
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
