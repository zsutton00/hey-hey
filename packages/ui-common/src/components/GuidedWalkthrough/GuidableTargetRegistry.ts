import { serializeTargetAddress, type GuidableTargetAddress } from "./types";

export type TargetElementGetter = () => HTMLElement | null;

interface Registration {
  token: symbol;
  getElement: TargetElementGetter;
}

type TargetListener = () => void;

/**
 * Maps target addresses to the component currently owning them. The latest
 * registration for an address wins; disposal is token-checked so a stale
 * unmount cannot remove a newer owner's registration.
 */
export class GuidableTargetRegistry {
  private readonly registrations = new Map<string, Registration>();
  private readonly listeners = new Map<string, Set<TargetListener>>();

  register(
    address: GuidableTargetAddress,
    getElement: TargetElementGetter
  ): () => void {
    const key = serializeTargetAddress(address);
    const token = Symbol(key);
    this.registrations.set(key, { token, getElement });
    this.notify(key);

    return () => {
      if (this.registrations.get(key)?.token !== token) return;
      this.registrations.delete(key);
      this.notify(key);
    };
  }

  /** Returns the mounted element for the address, or null. */
  lookup(address: GuidableTargetAddress): HTMLElement | null {
    const element =
      this.registrations.get(serializeTargetAddress(address))?.getElement() ??
      null;
    return element?.isConnected ? element : null;
  }

  /** Scrolls the target into view; returns the element when one is mounted. */
  reveal(address: GuidableTargetAddress): HTMLElement | null {
    const element = this.lookup(address);
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return element;
  }

  /** Notifies when the address gains or loses its registration. */
  subscribe(
    address: GuidableTargetAddress,
    listener: TargetListener
  ): () => void {
    const key = serializeTargetAddress(address);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(key);
    };
  }

  private notify(key: string): void {
    const set = this.listeners.get(key);
    if (!set) return;
    for (const listener of [...set]) listener();
  }
}
