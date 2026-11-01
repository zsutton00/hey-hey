import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectReadyFutures } from "../ProjectReadyFutures";
import { proposalKeys } from "../../../data/collections/proposals";
import { invalidateProjectWorkItemQueries } from "../../../data/query/dataLayerInvalidation";

const list = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: { listProjectReadyFutures: list },
}));
vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    proposal: ({
      projectId,
      proposalId,
    }: {
      projectId: string;
      proposalId: string;
    }) => `/${projectId}/review/${proposalId}`,
    proposalGroup: ({
      projectId,
      groupId,
    }: {
      projectId: string;
      groupId: string;
    }) => `/${projectId}/group/${groupId}`,
  }),
}));
function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}
const item = (drift = false) => ({
  futureId: "stable-future",
  proposalId: "latest-refinement",
  proposalTitle: "An old reviewed change",
  targetEntityId: "target",
  targetEntityType: "TASK",
  targetName: "Project knowledge",
  targetType: "FEATURE",
  applicability: {
    revision: 2,
    canApply: !drift,
    blockers: drift ? ["BASELINE_CHANGED"] : [],
    completionEligibility: { eligible: true, blockers: [] },
  },
});
const response = (items = [item()], total = items.length) => ({
  data: { data: { items, total, limit: 10, offset: 0, unavailableCount: 0 } },
});
let client: QueryClient;
beforeEach(() => {
  list.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
function view(projectId = "project") {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectReadyFutures
          key={projectId}
          organizationId="org"
          projectId={projectId}
        />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
it("opens ordinary grouped reconciliation without applying, independent of activity windows", async () => {
  list.mockResolvedValue(
    response([{ ...item(true), reviewGroupId: "review-group" }]),
  );
  render(view());
  await userEvent.click(
    await screen.findByRole("button", { name: "Review reconciliation" }),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/project/group/review-group",
  );
  expect(screen.getByText("FEATURE · Project knowledge")).toBeVisible();
  expect(list).toHaveBeenCalledWith({
    organizationId: "org",
    projectId: "project",
    limit: 10,
    offset: 0,
  });
});
it("opens standalone review and refreshes after dependency reopening and proposal application", async () => {
  list.mockResolvedValue(response());
  render(view());
  await userEvent.click(
    await screen.findByRole("button", { name: "Review & apply" }),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/project/review/latest-refinement",
  );
  list.mockResolvedValue(response([]));
  await invalidateProjectWorkItemQueries(
    client,
    "org",
    "project",
    "dependency",
  );
  await waitFor(() =>
    expect(screen.queryByTestId("ready-future-entry")).not.toBeInTheDocument(),
  );
  list.mockResolvedValue(response());
  await client.invalidateQueries({
    queryKey: proposalKeys.project("org", "project"),
  });
  expect(await screen.findByTestId("ready-future-entry")).toBeVisible();
});
it("explains permission restrictions and opens review without offering Apply", async () => {
  const restricted = item();
  restricted.applicability.canApply = false;
  restricted.applicability.blockers = ["PERMISSION_DENIED"];
  list.mockResolvedValue(response([restricted]));
  render(view());
  expect(
    await screen.findByText("You don't have permission to apply this change."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Review & apply" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Review change" }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/project/review/latest-refinement",
  );
});
it("paginates all qualifying changes and retries a failed read", async () => {
  list
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue(response([item()], 21));
  render(view());
  await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Go to page 3" }),
  );
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith({
      organizationId: "org",
      projectId: "project",
      limit: 10,
      offset: 20,
    }),
  );
});
it("does not carry results into a different project", async () => {
  list.mockResolvedValue(response());
  const mounted = render(view());
  await screen.findByText("An old reviewed change");
  list.mockImplementation(() => new Promise(() => {}));
  mounted.rerender(view("other-project"));
  expect(screen.queryByText("An old reviewed change")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Loading ready changes")).toBeVisible();
});

it("surfaces partial failures without hiding healthy changes or calling the result empty", async () => {
  list.mockResolvedValue({
    data: {
      data: {
        items: [item()],
        total: 1,
        limit: 10,
        offset: 0,
        unavailableCount: 1,
      },
    },
  });
  render(view());
  expect(
    await screen.findByText("Some changes could not be loaded."),
  ).toBeVisible();
  expect(screen.getByText("An old reviewed change")).toBeVisible();
  expect(screen.queryByText("No ready changes.")).not.toBeInTheDocument();
});

it("refreshes cached results when returning to Overview", async () => {
  list.mockResolvedValue(response());
  const first = render(view());
  await screen.findByText("An old reviewed change");
  first.unmount();
  list.mockResolvedValue(response([]));
  render(view());
  await waitFor(() =>
    expect(screen.queryByTestId("ready-future-entry")).not.toBeInTheDocument(),
  );
  expect(list).toHaveBeenCalledTimes(2);
  expect(screen.getByText("No ready changes.")).toBeVisible();
});
