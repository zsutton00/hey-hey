import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectedWorkItem,
  ProposalResponseDto,
  WorkItemChangeSetOperation,
  WorkItemTypeGraphCapability,
} from "../../../api";
import { createWorkItemGraphDraftState } from "../../../components/shared/workItemGraphDraft";
import { proposalsClient } from "../../../clients/serviceClients";
import {
  SubmitWorkItemGraphProposalError,
  useSubmitWorkItemGraphProposal,
} from "../useSubmitWorkItemGraphProposal";

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    createProposal: vi.fn(),
  },
}));

const root: ProjectedWorkItem = {
  identity: { refType: "existing", id: "root-1" },
  label: "Approval Flow",
  type: "workflow",
  name: "Approval Flow",
  sections: [],
  deleted: false,
};
const child: ProjectedWorkItem = {
  identity: { refType: "existing", id: "child-1" },
  label: "Start",
  type: "workflow_step",
  name: "Start",
  parent: root.identity,
  sections: [],
  deleted: false,
};
const graphCapability: WorkItemTypeGraphCapability = {
  nodeChildType: "workflow_step",
  layout: { sectionKey: "layout", schemaRef: "work-item-graph-layout.v1" },
  layoutPreference: {
    sectionKey: "layoutPreference",
    schemaRef: "preference.v1",
  },
  readableRelationships: [],
  editableRelationships: [],
  rendererKey: "work-item-graph",
  editorKey: "work-item-graph-editor",
  supportedActions: [],
};
const input = {
  root,
  children: [child],
  incidentRelationships: [],
  typeDefinition: {
    key: "workflow",
    name: "Workflow",
    allowedStatuses: [],
    sections: [
      {
        key: "layout",
        kind: "json" as const,
        schemaRef: "work-item-graph-layout.v1",
      },
    ],
    capabilities: { graph: graphCapability },
  },
};

const operations: WorkItemChangeSetOperation[] = [
  {
    op: "workItem.create",
    ref: { refType: "temporary", tempId: "draft-work-item-7" },
    type: "workflow_step",
    name: "Review",
    parent: root.identity,
    position: { x: 17, y: 29 },
  },
  {
    op: "relationship.create",
    ref: { refType: "temporary", tempId: "draft-relationship-3" },
    source: child.identity,
    target: { refType: "temporary", tempId: "draft-work-item-7" },
    edgeType: "STANDARD",
    category: "flow",
    direction: "forward",
  },
  {
    op: "layout.replace",
    root: root.identity,
    sectionKey: "layout",
    entries: [
      {
        node: { refType: "temporary", tempId: "draft-work-item-7" },
        position: { x: 17, y: 29 },
      },
      { node: child.identity, position: { x: 3, y: 5 } },
    ],
  },
];

function changedDraft() {
  const initial = createWorkItemGraphDraftState(input);
  return {
    ...initial,
    operations,
    isDirty: true,
    projection: {
      ...initial.projection,
      children: [
        child,
        {
          identity: {
            refType: "temporary" as const,
            tempId: "draft-work-item-7",
          },
          label: "Review",
          type: "workflow_step",
          name: "Review",
          parent: root.identity,
          sections: [],
          deleted: false,
        },
      ],
    },
  };
}

const proposal = {
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "project-1",
  eli5: "Changes this workflow graph.",
} as ProposalResponseDto;
let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
const createProposal = vi.mocked(proposalsClient.createProposal);

describe("useSubmitWorkItemGraphProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
    createProposal.mockResolvedValue({
      data: {
        success: true,
        message: "Created",
        data: proposal,
        timestamp: "2026-07-17T00:00:00.000Z",
        statusCode: 201,
      },
    });
  });

  it("submits the exact ordered generic operation set and stable references", async () => {
    const invalidation = vi.spyOn(queryClient, "invalidateQueries");
    const draft = changedDraft();
    const { result } = renderHook(() => useSubmitWorkItemGraphProposal(), { wrapper });

    await act(() =>
      result.current.submit({
        organizationId: "org-1",
        projectId: "project-1",
        eli5: "Changes this workflow graph.",
        root,
        graphCapability,
        draft,
      })
    );

    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["proposals", "org-1", "project-1", "list"] });
    expect(createProposal).toHaveBeenCalledOnce();
    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        createProposalRequestDto: {
          eli5: "Changes this workflow graph.",
          type: "BATCH",
          action: "UPDATE",
          targetEntityId: "root-1",
          targetEntityType: "TASK",
          title: "Approval Flow",
          updates: {
            root: root.identity,
            operations,
            layoutBoundary: [
              child.identity,
              { refType: "temporary", tempId: "draft-work-item-7" },
            ],
          },
        },
      })
    );
    const submittedOperations = createProposal.mock.calls[0]?.[0]
      ?.createProposalRequestDto.updates as {
      operations: WorkItemChangeSetOperation[];
    };
    expect(submittedOperations.operations[0]).toBe(operations[0]);
    expect(submittedOperations.operations[1]).toBe(operations[1]);
    expect(submittedOperations.operations[2]).toBe(operations[2]);
  });

  it("submits a temporary graph root as one CREATE review", async () => {
    const temporaryRoot: ProjectedWorkItem = {
      ...root,
      identity: { refType: "temporary", tempId: "diagram-root" },
      type: "DIAGRAM",
      name: "System map",
    };
    const draft = changedDraft();
    const createDraft = {
      ...draft,
      projection: { ...draft.projection, projectedRoot: temporaryRoot },
    };
    const { result } = renderHook(() => useSubmitWorkItemGraphProposal(), { wrapper });

    await act(() =>
      result.current.submit({
        organizationId: "org-1",
        projectId: "project-1",
        eli5: "Changes this workflow graph.",
        root: temporaryRoot,
        graphCapability,
        draft: createDraft,
      })
    );

    expect(
      createProposal.mock.calls[0]?.[0]?.createProposalRequestDto
    ).toMatchObject({
      action: "CREATE",
      targetEntityId: "00000000-0000-0000-0000-000000000000",
      title: "System map",
      updates: { root: temporaryRoot.identity, operations },
    });
  });

  it.each([
    ["missing_organization", { organizationId: "" }],
    ["missing_project", { projectId: null }],
    ["missing_root", { root: null }],
    ["missing_graph_capability", { graphCapability: null }],
    ["missing_draft", { draft: null }],
  ] as const)(
    "rejects %s before making a network call",
    async (code, override) => {
      const { result } = renderHook(() => useSubmitWorkItemGraphProposal(), { wrapper });

      await act(async () => {
        await expect(
          result.current.submit({
            organizationId: "org-1",
            projectId: "project-1",
            eli5: "Changes this workflow graph.",
            root,
            graphCapability,
            draft: changedDraft(),
            ...override,
          })
        ).rejects.toMatchObject<Partial<SubmitWorkItemGraphProposalError>>({
          code,
        });
      });
      expect(createProposal).not.toHaveBeenCalled();
    }
  );

  it("rejects an unchanged draft before making a network call", async () => {
    const { result } = renderHook(() => useSubmitWorkItemGraphProposal(), { wrapper });

    await act(async () => {
      await expect(
        result.current.submit({
          organizationId: "org-1",
          projectId: "project-1",
          eli5: "Changes this workflow graph.",
          root,
          graphCapability,
          draft: createWorkItemGraphDraftState(input),
        })
      ).rejects.toMatchObject({ code: "no_changes" });
    });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("shares an in-flight request across concurrent submissions", async () => {
    let resolveRequest: (() => void) | undefined;
    createProposal.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = () =>
            resolve({
              data: {
                success: true,
                message: "Created",
                data: proposal,
                timestamp: "2026-07-17T00:00:00.000Z",
                statusCode: 201,
              },
            });
        })
    );
    const { result } = renderHook(() => useSubmitWorkItemGraphProposal(), { wrapper });
    const submitInput = {
      organizationId: "org-1",
      projectId: "project-1",
      eli5: "Changes this workflow graph.",
      root,
      graphCapability,
      draft: changedDraft(),
    };

    let first!: Promise<ProposalResponseDto>;
    let second!: Promise<ProposalResponseDto>;
    act(() => {
      first = result.current.submit(submitInput);
      second = result.current.submit(submitInput);
    });

    expect(first).toBe(second);
    expect(createProposal).toHaveBeenCalledOnce();
    await act(async () => {
      resolveRequest?.();
      await first;
    });
  });

  it("preserves the caller-owned draft and allows retry after failure", async () => {
    const draft = changedDraft();
    createProposal.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useSubmitWorkItemGraphProposal(), { wrapper });
    const submitInput = {
      organizationId: "org-1",
      projectId: "project-1",
      eli5: "Changes this workflow graph.",
      root,
      graphCapability,
      draft,
    };

    await act(async () => {
      await expect(result.current.submit(submitInput)).rejects.toThrow(
        "offline"
      );
    });
    expect(draft.operations).toBe(operations);
    expect(result.current.error).toEqual(new Error("offline"));

    await act(() => result.current.submit(submitInput));
    expect(createProposal).toHaveBeenCalledTimes(2);
    expect(draft.operations).toBe(operations);
  });

  it("reuses the same path for a non-workflow configured graph type", async () => {
    const configuredRoot = { ...root, type: "journey_map", name: "Journey" };
    const configuredCapability = {
      ...graphCapability,
      nodeChildType: "journey_stage",
    };
    const draft = changedDraft();
    const { result } = renderHook(() => useSubmitWorkItemGraphProposal(), { wrapper });

    await act(() =>
      result.current.submit({
        organizationId: "org-1",
        projectId: "project-1",
        eli5: "Changes this workflow graph.",
        root: configuredRoot,
        graphCapability: configuredCapability,
        draft,
      })
    );

    expect(createProposal).toHaveBeenCalledOnce();
    expect(
      createProposal.mock.calls[0]?.[0]?.createProposalRequestDto
    ).toMatchObject({
      targetEntityId: "root-1",
      targetEntityType: "TASK",
      updates: { operations },
    });
  });
});
