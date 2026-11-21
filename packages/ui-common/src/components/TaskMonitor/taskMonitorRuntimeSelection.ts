import type { TaskMonitorLaunchProvider } from "../../api";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";

/**
 * Fast mode is kept as an explicit true/false where the catalog supports it for the
 * provider and model, and omitted where it does not.
 */
export const normalizeFastMode = <
  T extends {
    provider: TaskMonitorLaunchProvider;
    model: string;
    fastMode?: boolean;
  },
>(
  selection: T,
): Omit<T, "fastMode"> & { fastMode?: boolean } => {
  const { fastMode, ...base } = selection;
  return supportsFastMode(selection.provider, selection.model)
    ? { ...base, fastMode: fastMode ?? false }
    : base;
};
