import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionCurrentState,
  AgentSessionOutputAttentionState,
  type AgentSessionContextSize,
} from "../../../api";
import { dataClient } from "../../../clients";
import {
  useAgentSessionCurrentState,
  useAgentSessionCurrentStates,
} from "../../hooks/useAgentSessionCurrentState";
import {
  useAcknowledgeAgentSessionOutputAttention,
  useAgentSessionOutputAttentions,
} from "../../hooks/useAgentSessionOutputAttention";
import { useSessionContextSize } from "../../hooks/useSessionContextSize";
import { agentSessionKeys } from "../agentSessions";
import {
  createAgentSessionCurrentStateCoordinator,
  createAgentSessionOutputAttentionCoordinator,
  fetchAgentSessionCurrentStateBatch,
  normalizeAgentSessionIds,
  pickNewerContextSize,
  pickNewerRevision,
  writeAgentSessionContextSize,
  writeAgentSessionCurrentState,
  writeAgentSessionOutputAttention,
} from "../agentSessionLiveState";

const CURRENT_STATE_URL =
  "/organizations/org-1/projects/project-1/agent-sessions/current-state:batch";
const OUTPUT_ATTENTION_URL =
  "/organizations/org-1/projects/project-1/agent-sessions/output-attention:batch";

const stateEntry = (
  agentSessionId: string,
  revision = 1,
  currentState: AgentSessionCurrentState = AgentSessionCurrentState.Thinking
) => ({
  agentSessionId,
  currentState,
  revision,
  transitionedAt: `2026-08-07T00:00:0${revision}.000Z`,
});

const attentionEntry = (
  agentSessionId: string,
  revision = 1,
  state: AgentSessionOutputAttentionState = AgentSessionOutputAttentionState.MessageReady
) => ({
  agentSessionId,
  state,
  revision,
  changedAt: `2026-08-07T00:00:0${revision}.000Z`,
});

const reading = (
  overrides: Partial<AgentSessionContextSize> = {}
): AgentSessionContextSize => ({
  totalTokens: 100_000,
  runId: "run-1",
  providerSessionId: "provider-1",
  observedAt: "2026-10-04T00:00:01.000Z",
  ...overrides,
});

const itemsResponse = (items: unknown[]) => ({ data: { data: { items } } });

const testClock = {
  now: () => Date.now(),
  setTimeout: (callback: () => void, delay: number) =>
    setTimeout(callback, delay),
  random: () => 0.5,
};

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

