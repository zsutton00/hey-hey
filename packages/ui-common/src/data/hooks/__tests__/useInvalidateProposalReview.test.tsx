import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { proposalKeys } from "../../collections/proposals";
import { useInvalidateProposalReview } from "../useInvalidateProposalReview";

it("invalidates detail, list and group queries only within the affected project", async () => {
  const queryClient = new QueryClient();
  const single = proposalKeys.detail("org", "project", "proposal");
  const other = proposalKeys.detail("org", "project-other", "other");
  const list = proposalKeys.list("org", "project", { limit: 10, offset: 20 });
  const group = proposalKeys.group("org", "project", "group");
  for (const queryKey of [single, other, list, group]) {
    queryClient.setQueryData(queryKey, {});
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(useInvalidateProposalReview, { wrapper });
  await act(() => result.current("org", "project"));
  const invalidated = (queryKey: readonly unknown[]) =>
    queryClient.getQueryState(queryKey)?.isInvalidated;
  expect([single, list, group].map(invalidated)).toEqual([true, true, true]);
  expect(invalidated(other)).toBe(false);
});
