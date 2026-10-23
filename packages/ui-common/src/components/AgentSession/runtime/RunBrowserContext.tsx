import { createContext, useContext } from "react";

export interface RunBrowserContextValue {
  /** The CLI Run that owns the tab; null before the session has one. */
  runId: string | null;
  /** The paired machine that owns the session's Run. */
  sessionMachineId: string | null;
}

const RunBrowserContext = createContext<RunBrowserContextValue | null>(null);

/** Provided by agent session pages; content rendered inside one can open Run-owned browser tabs. */
export const RunBrowserProvider = RunBrowserContext.Provider;

/** Null outside an agent session, where there is no Run to open a tab for. */
export const useRunBrowserContext = (): RunBrowserContextValue | null =>
  useContext(RunBrowserContext);
