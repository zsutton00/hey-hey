import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { expect, it } from "vitest";

import { useFeatureSectionVisualArtifacts } from "./useFeatureSectionVisualArtifacts";

it("sends separate type-filtered child and one-hop connected requests through the real client", async () => {
  const requests: URL[] = [];
  globalThis.mswServer.use(http.get(/\/work-items$/, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json([]);
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ enabled, featureId }) =>
    useFeatureSectionVisualArtifacts("visuals-test-org", "visuals-test-project", featureId, enabled),
  { wrapper, initialProps: { enabled: false, featureId: "first-feature" } });
  expect(requests).toHaveLength(0);
  hook.rerender({ enabled: true, featureId: "first-feature" });
  await waitFor(() => expect(requests).toHaveLength(4));

  const children = requests.filter((url) => url.searchParams.has("parentTaskId"));
  const connected = requests.filter((url) => url.searchParams.has("relatedEntityId"));
  expect(children).toHaveLength(2);
  expect(connected).toHaveLength(2);
  for (const set of [children, connected]) {
    expect(set.map((url) => url.searchParams.get("type")).sort()).toEqual(["DIAGRAM", "mockup"]);
  }
  for (const url of children) expect(url.searchParams.get("parentTaskId")).toBe("first-feature");
  for (const url of connected) {
    expect(url.searchParams.get("relatedEntityId")).toBe("first-feature");
    expect(url.searchParams.get("relatedEntityType")).toBe("TASK");
    expect(url.searchParams.has("parentTaskId")).toBe(false);
    expect(url.searchParams.has("includeDescendants")).toBe(false);
    expect(url.searchParams.getAll("edgeTypes").join(",")).toContain("RELATED_TO");
  }
  hook.rerender({ enabled: true, featureId: "second-feature" });
  await waitFor(() => expect(requests).toHaveLength(8));
  expect(requests.slice(4).every((url) =>
    (url.searchParams.get("parentTaskId") ?? url.searchParams.get("relatedEntityId")) === "second-feature",
  )).toBe(true);
  hook.unmount();
  queryClient.clear();
});
