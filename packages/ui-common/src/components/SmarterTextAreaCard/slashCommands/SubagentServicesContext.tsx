import { createContext, useContext } from "react";

interface SubagentServiceOption {
  id: string;
  name: string;
}

/** Child Service choices offered by the `/subagent` control. */
export interface SubagentServiceScope {
  options: readonly SubagentServiceOption[];
  /** The source session's Services; the child starts from this set. */
  sourceServiceIds: readonly string[];
}

const EMPTY_SCOPE: SubagentServiceScope = { options: [], sourceServiceIds: [] };

export const SubagentServicesContext =
  createContext<SubagentServiceScope>(EMPTY_SCOPE);

export const useSubagentServices = () => useContext(SubagentServicesContext);
