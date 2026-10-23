import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliReadRunContextUsageResult } from "../../../../api";
import {
  RunContextUsageCache,
  runContextUsageKey,
} from "../RunContextUsageCache";

const auth = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock("../../../../services/authService", () => ({
  onAuthChange: (callback: () => void) => {
    auth.listeners.add(callback);
    return () => auth.listeners.delete(callback);
  },
}));

const identity = {
  organizationId: "org",
  projectId: "project",
  agentSessionId: "agent",
  runId: "run",
  providerSessionId: "selected",
};
const result = (amountUsd = 1): CliReadRunContextUsageResult => ({
  runId: "run",
  providerSessionId: "selected",
  contextData: {
    model: "fixture",
    categories: [],
    totalTokens: 10,
    maxTokens: 100,
    rawMaxTokens: 100,
    percentage: 10,
    gridRows: [],
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: false,
    apiUsage: null,
  },
  cost: { state: "available", amountUsd, currency: "USD", source: "ccusage" },
});
const caches: RunContextUsageCache[] = [];
const createCache = () => {
  const cache = new RunContextUsageCache();
  caches.push(cache);
  return cache;
};
afterEach(() => {
  caches.splice(0).forEach((cache) => cache.dispose());
  vi.useRealTimers();
});

describe("RunContextUsageCache", () => {
  it("retains independent observation times, including zero, across unavailable cost and failed reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const cache = createCache();
    const key = runContextUsageKey(identity);
    await cache.refresh(identity, async () => ({ data: result(0) }));
    vi.setSystemTime(2000);
    await cache.refresh(identity, async () => ({
      data: {
        ...result(),
        cost: { state: "unavailable", reason: "cost_source_unavailable" },
      },
    }));
    expect(cache.getSnapshot(key)).toMatchObject({
      contextReceivedAt: 2000,
      costReceivedAt: 1000,
      lastSuccessfulCost: { amountUsd: 0 },
      data: { cost: { state: "unavailable" } },
    });
    await cache.refresh(identity, async () => ({
      error: "timeout",
      errorCode: "TIMEOUT",
    }));
    expect(cache.getSnapshot(key)).toMatchObject({
      status: "unavailable",
      errorCode: "TIMEOUT",
      contextReceivedAt: 2000,
      costReceivedAt: 1000,
      lastSuccessfulCost: { amountUsd: 0 },
    });
    await cache.refresh(identity, async () => ({ data: result(3) }));
    expect(cache.getSnapshot(key)).toMatchObject({
      status: "success",
      error: null,
      costReceivedAt: 2000,
      lastSuccessfulCost: { amountUsd: 3 },
    });
  });

  it("shares pending work and preserves data before refresh completes", async () => {
    const cache = createCache();
    await cache.refresh(identity, async () => ({ data: result() }));
    let resolve!: (value: { data: CliReadRunContextUsageResult }) => void;
    const read = vi.fn(
      () =>
        new Promise<{ data: CliReadRunContextUsageResult }>((done) => {
          resolve = done;
        })
    );
    const first = cache.refresh(identity, read);
    expect(cache.refresh(identity, read)).toBe(first);
    expect(cache.getSnapshot(runContextUsageKey(identity))).toMatchObject({
      status: "loading",
      data: result(),
    });
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    resolve({ data: result(2) });
    await first;
  });

  it.each([
    "organizationId",
    "projectId",
    "agentSessionId",
    "runId",
    "providerSessionId",
  ] as const)("isolates %s", async (field) => {
    const cache = createCache();
    await cache.refresh(identity, async () => ({ data: result() }));
    expect(
      cache.getSnapshot(
        runContextUsageKey({ ...identity, [field]: "different" })
      ).data
    ).toBeNull();
  });

  it("rejects mismatched host identity and never fabricates an unavailable cost", async () => {
    const cache = createCache();
    await cache.refresh(identity, async () => ({
      data: { ...result(), providerSessionId: "other" },
    }));
    expect(cache.getSnapshot(runContextUsageKey(identity))).toMatchObject({
      status: "unavailable",
      data: null,
    });
    await cache.refresh(identity, async () => ({
      data: {
        ...result(),
        cost: { state: "unavailable", reason: "session_not_found" },
      },
    }));
    expect(cache.getSnapshot(runContextUsageKey(identity))).toMatchObject({
      lastSuccessfulCost: null,
      costReceivedAt: null,
      data: { cost: { reason: "session_not_found" } },
    });
  });

  it("clears while unsubscribed and prevents old authentication completions from repopulating or removing new pending reads", async () => {
    const cache = createCache();
    await cache.refresh(identity, async () => ({ data: result() }));
    let resolveOld!: (value: { data: CliReadRunContextUsageResult }) => void;
    const old = cache.refresh(
      identity,
      () =>
        new Promise((done) => {
          resolveOld = done;
        })
    );
    await Promise.resolve();
    auth.listeners.forEach((listener) => listener());
    expect(cache.getSnapshot(runContextUsageKey(identity)).data).toBeNull();
    let resolveNew!: (value: { data: CliReadRunContextUsageResult }) => void;
    const next = cache.refresh(
      identity,
      () =>
        new Promise((done) => {
          resolveNew = done;
        })
    );
    await Promise.resolve();
    resolveOld({ data: result(9) });
    await old;
    expect(cache.getSnapshot(runContextUsageKey(identity))).toMatchObject({
      status: "loading",
      data: null,
    });
    expect(cache.refresh(identity, async () => ({ data: result(8) }))).toBe(
      next
    );
    resolveNew({ data: result(2) });
    await next;
    expect(
      cache.getSnapshot(runContextUsageKey(identity)).lastSuccessfulCost
        ?.amountUsd
    ).toBe(2);
  });
});
