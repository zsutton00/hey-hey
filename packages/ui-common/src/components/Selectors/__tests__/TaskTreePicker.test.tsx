import React from "react";
import { Provider } from "jotai";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { referencesResponse } from "../../Features/__tests__/featureTreeReferences";
import { TaskTreePicker } from "../TaskTreePicker";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTasks: vi.fn(),
    getTask: vi.fn(),
    listWorkItemReferences: vi.fn(),
  },
}));

const feature = (
  id: string,
  name: string,
  parentTaskId?: string
): TaskResponseDto => ({
  id,
  name,
  parentTaskId,
  type: "FEATURE",
  organizationId: "org",
  projectId: "project",
  status: WorkStatus.Active,
  source: TaskSource.User,
});
const features = [
  feature("root", "Root"),
  feature("parent", "Parent", "root"),
  feature("leaf", "Leaf", "parent"),
];
const task: TaskResponseDto = {
  ...features[2],
  id: "task",
  name: "Implementation",
  type: "STANDARD",
  parentTaskId: "leaf",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(unifiedApiClient.listWorkItemReferences).mockResolvedValue(
    referencesResponse(features) as never
  );
  vi.mocked(unifiedApiClient.getTask).mockResolvedValue({
    data: { data: task },
  } as never);
  vi.mocked(unifiedApiClient.getTasks).mockImplementation(
    async (params) =>
      ({
        data: {
          data: params.taskIds
            ? features.filter((item) => params.taskIds?.includes(item.id))
            : [...features, task].filter(
                (item) => item.parentTaskId === params.parentTaskId
              ),
        },
      } as never)
  );
});

describe("TaskTreePicker cached feature levels", () => {
  it("shows cached features while mixed children load and preserves them after a failed read", async () => {
    let rejectRead!: (reason: Error) => void;
    vi.mocked(unifiedApiClient.getTasks).mockImplementation((params) =>
      params.taskIds
        ? (Promise.resolve({
            data: {
              data: features.filter((item) =>
                params.taskIds?.includes(item.id)
              ),
            },
          }) as never)
        : (new Promise((_resolve, reject) => {
            rejectRead = reject;
          }) as never)
    );
    const user = userEvent.setup();
    render(
      <Provider>
        <TaskTreePicker
          organizationId="org"
          projectId="project"
          value={null}
          onChange={vi.fn()}
        />
      </Provider>
    );
    await user.click(screen.getByTestId("task-tree-picker-trigger"));
    await user.click(await screen.findByLabelText("Expand Root"));
    expect(await screen.findByText("Parent")).toBeVisible();
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(unifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: "root" })
    );
    await act(async () => rejectRead(new Error("Unavailable")));
    expect(await screen.findByText("Failed to load")).toBeVisible();
    expect(screen.getByText("Parent")).toBeVisible();
  });

  it("preloads every feature ancestor and selects with the metadata DTO", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Provider>
        <TaskTreePicker
          organizationId="org"
          projectId="project"
          value="leaf"
          taskType="FEATURE"
          onChange={onChange}
        />
      </Provider>
    );
    await user.click(await screen.findByText("Leaf"));
    await waitFor(() => expect(screen.getAllByText("Leaf")).toHaveLength(2));
    expect(screen.getByText("Root")).toBeVisible();
    expect(screen.getByText("Parent")).toBeVisible();
    await user.click(screen.getByText("Parent"));
    expect(onChange).toHaveBeenCalledWith("parent", features[1]);
    expect(unifiedApiClient.getTask).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(unifiedApiClient.getTasks)
        .mock.calls.every(
          ([params]) => params.taskIds && params.parentTaskId === undefined
        )
    ).toBe(true);
  });

  it("reads the task envelope then walks cached feature hops for mixed ancestry", async () => {
    const user = userEvent.setup();
    render(
      <Provider>
        <TaskTreePicker
          organizationId="org"
          projectId="project"
          value="task"
          onChange={vi.fn()}
        />
      </Provider>
    );
    await user.click(await screen.findByText("Implementation"));
    expect(await screen.findByText("Root")).toBeVisible();
    expect(await screen.findByText("Parent")).toBeVisible();
    expect(await screen.findByText("Leaf")).toBeVisible();
    await waitFor(() =>
      expect(screen.getAllByText("Implementation")).toHaveLength(2)
    );
    expect(
      vi
        .mocked(unifiedApiClient.getTask)
        .mock.calls.every(([params]) => params.taskId === task.id)
    ).toBe(true);
    expect(
      vi
        .mocked(unifiedApiClient.getTasks)
        .mock.calls.every(([params]) => params.parentTaskId !== null)
    ).toBe(true);
  });

  it("opens feature children from the cache without a per-level structure request", async () => {
    const user = userEvent.setup();
    render(
      <Provider>
        <TaskTreePicker
          organizationId="org"
          projectId="project"
          value={null}
          taskType="FEATURE"
          onChange={vi.fn()}
        />
      </Provider>
    );
    await user.click(screen.getByText("None"));
    await user.click(await screen.findByLabelText("Expand Root"));
    expect(await screen.findByText("Parent")).toBeVisible();
    await user.click(screen.getByLabelText("Expand Parent"));
    expect(await screen.findByText("Leaf")).toBeVisible();
    expect(
      vi
        .mocked(unifiedApiClient.getTasks)
        .mock.calls.every(([params]) => params.taskIds)
    ).toBe(true);
  });
});
