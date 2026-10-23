import { onAuthChange } from "../../../services/authService";
import { log } from "../../../utils/logger";
import {
  idleRunContextUsageState,
  receiveRunContextUsage,
  type RunContextUsageOutcome,
  type RunContextUsageState,
} from "./runContextUsageState";

export interface RunContextUsageIdentity {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string;
  providerSessionId: string;
}

export const runContextUsageKey = (identity: RunContextUsageIdentity): string =>
  JSON.stringify([
    identity.organizationId,
    identity.projectId,
    identity.agentSessionId,
    identity.runId,
    identity.providerSessionId,
  ]);

/** Lifetime is independent of modal subscriptions, including authentication resets. */
export class RunContextUsageCache {
  private readonly entries = new Map<string, RunContextUsageState>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private readonly unsubscribeAuth: () => void;

  public constructor() {
    this.unsubscribeAuth = onAuthChange(this.clear);
  }

  public readonly getGeneration = (): number => this.generation;
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot(key: string | null): RunContextUsageState {
    return key === null
      ? idleRunContextUsageState
      : this.entries.get(key) ?? idleRunContextUsageState;
  }

  public readonly clear = (): void => {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
    this.emit();
  };

  public dispose(): void {
    this.unsubscribeAuth();
    this.clear();
    this.listeners.clear();
  }

  public refresh(
    identity: RunContextUsageIdentity,
    read: () => Promise<RunContextUsageOutcome>
  ): Promise<void> {
    const key = runContextUsageKey(identity);
    const existing = this.pending.get(key);
    if (existing) {
      log.debug("data_hooks", "Context refresh coalesced");
      return existing;
    }
    const previous = this.getSnapshot(key);
    if (previous.data)
      log.debug("data_hooks", "Context retained reading cache hit");
    const generation = this.generation;
    const startedAt = Date.now();
    log.debug("data_hooks", "Context refresh started");
    this.entries.set(key, {
      ...previous,
      status: "loading",
      error: null,
      errorCode: null,
    });
    // Defer invocation until pending ownership is registered, including synchronous subscribers.
    const request = Promise.resolve()
      .then((): Promise<RunContextUsageOutcome> | RunContextUsageOutcome => {
        if (this.generation !== generation)
          return { error: "Authentication changed.", errorCode: null };
        return this.readSelected(identity, read);
      })
      .then((outcome) => {
        if (this.generation !== generation) return;
        this.entries.set(
          key,
          receiveRunContextUsage(previous, outcome, Date.now())
        );
        log.debug("data_hooks", "Context refresh finished", {
          outcome: "error" in outcome ? "failed" : "success",
          durationMs: Date.now() - startedAt,
        });
      })
      .finally(() => {
        if (this.generation !== generation) return;
        this.pending.delete(key);
        this.emit();
      });
    this.pending.set(key, request);
    this.emit();
    return request;
  }

  private async readSelected(
    identity: RunContextUsageIdentity,
    read: () => Promise<RunContextUsageOutcome>
  ): Promise<RunContextUsageOutcome> {
    try {
      const outcome = await read();
      if (
        "data" in outcome &&
        (outcome.data.runId !== identity.runId ||
          outcome.data.providerSessionId !== identity.providerSessionId)
      ) {
        return {
          error:
            "The connected computer returned a different Run or provider session.",
          errorCode: null,
        };
      }
      return outcome;
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "The protected context read failed.",
        errorCode: null,
      };
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const runContextUsageCache = new RunContextUsageCache();
