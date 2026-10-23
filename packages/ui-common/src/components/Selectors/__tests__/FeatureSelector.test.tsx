import React from "react";
import { Provider } from "jotai";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  FeatureTag,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { referencesResponse } from "../../Features/__tests__/featureTreeReferences";
import { FeatureSelector } from "../FeatureSelector";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getTasks: vi.fn(), listWorkItemReferences: vi.fn() },
}));
const feature: TaskResponseDto = {
  id: "feature",
  name: "Live Updates",
  type: "FEATURE",
  organizationId: "org",
  projectId: "project",
  source: TaskSource.User,
  status: WorkStatus.Active,
  tag: FeatureTag.Product,
  parentTaskId: "parent",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(unifiedApiClient.listWorkItemReferences).mockResolvedValue(
    referencesResponse([feature]) as never
  );
});

it("keeps hierarchy names available while metadata loads, then selects the complete DTO", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(unifiedApiClient.getTasks).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }) as never
  );
  const onChange = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <Provider>
      <FeatureSelector
        organizationId="org"
        projectId="project"
        value={feature.id}
        onChange={onChange}
      />
    </Provider>
  );
  expect(await screen.findByText(feature.name)).toBeVisible();
  expect(unifiedApiClient.getTasks).not.toHaveBeenCalled();
  rerender(
    <Provider>
      <FeatureSelector
        organizationId="org"
        projectId="project"
        value={null}
        onChange={onChange}
      />
    </Provider>
  );
  await user.click(screen.getByRole("combobox"));
  expect(await screen.findByText("Status: Loading…")).toBeVisible();
  await waitFor(() => expect(resolve).toBeDefined());
  resolve({ data: { data: [feature] } });
  expect(await screen.findByText("Status: ACTIVE")).toBeVisible();
  await user.click(screen.getByRole("option", { name: /Live Updates/ }));
  expect(onChange).toHaveBeenCalledWith(feature.id, feature);
  expect(unifiedApiClient.getTasks).toHaveBeenCalledWith(
    expect.objectContaining({
      taskIds: [feature.id],
      includeSectionKeys: undefined,
    })
  );
});
