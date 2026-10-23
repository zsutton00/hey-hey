import React from "react";
import {
  render as testingRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { Provider } from "jotai";
import { referencesResponse } from "./featureTreeReferences";
const render: typeof testingRender = (ui, options) =>
  testingRender(ui, { wrapper: Provider, ...options });
import { FeaturePicker } from "../FeaturePicker";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTasks: vi.fn(),
    listWorkItemReferences: vi.fn(),
  },
}));

import { unifiedApiClient } from "../../../clients/serviceClients";

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";

function makeFeature(
  id: string,
  options: {
    name?: string;
    parentTaskId?: string;
    totalChildren?: number;
  } = {}
): TaskResponseDto {
  return {
    id,
    name: options.name ?? `Feature ${id}`,
    type: "FEATURE",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    status: WorkStatus.Backlog,
    source: TaskSource.User,
    parentTaskId: options.parentTaskId,
    childCounts:
      options.totalChildren !== undefined
        ? { total: options.totalChildren }
        : undefined,
  } as TaskResponseDto;
}

const ROOT_A = makeFeature("root-a", { name: "Alpha", totalChildren: 2 });
const ROOT_B = makeFeature("root-b", { name: "Bravo", totalChildren: 9 });
const ROOT_C = makeFeature("root-c", { name: "Charlie", totalChildren: 0 });

const ALPHA_CHILD_1 = makeFeature("alpha-1", {
  name: "Alpha One",
  parentTaskId: "root-a",
  totalChildren: 1,
});
const ALPHA_CHILD_2 = makeFeature("alpha-2", {
  name: "Alpha Two",
  parentTaskId: "root-a",
});
const ALPHA_GRANDCHILD = makeFeature("alpha-1-1", {
  name: "Alpha One Deep",
  parentTaskId: "alpha-1",
});
const ALL_FEATURES = [
  ROOT_A,
  ROOT_B,
  ROOT_C,
  ALPHA_CHILD_1,
  ALPHA_CHILD_2,
  ALPHA_GRANDCHILD,
];

const mockedUnified = vi.mocked(unifiedApiClient);

