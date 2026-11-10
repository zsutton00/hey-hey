import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../i18n";
import { CreateProposal } from "../CreateProposal";
import { useExistingPlanTasks } from "../../../data/hooks/useExistingPlanTasks";
import { workItemKeys } from "../../../data/collections/workItemLists";
import { proposalKeys } from "../../../data/collections/proposals";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkStatus,
  WorkItemChangeSetMaterializationState,
  TaskSource,
  type PlanFromExistingTasksUpdatesPayload,
  type ProposalResponseDto,
  type TaskResponseDto,
} from "../../../api";

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "reviewer" } }),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [],
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: undefined,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketService: () => null,
}));

const artifact = {
  proposalKind: "plan-from-existing-tasks",
  parentFeatureId: "feature",
  planTitle: "Deliver existing work",
  designDocMarkdown: "# Complete design\n\nThe entire design body.",
  stages: [
    { title: "Prepare", summary: "Prepare the release", taskIds: ["first"] },
    { title: "Deliver", taskIds: ["second", "third"] },
  ],
  taskPrerequisites: [{ taskId: "second", dependsOnTaskIds: ["first"] }],
} satisfies PlanFromExistingTasksUpdatesPayload;
const initial: ProposalResponseDto = {
  id: "adoption",
  organizationId: "org",
  projectId: "project",
  type: ProposalType.Single,
  action: ProposalAction.Create,
  status: ProposalStatus.Draft,
  targetEntityType: TargetEntityType.Conversation,
  targetEntityId: "00000000-0000-0000-0000-000000000000",
  title: artifact.planTitle,
  updates: artifact,
  eli5: "Organize the work already written.",
  requestorId: "author",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};
function task(
  id: string,
  name: string,
  status = WorkStatus.Active,
): TaskResponseDto {
  return {
    id,
    name,
    status,
    type: id === "feature" ? "FEATURE" : "STANDARD",
    organizationId: "org",
    projectId: "project",
    source: TaskSource.System,
    sections: [{ key: "description", content: "Existing persisted work." }],
  };
}
let records: TaskResponseDto[];
let proposal: ProposalResponseDto;
let reads: string[][];
let readFailure: boolean;
let holdRead: Promise<void> | undefined;

beforeEach(() => {
  records = [
    task("feature", "Delivery"),
    task("first", "Prepare release", WorkStatus.Completed),
    task("second", "Ship release"),
    task("third", "Watch rollout", WorkStatus.OnHold),
  ];
  proposal = initial;
  reads = [];
  readFailure = false;
  holdRead = undefined;
  globalThis.mswServer.use(
    http.get("*/api/v1/organizations/org/members", () =>
      HttpResponse.json({ data: [] }),
    ),
    http.get(
      "*/api/v1/organizations/org/projects/project/work-items",
      async ({ request }) => {
        await holdRead;
        const ids = new URL(request.url).searchParams.getAll("taskIds");
        reads.push(ids);
        if (readFailure) {
          return HttpResponse.json({ message: "Read failed" }, { status: 403 });
        }
        return HttpResponse.json({
          data: records.filter((item) => ids.includes(item.id)),
        });
      },
    ),
    http.get(
      "*/api/v1/organizations/org/projects/project/proposals/adoption",
      () => HttpResponse.json({ data: proposal }),
    ),
  );
});

function harness(renderMode: "standalone" | "detail" = "standalone") {
  let client!: QueryClient;
  const onApply = vi.fn(async () => proposal);
  const onReject = vi.fn(async (_id: string, _reason: string) => {});
  function Host() {
    client = useQueryClient();
    return (
      <MemoryRouter>
        <CreateProposal
          renderMode={renderMode}
          proposals={[initial]}
          onApply={onApply}
          onReject={onReject}
        />
      </MemoryRouter>
    );
  }
  const view = render(<Host />);
  return { client, onApply, onReject, ...view };
}

