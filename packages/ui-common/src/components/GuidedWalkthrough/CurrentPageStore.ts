import type { GuidableEntity } from "./types";

type PageListener = () => void;

/**
 * The entity whose canonical page is showing, as forwarded by the canonical
 * page observer. Disposal is token-checked so a remounting observer cannot
 * clear the page its successor published.
 */
export class CurrentPageStore {
  private entry: { token: symbol; entity: GuidableEntity | null } | null =
    null;
  private readonly listeners = new Set<PageListener>();

  current(): GuidableEntity | null {
    return this.entry?.entity ?? null;
  }

  publish(token: symbol, entity: GuidableEntity | null): () => void {
    this.entry = { token, entity };
    this.notify();
    return () => {
      if (this.entry?.token !== token) return;
      this.entry = null;
      this.notify();
    };
  }

  subscribe(listener: PageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
