import { useEffect, useRef, useState } from "react";
import { useCurrentCanonicalPage } from "../../contexts/CanonicalPageContext";
import { useGuidedWalkthroughRuntime } from "./guidedWalkthroughRuntime";
import {
  guidableEntityKey,
  toGuidableEntityFromCanonicalPage,
} from "./types";

/**
 * Forwards the current canonical page to the walkthrough: publishes it as
 * live state (for already-done checks) and raises `canonical-page-shown` when
 * a new entity's page becomes current. Must render under a
 * CanonicalPageProvider; Preview and Peek never register there, so they do not
 * count. Read-only with respect to canonical activation.
 */
export function useCanonicalWalkthroughEvents(): void {
  const runtime = useGuidedWalkthroughRuntime();
  const descriptor = useCurrentCanonicalPage();
  const entity =
    descriptor === null ? null : toGuidableEntityFromCanonicalPage(descriptor);
  const entityRef = useRef(entity);
  entityRef.current = entity;
  const key = entity === null ? null : guidableEntityKey(entity);
  const [token] = useState(() => Symbol("canonical-page-observer"));

  useEffect(() => {
    if (runtime === null) return;
    const current = entityRef.current;
    const dispose = runtime.currentPage.publish(token, current);
    if (current !== null) {
      runtime.events.emit({ type: "canonical-page-shown", entity: current });
    }
    return dispose;
  }, [runtime, token, key]);
}

/** Composition-friendly mount point for {@link useCanonicalWalkthroughEvents}. */
export function CanonicalWalkthroughEvents(): null {
  useCanonicalWalkthroughEvents();
  return null;
}
