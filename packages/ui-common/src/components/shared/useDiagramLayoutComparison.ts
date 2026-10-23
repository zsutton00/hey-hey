import { useEffect, useMemo, useState } from "react";
import {
  computeDiagramLayoutCandidate,
  type DiagramLayoutCandidate,
  type DiagramLayoutDirection,
  type DiagramLayoutInput,
} from "./diagramLayoutCandidates";
import type { WorkItemChangeSetPosition } from "../../api";

type ComparisonResult =
  | {
      key: string;
      status: "ready";
      positions: ReadonlyMap<string, WorkItemChangeSetPosition>;
    }
  | { key: string; status: "error"; message: string };

export function useDiagramLayoutComparison(
  input: DiagramLayoutInput,
  candidate: DiagramLayoutCandidate | undefined,
  direction: DiagramLayoutDirection,
) {
  const [result, setResult] = useState<ComparisonResult>();
  // Highlighting and other presentation changes do not rerun the engines.
  const inputJson = JSON.stringify(input);
  const stableInput: DiagramLayoutInput = useMemo(
    () => JSON.parse(inputJson),
    [inputJson],
  );
  const key = `${candidate}:${direction}:${inputJson}`;
  useEffect(() => {
    if (!candidate || stableInput.nodes.length === 0) return;
    let disposed = false;
    void computeDiagramLayoutCandidate(stableInput, candidate, direction).then(
      (positions) => {
        if (!disposed) setResult({ key, status: "ready", positions });
      },
      (error: unknown) => {
        if (!disposed)
          setResult({
            key,
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Layout comparison failed.",
          });
      },
    );
    return () => {
      disposed = true;
    };
  }, [candidate, direction, key, stableInput]);
  const active = candidate !== undefined && stableInput.nodes.length > 0;
  const currentResult = result?.key === key ? result : undefined;
  return {
    candidate,
    direction,
    active,
    pending: active && !currentResult,
    positions:
      currentResult?.status === "ready" ? currentResult.positions : undefined,
    error:
      currentResult?.status === "error" ? currentResult.message : undefined,
  };
}
