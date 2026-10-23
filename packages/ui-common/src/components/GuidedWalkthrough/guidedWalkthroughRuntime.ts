import { createContext, useContext } from "react";
import { ExplorerSectionStore } from "./ExplorerSectionStore";
import { CurrentPageStore } from "./CurrentPageStore";
import { CreateServiceFormSessionStore } from "./CreateServiceFormSessionStore";
import { DiscussModalSessionStore } from "./DiscussModalSessionStore";
import { GuidableTargetRegistry } from "./GuidableTargetRegistry";
import { WalkthroughEventChannel } from "./WalkthroughEventChannel";
import type { Walkthrough } from "./types";

export interface GuidedWalkthroughRuntime {
  explorerSections: ExplorerSectionStore;
  targets: GuidableTargetRegistry;
  events: WalkthroughEventChannel;
  discussSessions: DiscussModalSessionStore;
  createServiceForms: CreateServiceFormSessionStore;
  currentPage: CurrentPageStore;
}

export function createGuidedWalkthroughRuntime(): GuidedWalkthroughRuntime {
  return {
    explorerSections: new ExplorerSectionStore(),
    targets: new GuidableTargetRegistry(),
    events: new WalkthroughEventChannel(),
    discussSessions: new DiscussModalSessionStore(),
    createServiceForms: new CreateServiceFormSessionStore(),
    currentPage: new CurrentPageStore(),
  };
}

export const GuidedWalkthroughContext =
  createContext<GuidedWalkthroughRuntime | null>(null);

/** Null outside a provider: owners then register nothing and emit nothing. */
export function useGuidedWalkthroughRuntime(): GuidedWalkthroughRuntime | null {
  return useContext(GuidedWalkthroughContext);
}

export interface GuidedWalkthroughControls {
  /** Starts (or restarts) a walkthrough built from registered actions. */
  startWalkthrough: (walkthrough: Walkthrough) => void;
  exitWalkthrough: () => void;
}

export const GuidedWalkthroughControlsContext =
  createContext<GuidedWalkthroughControls | null>(null);

/** Null outside a GuidedWalkthroughProvider. */
export function useGuidedWalkthroughControls(): GuidedWalkthroughControls | null {
  return useContext(GuidedWalkthroughControlsContext);
}