/** Answers each batch read with an entry per requested id. */
const answerBatches = (requestSpy: ReturnType<typeof vi.spyOn>) =>
  requestSpy.mockImplementation(async (config: unknown) => {
    const { url, data } = config as {
      url: string;
      data: { agentSessionIds: string[] };
    };
    const ids = data.agentSessionIds;
    return url === OUTPUT_ATTENTION_URL
      ? itemsResponse(ids.map((id) => attentionEntry(id)))
      : itemsResponse(ids.map((id) => stateEntry(id)));
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("newer-value rules", () => {
  it("keeps the current revisioned value unless the incoming one is newer", () => {
    const current = stateEntry("session-1", 3);
    expect(pickNewerRevision(current, stateEntry("session-1", 2))).toBe(
      current
    );
    expect(pickNewerRevision(current, stateEntry("session-1", 3))).toBe(
      current
    );
    const newer = stateEntry("session-1", 5);
    expect(pickNewerRevision(current, newer)).toBe(newer);
    expect(pickNewerRevision(null, newer)).toBe(newer);
  });

  it("picks the context-size reading observed later", () => {
    const seed = reading();
    const live = reading({ observedAt: "2026-10-04T00:00:02.000Z" });
    expect(pickNewerContextSize(seed, live)).toBe(live);
    expect(pickNewerContextSize(live, seed)).toBe(live);
    expect(pickNewerContextSize(null, live)).toBe(live);
    expect(pickNewerContextSize(seed, undefined)).toBe(seed);
    expect(pickNewerContextSize(null, undefined)).toBeUndefined();
  });

  it("writes realtime values into per-session keys only when newer", () => {
    const client = createClient();
    const currentStateKey = agentSessionKeys.currentState(
      "org-1",
      "project-1",
      "session-1"
    );
    writeAgentSessionCurrentState(client, "org-1", "project-1", stateEntry("session-1", 3));
    writeAgentSessionCurrentState(
      client,
      "org-1",
      "project-1",
      stateEntry("session-1", 2, AgentSessionCurrentState.Idle)
    );
    expect(client.getQueryData(currentStateKey)).toEqual({
      currentState: AgentSessionCurrentState.Thinking,
      revision: 3,
      transitionedAt: "2026-08-07T00:00:03.000Z",
    });

    const attentionKey = agentSessionKeys.outputAttention(
      "org-1",
      "project-1",
      "session-1"
    );
    writeAgentSessionOutputAttention(client, "org-1", "project-1", attentionEntry("session-1", 4));
    writeAgentSessionOutputAttention(
      client,
      "org-1",
      "project-1",
      attentionEntry("session-1", 4, AgentSessionOutputAttentionState.None)
    );
    expect(client.getQueryData(attentionKey)).toMatchObject({
      state: AgentSessionOutputAttentionState.MessageReady,
      revision: 4,
    });

    const sizeKey = agentSessionKeys.contextSize("org-1", "project-1", "session-1");
    const later = reading({ totalTokens: 2, observedAt: "2026-10-04T00:00:05.000Z" });
    writeAgentSessionContextSize(client, "org-1", "project-1", "session-1", later);
    writeAgentSessionContextSize(client, "org-1", "project-1", "session-1", reading());
    expect(client.getQueryData(sizeKey)).toBe(later);
  });
});

describe("batch reads", () => {
  it("normalizes ids and reads the standard response envelope", async () => {
    expect(normalizeAgentSessionIds([" a ", "b", "a", ""])).toEqual(["a", "b"]);
    const requestSpy = vi
      .spyOn(dataClient, "request")
      .mockResolvedValue(itemsResponse([stateEntry("session-1")]) as never);

    await expect(
      fetchAgentSessionCurrentStateBatch("org-1", "project-1", ["session-1"])
    ).resolves.toEqual([stateEntry("session-1")]);
    expect(requestSpy).toHaveBeenCalledWith({
      method: "POST",
      url: CURRENT_STATE_URL,
      data: { agentSessionIds: ["session-1"] },
    });
  });

  it("does not start work for an empty identity set", async () => {
    vi.useFakeTimers();
    const requestSpy = vi.spyOn(dataClient, "request");
    const coordinator = createAgentSessionCurrentStateCoordinator(
      createClient(),
      testClock
    );

    await expect(
      coordinator.request({
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionIds: ["", "   "],
      })
    ).resolves.toBeUndefined();
    await vi.runOnlyPendingTimersAsync();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous unordered demand into one project batch", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const coordinator = createAgentSessionCurrentStateCoordinator(client, testClock);
    const requestSpy = vi
      .spyOn(dataClient, "request")
      .mockResolvedValue(
        itemsResponse([stateEntry("session-1"), stateEntry("session-2")]) as never
      );

    const first = coordinator.request({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionIds: ["session-2", "session-1", "session-2"],
    });
    const second = coordinator.request({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionIds: ["session-1", "session-2"],
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(requestSpy).toHaveBeenCalledOnce();
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { agentSessionIds: ["session-2", "session-1"] },
      })
    );
    expect(
      client.getQueryData(
        agentSessionKeys.currentState("org-1", "project-1", "session-2")
      )
    ).toMatchObject({ revision: 1 });
  });

  it("keeps one active request and delays the trailing batch for one second", async () => {
    vi.useFakeTimers();
    const coordinator = createAgentSessionCurrentStateCoordinator(
      createClient(),
      testClock
    );
    let resolveFirst: (value: never) => void = () => undefined;
    const requestSpy = vi
      .spyOn(dataClient, "request")
      .mockImplementationOnce(
        () =>
          new Promise<never>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(itemsResponse([stateEntry("session-2")]) as never);

    const first = coordinator.request({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionIds: ["session-1"],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(requestSpy).toHaveBeenCalledOnce();

    const trailing = coordinator.request({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionIds: ["session-2"],
    });
    resolveFirst(itemsResponse([stateEntry("session-1")]) as never);

    await vi.advanceTimersByTimeAsync(999);
    expect(requestSpy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all([first, trailing])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it("shares Retry-After and exponential cooldowns across consecutive rate limits", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const coordinator = createAgentSessionCurrentStateCoordinator(client, testClock);
    const requestSpy = vi
      .spyOn(dataClient, "request")
      .mockRejectedValueOnce({
        response: { status: 429, headers: { "retry-after": "1" } },
      })
      .mockRejectedValueOnce({ response: { status: 429, headers: {} } })
      .mockResolvedValueOnce(itemsResponse([stateEntry("session-1")]) as never);

    const hydration = coordinator.request({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionIds: ["session-1"],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(requestSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(999);
    expect(requestSpy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(requestSpy).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(requestSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(hydration).resolves.toBeUndefined();
    expect(requestSpy).toHaveBeenCalledTimes(3);
    expect(
      client.getQueryData(
        agentSessionKeys.currentState("org-1", "project-1", "session-1")
      )
    ).toEqual({
      currentState: AgentSessionCurrentState.Thinking,
      revision: 1,
      transitionedAt: "2026-08-07T00:00:01.000Z",
    });
  });

  it.each([
    ["current state", createAgentSessionCurrentStateCoordinator, stateEntry, agentSessionKeys.currentState],
    ["output attention", createAgentSessionOutputAttentionCoordinator, attentionEntry, agentSessionKeys.outputAttention],
  ] as const)("isolates failed %s batches from independent queued reads", async (
    _dataset, createCoordinator, entry, key
  ) => {
    vi.useFakeTimers();
    const client = createClient();
    const coordinator = createCoordinator(client, testClock);
    const failure = { response: { status: 403 } };
    let rejectFirst: (error: unknown) => void = () => undefined;
    const requestSpy = vi.spyOn(dataClient, "request")
      .mockImplementationOnce(() => new Promise<never>((_resolve, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValueOnce(itemsResponse([entry("session-2")]) as never);
    const scope = { organizationId: "org-1", projectId: "project-1" };
    const first = coordinator.request({ ...scope, agentSessionIds: ["session-1"] });
    const firstRejected = expect(first).rejects.toEqual(failure);
    // A caller requiring the failed ID must reject, even when it also needs B.
    const overlapping = coordinator.request({ ...scope, agentSessionIds: ["session-1", "session-2"] });
    const overlappingRejected = expect(overlapping).rejects.toEqual(failure);
    await vi.advanceTimersByTimeAsync(0);
    let independentSettled = false;
    const independent = coordinator.request({ ...scope, agentSessionIds: ["session-2"] });
    const independentOutcome = independent.then(
      () => { independentSettled = true; return "resolved"; },
      () => { independentSettled = true; return "rejected"; }
    );
    rejectFirst(failure);
    await vi.advanceTimersByTimeAsync(999);
    await Promise.all([firstRejected, overlappingRejected]);
    expect(independentSettled).toBe(false);
    expect(requestSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await expect(independentOutcome).resolves.toBe("resolved");
    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(requestSpy.mock.calls[1]?.[0]).toMatchObject({
      data: { agentSessionIds: ["session-2"] },
    });
    expect(client.getQueryData(key("org-1", "project-1", "session-2")))
      .toMatchObject({ revision: 1 });
    client.clear();
  });

  it("rejects waiting reads on a non-rate-limit failure", async () => {
    vi.useFakeTimers();
    const coordinator = createAgentSessionCurrentStateCoordinator(
      createClient(),
      testClock
    );
    vi.spyOn(dataClient, "request").mockRejectedValueOnce({
      response: { status: 500 },
    });
    const hydration = coordinator.request({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionIds: ["session-1"],
    });
    const rejected = expect(hydration).rejects.toEqual({
      response: { status: 500 },
    });
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
  });
});

describe("live-state hooks", () => {
  let requestSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    requestSpy = vi.spyOn(dataClient, "request");
    answerBatches(requestSpy);
  });

  it("serves every consumer of a session from one batch read, including remounts", async () => {
    const client = createClient();
    const { result, unmount } = renderHook(
      () => ({
        single: useAgentSessionCurrentState("org-1", "project-1", "session-1"),
        list: useAgentSessionCurrentStates("org-1", "project-1", [
          "session-2",
          "session-1",
        ]),
        attention: useAgentSessionOutputAttentions("org-1", "project-1", [
          "session-1",
          "session-2",
        ]),
        moreAttention: useAgentSessionOutputAttentions("org-1", "project-1", [
          "session-2",
        ]),
      }),
      { wrapper: wrapperFor(client) }
    );

    await waitFor(() => {
      expect(result.current.single.currentState).toBe(
        AgentSessionCurrentState.Thinking
      );
      expect(Object.keys(result.current.list.currentStateById)).toEqual([
        "session-2",
        "session-1",
      ]);
      expect(Object.keys(result.current.attention)).toHaveLength(2);
    });
    const urls = requestSpy.mock.calls.map(
      ([config]) => (config as { url: string }).url
    );
    expect(urls.filter((url) => url === CURRENT_STATE_URL)).toHaveLength(1);
    expect(urls.filter((url) => url === OUTPUT_ATTENTION_URL)).toHaveLength(1);

    unmount();
    renderHook(
      () => useAgentSessionCurrentState("org-1", "project-1", "session-1"),
      { wrapper: wrapperFor(client) }
    );
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it("settles a large session list without per-result work growing with the list", async () => {
    // Pacing runs on fake time so the measurement is main-thread work only.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const ids = Array.from({ length: 400 }, (_, index) => `session-${index}`);
    const { result } = renderHook(
      () => ({
        states: useAgentSessionCurrentStates("org-1", "project-1", ids),
        attention: useAgentSessionOutputAttentions("org-1", "project-1", ids),
      }),
      { wrapper: wrapperFor(createClient()) }
    );
    const started = performance.now();
    for (let batch = 0; batch < 4; batch += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    expect(Object.keys(result.current.states.currentStateById)).toHaveLength(400);
    expect(Object.keys(result.current.attention)).toHaveLength(400);
    // Untracked results settle in about half a second; tracked ones took 4 s.
    expect(performance.now() - started).toBeLessThan(1_500);
    // 400 ids fit in four 100-id batches per dataset.
    expect(requestSpy).toHaveBeenCalledTimes(8);
  });

  it("falls back to the canonical state when no live revision exists", async () => {
    requestSpy.mockResolvedValue(itemsResponse([]) as never);
    const { result } = renderHook(
      () =>
        useAgentSessionCurrentState("org-1", "project-1", "session-1", {
          canonicalCurrentState: AgentSessionCurrentState.AwaitingApproval,
        }),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.currentState).toBe(
      AgentSessionCurrentState.AwaitingApproval
    );
    expect(result.current.revision).toBeUndefined();
  });

  it("applies realtime writes without a read and ignores older revisions", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => useAgentSessionCurrentState("org-1", "project-1", "session-1"),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(result.current.revision).toBe(1));

    act(() =>
      writeAgentSessionCurrentState(
        client,
        "org-1",
        "project-1",
        stateEntry("session-1", 4, AgentSessionCurrentState.Writing)
      )
    );
    await waitFor(() =>
      expect(result.current.currentState).toBe(AgentSessionCurrentState.Writing)
    );
    act(() =>
      writeAgentSessionCurrentState(
        client,
        "org-1",
        "project-1",
        stateEntry("session-1", 3, AgentSessionCurrentState.Idle)
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.currentState).toBe(AgentSessionCurrentState.Writing);
    expect(requestSpy).toHaveBeenCalledOnce();
  });

  it("acknowledges explicitly and writes the returned entry into the cache", async () => {
    const client = createClient();
    requestSpy.mockImplementation(async (config: unknown) => {
      const { url } = config as { url: string };
      return url.endsWith("output-attention:acknowledge")
        ? {
            data: {
              data: attentionEntry(
                "session-1",
                2,
                AgentSessionOutputAttentionState.None
              ),
            },
          }
        : itemsResponse([attentionEntry("session-1")]);
    });
    const { result } = renderHook(
      () => ({
        attention: useAgentSessionOutputAttentions("org-1", "project-1", [
          "session-1",
        ]),
        acknowledge: useAcknowledgeAgentSessionOutputAttention(
          "org-1",
          "project-1",
          "session-1"
        ),
      }),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() =>
      expect(result.current.attention["session-1"]?.state).toBe(
        AgentSessionOutputAttentionState.MessageReady
      )
    );
    // Reading alone never acknowledges.
    expect(
      requestSpy.mock.calls.some(([config]) =>
        (config as { url: string }).url.endsWith(":acknowledge")
      )
    ).toBe(false);

    await act(async () => result.current.acknowledge());
    await waitFor(() =>
      expect(result.current.attention["session-1"]).toEqual({
        state: AgentSessionOutputAttentionState.None,
        revision: 2,
        changedAt: "2026-08-07T00:00:02.000Z",
      })
    );
  });

  it("overlays a newer live context size on the seeded reading", async () => {
    const client = createClient();
    const { result } = renderHook(
      ({ latest }: { latest: string }) =>
        useSessionContextSize({
          organizationId: "org-1",
          projectId: "project-1",
          agentSessionId: "session-1",
          seed: reading({ maxTokens: 258_000 }),
          latestProviderSessionId: latest,
        }),
      { wrapper: wrapperFor(client), initialProps: { latest: "provider-1" } }
    );
    expect(result.current).toEqual({ totalTokens: 100_000, maxTokens: 258_000 });

    act(() =>
      writeAgentSessionContextSize(
        client,
        "org-1",
        "project-1",
        "session-1",
        reading({
          totalTokens: 120_000,
          maxTokens: null,
          observedAt: "2026-10-04T00:00:02.000Z",
        })
      )
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        totalTokens: 120_000,
        maxTokens: undefined,
      })
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("drops a reading for a provider session other than the latest", () => {
    const { result } = renderHook(
      () =>
        useSessionContextSize({
          organizationId: "org-1",
          projectId: "project-1",
          agentSessionId: "session-1",
          seed: reading(),
          latestProviderSessionId: "provider-2",
        }),
      { wrapper: wrapperFor(createClient()) }
    );
    expect(result.current).toBeUndefined();
  });
});