describe.each(["standalone", "detail"] as const)(
  "existing-task Plan review (%s)",
  (renderMode) => {
    it.each(["", "Please regroup the release work"])(
      "rejects the whole artifact with optional feedback (%s)",
      async (feedback) => {
        const { onReject, onApply } = harness(renderMode);
        await screen.findAllByText("Ship release");
        fireEvent.click(screen.getByRole("button", { name: "Reject" }));
        if (feedback) {
          fireEvent.change(screen.getByTestId("proposal-reject-reason-input"), {
            target: { value: feedback },
          });
        }
        fireEvent.click(screen.getByTestId("proposal-reject-submit"));
        await waitFor(() =>
          expect(onReject).toHaveBeenCalledWith(initial.id, feedback),
        );
        expect(onReject).toHaveBeenCalledTimes(1);
        expect(onApply).not.toHaveBeenCalled();
      },
    );

    it("reviews the complete artifact in order using current records and refreshes titles and statuses", async () => {
      const { client, onApply } = harness(renderMode);
      await screen.findAllByText("Ship release");
      expect(screen.getByTestId("existing-plan-design")).toHaveTextContent(
        "The entire design body.",
      );
      expect(
        screen
          .getAllByTestId("existing-plan-stage")
          .map((stage) => stage.textContent),
      ).toEqual([
        expect.stringContaining("1. Prepare"),
        expect.stringContaining("2. Deliver"),
      ]);
      expect(
        within(screen.getByTestId("existing-plan-parent")).getByRole("link"),
      ).toHaveAttribute("href", "/projects/project/tasks/feature");
      expect(reads).toEqual([["feature", "first", "second", "third"]]);
      expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(
        1,
      );
      expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(1);
      expect(
        screen
          .getAllByTestId("existing-plan-task-status")
          .some((node) => node.textContent === "COMPLETED"),
      ).toBe(true);
      expect(
        screen.getByTestId("existing-plan-prerequisites"),
      ).toHaveTextContent("Prepare release");
      records = records.map((item) =>
        item.id === "second"
          ? { ...item, name: "Release shipped", status: WorkStatus.Completed }
          : item,
      );
      await act(async () => {
        await client.invalidateQueries({
          queryKey: workItemKeys.project("org", "project"),
        });
      });
      expect(
        (await screen.findAllByText("Release shipped"))[0],
      ).toHaveAttribute("href", "/projects/project/tasks/second");
      expect(onApply).not.toHaveBeenCalled();
    });

    it("keeps every listed task visible during loading, failure and unavailability", async () => {
      let release!: () => void;
      holdRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { client } = harness(renderMode);
      expect(screen.getAllByTestId("existing-plan-task-state")).toHaveLength(6);
      release();
      await screen.findAllByText("Ship release");
      records = records.filter((item) => item.id !== "third");
      await act(async () => {
        await client.invalidateQueries({
          queryKey: workItemKeys.project("org", "project"),
        });
      });
      expect(
        await screen.findByText("This task is unavailable."),
      ).toBeInTheDocument();
      readFailure = true;
      await act(async () => {
        await client.invalidateQueries({
          queryKey: workItemKeys.project("org", "project"),
        });
      });
      await waitFor(() =>
        expect(screen.getAllByText("Could not read this task.")).toHaveLength(
          6,
        ),
      );
      expect(screen.queryByText("third")).not.toBeInTheDocument();
    });

    it("preserves the failure reason when approving a refreshed revision", async () => {
      const { client, onApply } = harness(renderMode);
      await screen.findAllByText("Ship release");
      proposal = {
        ...initial,
        updatedAt: "2026-11-10T01:00:00Z",
        updates: {
          ...artifact,
          designDocMarkdown: "Revised design for approval",
        },
      };
      await act(async () => {
        await client.invalidateQueries({
          queryKey: proposalKeys.project("org", "project"),
        });
      });
      await screen.findByText("Revised design for approval");
      let fail!: (reason: Error) => void;
      onApply.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await screen.findByRole("progressbar");
      await act(async () => {
        fail(
          Object.assign(new Error("Task moved to another Plan"), {
            diagnostic: {
              issueCount: 1,
              truncated: false,
              correlationId: "revision-approval",
              issues: [
                {
                  field: "updates.stages[1].taskIds[0]",
                  code: "TASK_ALREADY_IN_PLAN",
                  reason: "Task moved to another Plan",
                  layer: "referential",
                },
              ],
            },
          }),
        );
      });
      expect(
        await screen.findByText("Task moved to another Plan"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("proposal-failure-diagnostic"),
      ).toHaveTextContent("revision-approval");
      expect(
        screen.getByTestId("proposal-failure-diagnostic"),
      ).toHaveTextContent("TASK_ALREADY_IN_PLAN");
      proposal = { ...proposal, updatedAt: "2026-11-10T02:00:00Z" };
      await act(async () => {
        await client.invalidateQueries({
          queryKey: proposalKeys.project("org", "project"),
        });
      });
      expect(
        screen.getByTestId("proposal-failure-diagnostic"),
      ).toHaveTextContent("revision-approval");
      proposal = {
        ...proposal,
        updatedAt: "2026-11-10T03:00:00Z",
        updates: { ...artifact, designDocMarkdown: "Corrected design" },
      };
      await act(async () => {
        await client.invalidateQueries({
          queryKey: proposalKeys.project("org", "project"),
        });
      });
      await screen.findByText("Corrected design");
      expect(
        screen.queryByTestId("proposal-failure-diagnostic"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
    });

    it("never presents approval as completed adoption and follows authoritative same-identity results", async () => {
      proposal = {
        ...initial,
        status: ProposalStatus.Approved,
        targetEntityId: "reserved-plan",
      };
      const { client } = harness(renderMode);
      await screen.findByRole("progressbar");
      expect(
        screen.queryByRole("link", { name: artifact.planTitle }),
      ).not.toBeInTheDocument();
      proposal = {
        ...proposal,
        materialization: {
          state: WorkItemChangeSetMaterializationState.RecoverableFailure,
          attemptCount: 1,
          operations: [],
          lastError: "Task moved to another Plan",
          diagnostic: {
            issueCount: 1,
            truncated: false,
            correlationId: "adoption-correlation",
            issues: [
              {
                field: "stages[1].taskIds[0]",
                code: "TASK_ALREADY_IN_PLAN",
                reason: "Task moved to another Plan",
                layer: "referential",
              },
            ],
          },
        },
      };
      await act(async () => {
        await client.invalidateQueries({
          queryKey: proposalKeys.project("org", "project"),
        });
      });
      expect(
        await screen.findByText("Task moved to another Plan"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("proposal-failure-diagnostic"),
      ).toHaveTextContent("stages[1].taskIds[0]");
      expect(
        screen.getByTestId("proposal-failure-diagnostic"),
      ).toHaveTextContent("TASK_ALREADY_IN_PLAN");
      expect(
        screen.getByTestId("proposal-failure-diagnostic"),
      ).toHaveTextContent("referential");
      expect(
        screen.getByTestId("proposal-failure-diagnostic"),
      ).toHaveTextContent("adoption-correlation");
      proposal = {
        ...proposal,
        targetEntityId: "created-plan",
        targetEntityType: TargetEntityType.Task,
        materialization: {
          state: WorkItemChangeSetMaterializationState.Published,
          attemptCount: 2,
          operations: [],
        },
      };
      await act(async () => {
        await client.invalidateQueries({
          queryKey: proposalKeys.project("org", "project"),
        });
      });
      expect(
        await screen.findByRole("link", { name: artifact.planTitle }),
      ).toHaveAttribute("href", "/projects/project/plans/created-plan");
    });
  },
);

it("refreshes the complete revised artifact and cleared votes in both hosts", async () => {
  let client!: QueryClient;
  proposal = {
    ...initial,
    requiredApprovals: 2,
    approvals: [
      { userId: "reviewer", type: "APPROVAL", createdAt: initial.createdAt },
    ],
  };
  function BothHosts() {
    client = useQueryClient();
    return (
      <MemoryRouter>
        {(["standalone", "detail"] as const).map((renderMode) => (
          <CreateProposal
            key={renderMode}
            renderMode={renderMode}
            proposals={[initial]}
            onApply={async () => proposal}
          />
        ))}
      </MemoryRouter>
    );
  }
  render(<BothHosts />);
  await screen.findAllByText("Ship release");
  proposal = {
    ...proposal,
    updatedAt: "2026-11-10T01:00:00Z",
    approvals: [],
    updates: {
      ...artifact,
      designDocMarkdown: "# Revised design\n\nRevised complete body.",
      stages: [
        { title: "Release together", taskIds: ["third", "first", "second"] },
      ],
      taskPrerequisites: [],
    },
  };
  await act(async () => {
    await client.invalidateQueries({
      queryKey: proposalKeys.project("org", "project"),
    });
  });
  await waitFor(() =>
    expect(
      screen
        .getAllByTestId("existing-plan-design")
        .every((node) => node.textContent?.includes("Revised complete body.")),
    ).toBe(true),
  );
  expect(screen.getAllByTestId("existing-plan-stage")).toHaveLength(2);
  expect(screen.queryByText("1. Prepare")).not.toBeInTheDocument();
  expect(
    screen
      .getAllByTestId("proposal-approval-progress")
      .every((node) => node.textContent?.includes("0")),
  ).toBe(true);
});

// The same collection query is shared by every review surface.
it("batches and deduplicates more than 200 referenced identities", async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `task-${index}`);
  records = ids.map((id) => task(id, `Work ${id}`));
  const { result } = renderHook(() =>
    useExistingPlanTasks("org", "project", [...ids, ids[0]!]),
  );
  await waitFor(() =>
    expect(result.current.get(ids[204]!)?.state).toBe("ready"),
  );
  expect(reads.map((batch) => batch.length)).toEqual([200, 5]);
  expect(new Set(reads.flat()).size).toBe(205);
});
