import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DesignDocResponseDto } from "../../../api";
export const doc = (
  id = "doc",
  overrides: Partial<DesignDocResponseDto> = {}
): DesignDocResponseDto => ({
  id,
  name: "Design",
  template: "CLASSIC",
  organizationId: "org",
  projectId: "project",
  status: "DRAFT",
  tags: [],
  sections: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...overrides,
});
export const ok = <T,>(data: T) => ({ data: { data } });
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
export const client = () =>
  new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
export const wrapper =
  (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
