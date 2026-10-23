import { createContext, useContext } from "react";

export type QueryMountPolicy = "default" | "always-refetch";

export const QueryMountPolicyContext =
  createContext<QueryMountPolicy>("default");

export function useQueryMountPolicy(): QueryMountPolicy {
  return useContext(QueryMountPolicyContext);
}
