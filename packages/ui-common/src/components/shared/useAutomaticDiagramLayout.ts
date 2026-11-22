import { useEffect, useMemo, useState } from "react";
import {
  computeAutomaticDiagramLayout,
  type DiagramLayoutInput,
} from "./automaticDiagramLayout";
import type { WorkItemChangeSetPosition } from "../../api";

type AutomaticLayoutResult =
  | {
      key: string;
      status: "ready";
      positions: ReadonlyMap<string, WorkItemChangeSetPosition>;
    }
  | { key: string; status: "error"; message: string };

/**
 * Arranges a Diagram that has no saved positions with the single automatic
 * layout. Disabled while saved positions exist.
 */
export function useAutomaticDiagramLayout(
  input: DiagramLayoutInput,
  enabled: boolean,
) {
  const [result, setResult] = useState<AutomaticLayoutResult>();

  // Highlighting and other presentation changes do not rerun the layout.
  const key = JSON.stringify(input);
  const stableInput: DiagramLayoutInput = useMemo(() => JSON.parse(key), [key]);
  const active = enabled && stableInput.nodes.length > 0;

  useEffect(() => {
    if (!active) {
      return;
    }

    let disposed = false;
    void computeAutomaticDiagramLayout(stableInput).then(
      (positions) => {
        if (!disposed) {
          setResult({ key, status: "ready", positions });
        }
      },
      (error: unknown) => {
        console.error("Automatic Diagram layout failed", error);
        if (!disposed) {
          setResult({
            key,
            status: "error",
            message:
              error instanceof Error ? error.message : "Diagram layout failed.",
          });
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [active, key, stableInput]);

  const currentResult = active && result?.key === key ? result : undefined;
  return {
    active,
    pending: active && !currentResult,
    positions:
      currentResult?.status === "ready" ? currentResult.positions : undefined,
    error:
      currentResult?.status === "error" ? currentResult.message : undefined,
  };
}
