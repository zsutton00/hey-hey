import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useRef, useState } from "react";
import type { CliReadToolCall } from "../../src/api";
import { LatestTurnToolCalls } from "../../src/components/LlmForms/Registry/LatestTurnToolCalls";

const call = (index: number): CliReadToolCall => ({
  entryId: `entry-${index}`,
  toolUseId: `use-${index}`,
  toolName: "read",
  summary: `Call ${index}`,
  status: "completed",
  exitCode: 0,
  createdAt: "2026-10-24T00:00:00Z",
  updatedAt: "2026-10-24T00:00:00Z",
  lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: null },
  detail: {
    input: { text: "input", truncated: false },
    output: { text: "output", truncated: false },
    result: null,
  },
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 350));

function ToolCallScrollFixture() {
  const ownerRef = useRef<HTMLElement>(null);
  const [calls, setCalls] = useState<CliReadToolCall[]>([]);
  const [limit, setLimit] = useState(5);
  const [results, setResults] = useState("");
  const [status, setStatus] = useState("idle");

  const verify = async () => {
    setStatus("running");
    const owner = ownerRef.current;
    if (!owner) throw new Error("Missing scroll owner");
    const measurements: Record<string, number> = {};
    try {
      for (const visibleLimit of [5, 2]) {
        for (const position of ["earlier", "near-bottom"] as const) {
          flushSync(() => {
            setLimit(visibleLimit);
            setCalls(Array.from({ length: 8 }, (_, index) => call(index)));
          });
          await settle();
          owner.scrollTop =
            position === "earlier"
              ? 300
              : owner.scrollHeight - owner.clientHeight - 20;
          await settle();
          for (const action of ["arrival", "refresh", "handoff"] as const) {
            const before = owner.scrollTop;
            flushSync(() =>
              setCalls((current) =>
                action === "refresh"
                  ? current.map((item) => ({
                      ...item,
                      detail: { ...item.detail },
                    }))
                  : [...current, call(current.length)],
              ),
            );
            let maxDrift = Math.abs(owner.scrollTop - before);
            // Check every frame, including the former newest call's exit transition.
            for (let frame = 0; frame < 30; frame++) {
              await new Promise(requestAnimationFrame);
              maxDrift = Math.max(maxDrift, Math.abs(owner.scrollTop - before));
            }
            const name = `${visibleLimit}/${position}/${action}`;
            measurements[name] = maxDrift;
            if (maxDrift > 1) throw new Error(`${name}: drifted ${maxDrift}px`);
          }
        }
      }
      setResults(JSON.stringify(measurements, null, 2));
      setStatus("passed");
    } catch (error) {
      setResults(
        `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(measurements, null, 2)}`,
      );
      setStatus("failed");
    }
  };

  return (
    <>
      <button id="verify" onClick={() => void verify()}>
        Verify tool-call arrival
      </button>
      <main id="owner" ref={ownerRef} style={{ height: 200, overflow: "auto" }}>
        <article style={{ height: 1200 }}>Earlier conversation content</article>
        <p>Latest narration</p>
        <LatestTurnToolCalls
          toolCalls={calls}
          hiddenCount={0}
          newestEntryId={calls.at(-1)?.entryId ?? null}
          visibleLimit={limit}
        />
        <footer style={{ height: 100 }}>Conversation controls</footer>
      </main>
      <pre id="results" data-status={status}>
        {results}
      </pre>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<ToolCallScrollFixture />);
