import type { PropsWithChildren, ReactElement } from "react";
import {
  QueryMountPolicyContext,
  type QueryMountPolicy,
} from "./queryMountPolicyContext";

export interface QueryMountPolicyProviderProps extends PropsWithChildren {
  policy: QueryMountPolicy;
}

/**
 * Applies a query mount policy to the hooks below this boundary. This keeps
 * fetch policy in the Data Layer while allowing a screen boundary to request
 * an authoritative read whenever one of its query consumers mounts.
 */
export function QueryMountPolicyProvider({
  children,
  policy,
}: QueryMountPolicyProviderProps): ReactElement {
  return (
    <QueryMountPolicyContext.Provider value={policy}>
      {children}
    </QueryMountPolicyContext.Provider>
  );
}
