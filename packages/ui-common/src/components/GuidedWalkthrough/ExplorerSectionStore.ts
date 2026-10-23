/** Live section state is published only by rendered Explorer owners. */
export class ExplorerSectionStore {
  private entries = new Map<string, { token: symbol; expanded: boolean }>();
  private listeners = new Set<() => void>();

  current = (key: string): boolean | null =>
    this.entries.get(key)?.expanded ?? null;

  publish(key: string, token: symbol, expanded: boolean): () => void {
    this.entries.set(key, { token, expanded });
    this.notify();
    return () => {
      if (this.entries.get(key)?.token !== token) return;
      this.entries.delete(key);
      this.notify();
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
