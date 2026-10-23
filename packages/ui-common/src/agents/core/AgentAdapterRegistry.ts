import type { AgentAdapter } from "./AgentAdapter";

export type AgentAdapterId = string;

export type AgentAdapterFactory = () => AgentAdapter;

export class AgentAdapterRegistry {
  private readonly factories = new Map<AgentAdapterId, AgentAdapterFactory>();

  register(id: AgentAdapterId, factory: AgentAdapterFactory): void {
    this.factories.set(id, factory);
  }

  has(id: AgentAdapterId): boolean {
    return this.factories.has(id);
  }

  list(): AgentAdapterId[] {
    return Array.from(this.factories.keys());
  }

  create(id: AgentAdapterId): AgentAdapter {
    const factory = this.factories.get(id);
    if (!factory) {
      const available = this.list().join(", ") || "none";
      throw new Error(`Unknown agent adapter: ${id}. Available: ${available}`);
    }

    return factory();
  }
}

export const agentAdapterRegistry = new AgentAdapterRegistry();
