import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { GuidedWalkthroughOverlay } from "./GuidedWalkthroughOverlay";
import { GuidedWalkthroughRunner } from "./GuidedWalkthroughRunner";
import {
  createGuidedWalkthroughRuntime,
  GuidedWalkthroughContext,
  GuidedWalkthroughControlsContext,
  type GuidedWalkthroughControls,
  type GuidedWalkthroughRuntime,
} from "./guidedWalkthroughRuntime";

/**
 * Escape exits an active walkthrough. Registered on window in the capture
 * phase because DiscussModal's Dialog stops keydown bubbling; propagation is
 * stopped so Escape leaves the app (and any open modal) where it is.
 */
function useEscapeToExit(active: boolean, runner: GuidedWalkthroughRunner) {
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      runner.exit();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, runner]);
}

/**
 * App-level owner of the guided walkthrough: shares the target registry,
 * event channel and Discuss session store with owning components, runs the
 * single client-memory walkthrough, and renders its overlay. Mount it above
 * the router so a walkthrough survives navigation.
 */
export const GuidedWalkthroughProvider: React.FC<{
  runtime?: GuidedWalkthroughRuntime;
  children: React.ReactNode;
}> = ({ runtime, children }) => {
  const [ownRuntime] = useState(createGuidedWalkthroughRuntime);
  const activeRuntime = runtime ?? ownRuntime;
  const runner = useMemo(
    () => new GuidedWalkthroughRunner(activeRuntime),
    [activeRuntime]
  );
  useEffect(() => () => runner.dispose(), [runner]);
  const view = useSyncExternalStore(
    runner.subscribe,
    runner.getView,
    runner.getView
  );
  useEscapeToExit(view.status === "active", runner);

  const controls = useMemo<GuidedWalkthroughControls>(
    () => ({
      startWalkthrough: (walkthrough) => runner.start(walkthrough),
      exitWalkthrough: () => runner.exit(),
    }),
    [runner]
  );

  return (
    <GuidedWalkthroughContext.Provider value={activeRuntime}>
      <GuidedWalkthroughControlsContext.Provider value={controls}>
        {children}
        <GuidedWalkthroughOverlay
          view={view}
          onExit={controls.exitWalkthrough}
          onDismissMessage={() => runner.dismissMessage()}
        />
      </GuidedWalkthroughControlsContext.Provider>
    </GuidedWalkthroughContext.Provider>
  );
};