function configureGetTasks(): void {
  mockedUnified.listWorkItemReferences.mockResolvedValue(
    referencesResponse(ALL_FEATURES) as never
  );
  mockedUnified.getTasks.mockImplementation(async (params) => {
    expect(params.taskIds).toBeDefined();
    expect(params.parentTaskId).toBeUndefined();
    return {
      data: {
        data: ALL_FEATURES.filter((feature) =>
          params.taskIds?.includes(feature.id)
        ),
      },
    } as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  configureGetTasks();
});

async function renderAndOpen(
  props: Partial<React.ComponentProps<typeof FeaturePicker>> = {}
) {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const utils = render(
    <FeaturePicker
      organizationId={ORG_ID}
      projectId={PROJ_ID}
      value={null}
      onChange={onChange}
      {...props}
    />
  );

  await waitFor(() =>
    expect(mockedUnified.listWorkItemReferences).toHaveBeenCalled()
  );

  const trigger = props.searchable
    ? screen.getByRole("combobox", { name: "Search feature titles" })
    : screen.getByRole("button", { name: /Feature/i });
  await user.click(trigger);

  return { user, onChange, ...utils };
}

describe("FeaturePicker tree navigator", () => {
  it("keeps cached feature levels navigable when selection metadata fails", async () => {
    mockedUnified.getTasks.mockRejectedValue(new Error("Metadata unavailable"));
    const { user, onChange } = await renderAndOpen();
    await user.click(
      await screen.findByRole("button", { name: "Drill into Alpha" })
    );
    expect(await screen.findByText("Alpha One")).toBeVisible();
    await waitFor(() =>
      expect(screen.getAllByText("Feature unavailable").length).toBeGreaterThan(
        0
      )
    );
    await user.click(screen.getByText("Alpha One"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resolves a pre-set feature name without fetching a task", async () => {
    render(
      <FeaturePicker
        organizationId={ORG_ID}
        projectId={PROJ_ID}
        value="alpha-1-1"
        onChange={vi.fn()}
      />
    );
    expect(await screen.findByText("Alpha One Deep")).toBeInTheDocument();
    expect(mockedUnified.getTasks).not.toHaveBeenCalled();
  });

  it("shows only root features when first opened", async () => {
    await renderAndOpen();

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Alpha");
    expect(options[1]).toHaveTextContent("Bravo");
    expect(options[2]).toHaveTextContent("Charlie");
  });

  it("can open the tree immediately when embedded by a slash command", async () => {
    render(
      <FeaturePicker
        organizationId={ORG_ID}
        projectId={PROJ_ID}
        value={null}
        onChange={vi.fn()}
        openOnMount
      />
    );

    const listbox = await screen.findByRole("listbox");
    expect(await within(listbox).findByText("Alpha")).toBeInTheDocument();
    expect(within(listbox).getByText("Bravo")).toBeInTheDocument();
    expect(within(listbox).getByText("Charlie")).toBeInTheDocument();
  });

  it("renders a drill chevron only for features with children", async () => {
    await renderAndOpen();

    await screen.findByRole("listbox");

    expect(
      await screen.findByRole("button", { name: /Drill into Alpha/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Drill into Bravo/i })
    ).toBeNull();
  });

  it("expands cached structure and hydrates only visible IDs", async () => {
    const { user } = await renderAndOpen();

    await user.click(
      await screen.findByRole("button", { name: /Drill into Alpha/i })
    );

    expect(
      mockedUnified.getTasks.mock.calls.every(
        ([params]) => params.taskIds && params.parentTaskId === undefined
      )
    ).toBe(true);

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    // Root: Alpha, Bravo, Charlie + expanded children Alpha One, Alpha Two
    expect(options.map((o) => o.textContent ?? "")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Alpha"),
        expect.stringContaining("Alpha One"),
        expect.stringContaining("Alpha Two"),
        expect.stringContaining("Bravo"),
        expect.stringContaining("Charlie"),
      ])
    );
  });

  it("supports drilling multiple levels deep", async () => {
    const { user } = await renderAndOpen();

    await user.click(
      await screen.findByRole("button", { name: /Drill into Alpha/i })
    );
    await waitFor(() =>
      expect(screen.getByText("Alpha One")).toBeInTheDocument()
    );

    await user.click(
      await screen.findByRole("button", { name: /Drill into Alpha One/i })
    );
    await waitFor(() =>
      expect(screen.getByText("Alpha One Deep")).toBeInTheDocument()
    );
  });

  it("selects a non-leaf feature when its row is clicked", async () => {
    const { user, onChange } = await renderAndOpen();

    const listbox = await screen.findByRole("listbox");
    const alphaOption = within(listbox)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Alpha"))!;
    await user.click(alphaOption);

    expect(onChange).toHaveBeenCalledWith(
      "root-a",
      expect.objectContaining({ id: "root-a" })
    );
  });

  it("clearing the value resets the picker", async () => {
    const { user, onChange } = await renderAndOpen({ value: "root-a" });

    const clearBtn = screen.getByRole("button", {
      name: /Clear selection/i,
      hidden: true,
    });
    await user.click(clearBtn);

    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("filters excludeFeatureIds at the root and within expanded children", async () => {
    const { user } = await renderAndOpen({
      excludeFeatureIds: ["root-b", "alpha-2"],
    });

    const listbox = await screen.findByRole("listbox");
    const rootOptions = within(listbox).getAllByRole("option");
    expect(rootOptions.map((o) => o.textContent ?? "")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Alpha"),
        expect.stringContaining("Charlie"),
      ])
    );
    expect(
      rootOptions.find((o) => o.textContent?.includes("Bravo"))
    ).toBeUndefined();

    await user.click(screen.getByRole("button", { name: /Drill into Alpha/i }));

    await waitFor(() => {
      expect(screen.getByText("Alpha One")).toBeInTheDocument();
    });
    expect(screen.queryByText("Alpha Two")).toBeNull();
  });
});

describe("FeaturePicker project title search", () => {
  it("opens with the dropdown search field focused", async () => {
    render(
      <FeaturePicker
        organizationId={ORG_ID}
        projectId={PROJ_ID}
        value={null}
        onChange={vi.fn()}
        searchable
        openOnMount
      />
    );

    const typeahead = screen.getByRole("combobox", {
      name: "Search feature titles",
    });
    await waitFor(() => expect(typeahead).toHaveFocus());
    await waitFor(() =>
      expect(typeahead).toHaveAttribute("aria-expanded", "true")
    );
    expect(typeahead).toHaveAttribute("placeholder", "Search feature titles");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("searches cached titles without a project-wide feature list", async () => {
    const { user } = await renderAndOpen({ searchable: true });
    await user.type(screen.getByRole("combobox"), "one deep");
    expect(await screen.findByText("Alpha One Deep")).toBeInTheDocument();
    expect(
      mockedUnified.getTasks.mock.calls.every(
        ([params]) => params.taskIds?.length
      )
    ).toBe(true);
  });

  it("renders project-wide matches and returns a TaskResponseDto selection", async () => {
    const { user, onChange } = await renderAndOpen({ searchable: true });

    await user.type(
      screen.getByRole("combobox", { name: "Search feature titles" }),
      "one deep"
    );
    await user.click(await screen.findByText("Alpha One Deep"));

    expect(onChange).toHaveBeenCalledWith(
      "alpha-1-1",
      expect.objectContaining({
        id: "alpha-1-1",
        name: "Alpha One Deep",
        type: "FEATURE",
        organizationId: ORG_ID,
        projectId: PROJ_ID,
      })
    );
  });

  it("returns to the lazy root tree when the query is cleared", async () => {
    const { user } = await renderAndOpen({ searchable: true });
    const input = screen.getByRole("combobox", {
      name: "Search feature titles",
    });

    await user.type(input, "one deep");
    expect(await screen.findByText("Alpha One Deep")).toBeInTheDocument();
    await user.clear(input);

    const listbox = await screen.findByRole("listbox");
    expect(await within(listbox).findByText("Alpha")).toBeInTheDocument();
    expect(within(listbox).getByText("Bravo")).toBeInTheDocument();
    expect(within(listbox).queryByText("Alpha One Deep")).toBeNull();
  });

  it("excludes configured feature ids from search results", async () => {
    const { user } = await renderAndOpen({
      searchable: true,
      excludeFeatureIds: ["alpha-2"],
    });

    await user.type(
      screen.getByRole("combobox", { name: "Search feature titles" }),
      "alpha"
    );

    expect(await screen.findByText("Alpha One")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Two")).toBeNull();
  });
});
