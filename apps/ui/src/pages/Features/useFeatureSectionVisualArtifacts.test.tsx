import { DataHooksProvider } from "@hey-hey/ui-common/data";
import { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { expect, it } from "vitest";

import { useFeatureSectionVisualArtifacts } from "./useFeatureSectionVisualArtifacts";

type Variables = {
  type?: string;
  parentTaskId?: string;
  includeDescendants?: boolean;
  relatedTo?: { entityId: string; entityType: string; edgeTypes: string[] };
};

it("sends separate type-filtered child and one-hop connected reads through the real client", async () => {
  const requests: Variables[] = [];
  globalThis.mswServer.use(
    http.post(/\/graphql$/, async ({ request }) => {
      const { operationName, variables } = (await request.clone().json()) as {
        operationName: string;
        variables: Variables;
      };
      if (operationName !== "GetWorkItems") {
        return;
      }
      requests.push(variables);

      return HttpResponse.json({ data: { workItems: [] } });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <DataHooksProvider queryClient={queryClient}>{children}</DataHooksProvider>
  );
  const hook = renderHook(
    ({ enabled, featureId }) =>
      useFeatureSectionVisualArtifacts(
        "visuals-test-org",
        "visuals-test-project",
        featureId,
        enabled,
      ),
    { wrapper, initialProps: { enabled: false, featureId: "first-feature" } },
  );
  expect(requests).toHaveLength(0);
  hook.rerender({ enabled: true, featureId: "first-feature" });
  await waitFor(() => expect(requests).toHaveLength(4));

  const children = requests.filter((variables) => "parentTaskId" in variables);
  const connected = requests.filter((variables) => variables.relatedTo);
  expect(children).toHaveLength(2);
  expect(connected).toHaveLength(2);
  for (const set of [children, connected]) {
    expect(set.map((variables) => variables.type).sort()).toEqual([
      "DIAGRAM",
      "mockup",
    ]);
  }
  for (const variables of children) {
    expect(variables.parentTaskId).toBe("first-feature");
  }
  for (const variables of connected) {
    expect(variables.relatedTo).toMatchObject({
      entityId: "first-feature",
      entityType: "Task",
    });
    expect(variables.relatedTo?.edgeTypes).toContain("RelatedTo");
    expect("parentTaskId" in variables).toBe(false);
    expect("includeDescendants" in variables).toBe(false);
  }
  hook.rerender({ enabled: true, featureId: "second-feature" });
  await waitFor(() => expect(requests).toHaveLength(8));
  expect(
    requests
      .slice(4)
      .every(
        (variables) =>
          (variables.parentTaskId ?? variables.relatedTo?.entityId) ===
          "second-feature",
      ),
  ).toBe(true);
  hook.unmount();
  queryClient.clear();
});
