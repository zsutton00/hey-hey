import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInitiatorStack, resolveInitiator } from "../resolveInitiator";

const bundle = (name: string) => `${window.location.origin}/assets/${name}.js`;
const stack = (name: string) => `Error
    at wve (${bundle(name)}:9:34320)
    at An (${bundle(name)}:36:161717)
    at Cr (${bundle(name)}:36:166661)
    at njt (${bundle(name)}:4253:5430)`;

// The reported staging positions, mapped to core, hook, and component sources.
const map = {
  version: 3,
  sources: [
    "../../ui-common/src/data/core/initiatorContext.ts",
    "../../ui-common/src/data/hooks/useWorkItem.ts",
    "../../ui-common/src/components/AgentSession/EntityConversationChat.tsx",
  ],
  names: [],
  mappings:
    ";".repeat(8) +
    "AAAA" +
    ";".repeat(27) +
    "ACAA" +
    ";".repeat(4217) +
    "AC6QA",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("request initiator source resolution", () => {
  it("resolves the reported minified stack and shares one map read across concurrent requests", async () => {
    const fetchMap = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(map)));
    vi.stubGlobal("fetch", fetchMap);
    const results = await Promise.all([
      resolveInitiator(stack("mapped")),
      resolveInitiator(stack("mapped")),
    ]);
    expect(results).toEqual([
      "src/components/AgentSession/EntityConversationChat.tsx:270:1",
      "src/components/AgentSession/EntityConversationChat.tsx:270:1",
    ]);
    expect(fetchMap).toHaveBeenCalledTimes(1);
    expect(fetchMap).toHaveBeenCalledWith(
      `${bundle("mapped")}.map`,
      expect.objectContaining({ credentials: "omit" })
    );
  });

  it("keeps direct source frames, including packaged UI Common components", async () => {
    const fetchMap = vi.fn();
    vi.stubGlobal("fetch", fetchMap);
    expect(
      await resolveInitiator(
        `Error\n at hook (http://localhost/src/data/hooks/useWorkItem.ts:59:16)\n at View (http://localhost/node_modules/@hey-hey/ui-common/src/components/View.tsx?t=123:270:7)`
      )
    ).toBe("src/components/View.tsx:270:7");
    expect(fetchMap).not.toHaveBeenCalled();
  });

  it("parses Firefox frames and TypeScript callers without a component", async () => {
    expect(
      parseInitiatorStack("load@http://localhost/src/load.ts:20:8")
    ).toEqual([
      { source: "http://localhost/src/load.ts", line: 20, column: 8 },
    ]);
    expect(
      await resolveInitiator("load@http://localhost/src/load.ts:20:8")
    ).toBe("src/load.ts:20:8");
  });

  it.each([404, 500])(
    "retains an explicitly unmapped position on HTTP %s and caches failures",
    async (status) => {
      const fetchMap = vi
        .fn()
        .mockResolvedValue(new Response("unavailable", { status }));
      vi.stubGlobal("fetch", fetchMap);
      for (let i = 0; i < 2; i++) {
        expect(await resolveInitiator(stack(`missing-${status}`))).toBe(
          `unmapped:missing-${status}.js:9:34320`
        );
      }
      expect(fetchMap).toHaveBeenCalledTimes(1);
    }
  );

  it("does not fail API requests when the map is HTML or malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>SPA fallback</html>"))
    );
    expect(await resolveInitiator(stack("html"))).toBe(
      "unmapped:html.js:9:34320"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"version":3}'))
    );
    expect(await resolveInitiator(stack("invalid"))).toBe(
      "unmapped:invalid.js:9:34320"
    );
  });

  it("bounds map loading and does not fetch cross-origin frames", async () => {
    vi.useFakeTimers();
    const fetchMap = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new Error("Aborted"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMap);
    const pending = resolveInitiator(stack("timeout"));
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe("unmapped:timeout.js:9:34320");
    expect(
      await resolveInitiator(
        "Error\n at remote (https://other.example/assets/app.js:1:2)"
      )
    ).toBe("unmapped:app.js:1:2");
    expect(fetchMap).toHaveBeenCalledTimes(1);
  });
});
