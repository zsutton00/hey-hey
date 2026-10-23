import type { AgentOperationSnapshot } from "./agentOperationReducer";

export interface AgentLaunchScope {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
}

export type AgentLaunchProgress =
  | {
      phase: "preparing" | "dispatching";
      startedAt: string;
      operation: AgentOperationSnapshot | null;
    }
  | {
      phase: "accepted";
      startedAt: string;
      operation: AgentOperationSnapshot | null;
      runtimeObserved: boolean;
    }
  | {
      phase: "failed";
      startedAt: string;
      operation: AgentOperationSnapshot | null;
      error: string;
    };

const keyFor = (scope: AgentLaunchScope) =>
  JSON.stringify([
    scope.organizationId,
    scope.projectId,
    scope.agentSessionId,
    scope.conversationId,
  ]);

/** Preparation and handoff evidence survive route subscribers, never replace runtime state. */
export class AgentLaunchStore {
  private readonly records = new Map<string, AgentLaunchProgress>();
  private readonly runtimeObserved = new Set<string>();
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get(scope: AgentLaunchScope): AgentLaunchProgress | null {
    return this.records.get(keyFor(scope)) ?? null;
  }
  private set(scope: AgentLaunchScope, progress: AgentLaunchProgress) {
    this.records.set(keyFor(scope), progress);
    this.listeners.forEach((listener) => listener());
  }
  clear(scope: AgentLaunchScope) {
    this.records.delete(keyFor(scope));
    this.runtimeObserved.delete(keyFor(scope));
    this.listeners.forEach((listener) => listener());
  }
  async prepare(
    scope: AgentLaunchScope,
    work: () => Promise<void>
  ): Promise<void> {
    const current = this.get(scope);
    if (current && current.phase !== "failed") return;
    this.runtimeObserved.delete(keyFor(scope));
    this.set(scope, {
      phase: "preparing",
      startedAt: new Date().toISOString(),
      operation: null,
    });
    try {
      await work();
      const latest = this.get(scope);
      if (latest && latest.phase !== "accepted") {
        this.set(scope, {
          ...latest,
          phase: "accepted",
          runtimeObserved: this.runtimeObserved.has(keyFor(scope)),
        });
      }
    } catch (cause) {
      const latest = this.get(scope);
      this.set(scope, {
        phase: "failed",
        startedAt: latest?.startedAt ?? new Date().toISOString(),
        operation: latest?.operation ?? null,
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to start generation. Please retry.",
      });
    }
  }
  dispatching(scope: AgentLaunchScope) {
    const current = this.get(scope);
    const continuing =
      current?.phase === "preparing" || current?.phase === "dispatching";
    if (!continuing) this.runtimeObserved.delete(keyFor(scope));
    this.set(scope, {
      phase: "dispatching",
      startedAt: continuing ? current.startedAt : new Date().toISOString(),
      operation: null,
    });
  }
  record(scope: AgentLaunchScope, operation: AgentOperationSnapshot) {
    const current = this.get(scope);
    if (
      current?.operation &&
      current.operation.operationId !== operation.operationId
    )
      return;
    const base = {
      startedAt: current?.startedAt ?? new Date().toISOString(),
      operation,
    };
    switch (operation.state) {
      case "succeeded":
        this.set(scope, {
          ...base,
          phase: "accepted",
          runtimeObserved: this.runtimeObserved.has(keyFor(scope)),
        });
        break;
      case "failed":
      case "denied":
        this.set(scope, { ...base, phase: "failed", error: operation.message });
        break;
      case "cancelled":
        this.set(scope, {
          ...base,
          phase: "failed",
          error: "Launch cancelled. You can retry when ready.",
        });
        break;
      default:
        this.set(scope, { ...base, phase: "dispatching" });
    }
  }
  observeRuntime(scope: AgentLaunchScope) {
    if (!this.get(scope)) return;
    this.runtimeObserved.add(keyFor(scope));
    const current = this.get(scope);
    if (current?.phase === "accepted" && !current.runtimeObserved) {
      this.set(scope, { ...current, runtimeObserved: true });
    }
  }
}
