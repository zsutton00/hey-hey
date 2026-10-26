import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import type { FeatureRequirementRecord } from "../../../utils/structuredRequirements";
import { TaskUpdateRenderer } from "../TaskUpdateRenderer";
import { ProposalReconciliationReview } from "../../ProposalReconciliation/ProposalReconciliationReview";
import { proposalsClient } from "../../../clients/serviceClients";
import type { ProposalReconciliationState } from "../../../api";
import type { UpdateTaskProposalUpdates } from "../types";

const { featureLookup } = vi.hoisted(() => ({
  featureLookup: { isLoading: false, isReady: true, get: () => undefined },
}));
vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => featureLookup,
}));

vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    feature: ({ featureId }: { featureId: string }) => `/features/${featureId}`,
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
  }),
}));

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: undefined }),
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isLoading: false, error: null }),
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({
    mention,
  }: {
    mention: { entityId: string; entityType: string; entityName: string };
  }) => (
    <span
      data-testid="mention-badge"
      data-mention-token={`@[${mention.entityType}:${mention.entityId}|${mention.entityName}]`}
      data-entity-id={mention.entityId}
      data-entity-type={mention.entityType}
      data-entity-name={mention.entityName}
    >
      {mention.entityName}
    </span>
  ),
}));

vi.mock("../ProposalHeader", () => ({
  ProposalHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("../ProposalStateIndicator", () => ({
  ProposalStateIndicator: () => <div data-testid="proposal-state" />,
}));

vi.mock("../ProposalEdges", () => ({
  ProposalEdges: () => null,
}));

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    getProposalReconciliation: vi.fn(),
    createProposalReconciliationCandidate: vi.fn(),
  },
}));
vi.mock("../../../data/hooks/useInvalidateProposalReview", () => ({
  useInvalidateProposalReview: () => vi.fn(),
}));
vi.mock("../../../data/hooks/useMentionEntitySearch", () => ({
  useMentionEntitySearch: () => ({ searchEntities: vi.fn() }),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({ workItemTypeSummary: undefined }),
  useWorkItemTypes: () => ({
    workItemTypes: [{ definition }],
    isLoading: false,
    error: null,
  }),
}));

const id = (last: string): string =>
  `00000000-0000-4000-8000-00000000000${last}`;

const definition: WorkItemTypeDefinitionDto = {
  key: "FEATURE",
  name: "Feature",
  sections: [
    {
      key: "requirements",
      label: "Requirements",
      kind: "json",
      schemaRef: "#/components/schemas/FeatureRequirementsSection",
    },
  ],
  allowedStatuses: [],
};

const requirement = (
  recordId: string,
  statement: string,
  group?: string,
  overrides: Partial<FeatureRequirementRecord> = {},
): FeatureRequirementRecord => ({
  id: recordId,
  statement,
  ...(group === undefined ? {} : { group }),
  designedBy: [],
  fulfilledBy: [],
  contracts: [],
  ...overrides,
});

const sectionContent = (records: readonly FeatureRequirementRecord[]): string =>
  JSON.stringify({ records });

const materializedRequirements = (
  records: readonly FeatureRequirementRecord[],
) => ({
  id: id("9"),
  key: "requirements",
  order: 0,
  materializedMarkdown: sectionContent(records),
  materializedProposalId: id("8"),
});

const existingRecords = [
  requirement(id("1"), "One", "Access", {
    fulfilledBy: [
      {
        entityType: "TASK",
        entityId: id("2"),
        entityTitle: `Title ${id("2")}`,
      },
    ],
  }),
  requirement(id("3"), "Two", "Billing", {
    fulfilledBy: [
      {
        entityType: "TASK",
        entityId: id("4"),
        entityTitle: `Title ${id("4")}`,
      },
    ],
  }),
];

const existing = {
  id: id("6"),
  name: "Feature",
  type: "FEATURE",
  organizationId: "org-1",
  projectId: "project-1",
  sections: [materializedRequirements(existingRecords)],
} as unknown as TaskResponseDto;

const makeProposal = (
  records: readonly FeatureRequirementRecord[] | undefined,
): ProposalResponseDto & { updates: UpdateTaskProposalUpdates } => ({
  id: id("7"),
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status: ProposalStatus.Pending,
  targetEntityId: id("6"),
  targetEntityType: TargetEntityType.Task,
  updates:
    records === undefined
      ? {}
      : {
          sections: [
            {
              key: "requirements",
              content: sectionContent(records),
            },
          ],
        },
});

const renderProposal = (
  proposal: ProposalResponseDto & { updates: UpdateTaskProposalUpdates },
  current = existing,
) =>
  render(
    <MemoryRouter>
      <TaskUpdateRenderer
        proposal={proposal}
        existing={current}
        status={{ state: "pending" }}
        onApply={() => {}}
        workItemTypeDefinition={definition}
      />
    </MemoryRouter>,
  );

describe("TaskUpdateRenderer structured requirements", () => {
  it("renders simultaneous statement, citation, and group changes on one UUID", () => {
    renderProposal(
      makeProposal([
        requirement(id("1"), "One updated", "Identity", {
          fulfilledBy: [
            {
              entityType: "PLAN",
              entityId: id("5"),
              entityTitle: `Title ${id("5")}`,
            },
          ],
        }),
        existingRecords[1],
      ]),
    );

    const current = screen.getByTestId("structured-requirements-current");
    const proposed = screen.getByTestId("structured-requirements-proposed");
    expect(
      current.querySelector(`[data-requirement-id="${id("1")}"]`),
    ).toHaveAttribute("data-requirement-change", "group-changed");
    expect(
      proposed.querySelector(`[data-requirement-id="${id("1")}"]`),
    ).toHaveAttribute("data-requirement-change", "group-changed");
    expect(proposed).toHaveTextContent("Identity");
    expect(proposed).toHaveTextContent("One updated");
    expect(
      proposed.querySelector(`[data-entity-id="${id("5")}"]`),
    ).toBeInTheDocument();
    expect(screen.queryByText("legacy")).not.toBeInTheDocument();
  });

  it("uses stored UUIDs for added, removed, and reordered records", () => {
    const added = requirement(id("a"), "Three added", "Billing");
    renderProposal(
      makeProposal([existingRecords[1], added, existingRecords[0]]),
    );

    const diff = screen.getByTestId("structured-requirements-diff");
    expect(
      diff.querySelector(`[data-requirement-id="${added.id}"]`),
    ).toHaveAttribute("data-requirement-change", "added");

    fireEvent.click(
      screen.getByTestId("structured-requirements-diff-show-all"),
    );
    expect(
      diff.querySelector(`[data-requirement-id="${existingRecords[0].id}"]`),
    ).toHaveAttribute("data-requirement-change", "unchanged");
    expect(
      diff.querySelector(`[data-requirement-id="${existingRecords[1].id}"]`),
    ).toHaveAttribute("data-requirement-change", "unchanged");
    expect(screen.queryByText("Requirements")).not.toBeInTheDocument();
  });

  it("keeps omitted updates separate from an explicit empty replacement", () => {
    const omitted = renderProposal(makeProposal(undefined));
    expect(
      screen.queryByTestId("structured-requirements-diff"),
    ).not.toBeInTheDocument();
    omitted.unmount();

    renderProposal(makeProposal([]));
    expect(
      screen.getByTestId("structured-requirements-diff"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByTestId("structured-requirements-proposed")
        .querySelector('[data-testid="structured-requirements"]'),
    ).toHaveAttribute("data-requirement-count", "0");
  });

  it("does not reconstruct or render legacy markdown as canonical requirements", () => {
    const proposal = makeProposal(undefined);
    proposal.updates.sections = [
      { key: "requirements", content: "- legacy markdown" },
    ];
    renderProposal(proposal);

    expect(
      screen.getByTestId("feature-requirements-invalid"),
    ).toBeInTheDocument();
    expect(screen.queryByText("legacy markdown")).not.toBeInTheDocument();
  });

  describe("hiding unchanged requirements", () => {
    const ungrouped = requirement(id("b"), "Ungrouped kept");
    const ungroupedToo = requirement(id("c"), "Ungrouped also kept");
    const manyExisting = [...existingRecords, ungrouped, ungroupedToo];
    const manyCurrent = {
      ...existing,
      sections: [materializedRequirements(manyExisting)],
    } as unknown as TaskResponseDto;

    const hiddenCounts = (container: HTMLElement) =>
      Array.from(
        container.querySelectorAll(
          '[data-testid="structured-requirements-hidden-count"]',
        ),
      ).map((node) => node.textContent);

    it("shows only changed requirements by default in split view", () => {
      renderProposal(
        makeProposal([
          requirement(id("1"), "One updated", "Access", {
            fulfilledBy: existingRecords[0].fulfilledBy,
          }),
          existingRecords[1],
          ungrouped,
          ungroupedToo,
        ]),
        manyCurrent,
      );

      const current = screen.getByTestId("structured-requirements-current");
      const proposed = screen.getByTestId("structured-requirements-proposed");
      expect(
        proposed.querySelector(`[data-requirement-id="${id("1")}"]`),
      ).toHaveAttribute("data-requirement-change", "edited");
      expect(proposed).not.toHaveTextContent("Two");
      expect(proposed).not.toHaveTextContent("Ungrouped kept");
      expect(current).not.toHaveTextContent("Ungrouped also kept");
      expect(hiddenCounts(proposed)).toEqual([
        "1 unchanged requirement hidden",
        "2 unchanged ungrouped requirements hidden",
      ]);
      expect(hiddenCounts(current)).toEqual(hiddenCounts(proposed));
    });

    it("keeps a group whose members are all unchanged with its hidden count", () => {
      renderProposal(
        makeProposal([
          existingRecords[0],
          existingRecords[1],
          ungrouped,
          requirement(id("c"), "Ungrouped also kept, edited"),
        ]),
        manyCurrent,
      );

      const proposed = screen.getByTestId("structured-requirements-proposed");
      const groups = proposed.querySelectorAll(
        '[data-testid="structured-requirements-group"]',
      );
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveAttribute("data-requirement-group", "Access");
      expect(groups[0]).toHaveTextContent("1 unchanged requirement hidden");
      expect(groups[0].querySelector("li")).toBeNull();
    });

    it("keeps a group-only change visible", () => {
      renderProposal(
        makeProposal([
          requirement(id("1"), "One", "Identity", {
            fulfilledBy: existingRecords[0].fulfilledBy,
          }),
          existingRecords[1],
        ]),
      );

      const proposed = screen.getByTestId("structured-requirements-proposed");
      expect(
        proposed.querySelector(`[data-requirement-id="${id("1")}"]`),
      ).toHaveAttribute("data-requirement-change", "group-changed");
      expect(proposed).toHaveTextContent("Identity");
      expect(hiddenCounts(proposed)).toEqual([
        "1 unchanged requirement hidden",
      ]);
    });

    it("hides unchanged requirements in inline view too", () => {
      renderProposal(
        makeProposal([
          requirement(id("1"), "One updated", "Access", {
            fulfilledBy: existingRecords[0].fulfilledBy,
          }),
          existingRecords[1],
        ]),
      );

      fireEvent.click(screen.getByTestId("diff-renderer-view-mode-inline"));
      const inline = screen.getByTestId("structured-requirements-inline");
      expect(inline.querySelectorAll("li")).toHaveLength(2);
      expect(inline).not.toHaveTextContent("Two");
      expect(hiddenCounts(inline)).toEqual(["1 unchanged requirement hidden"]);
    });

    it("reveals and re-hides unchanged requirements with the toggle", () => {
      renderProposal(
        makeProposal([
          requirement(id("1"), "One updated", "Access", {
            fulfilledBy: existingRecords[0].fulfilledBy,
          }),
          existingRecords[1],
        ]),
      );

      const toggle = screen.getByTestId(
        "structured-requirements-diff-show-all",
      );
      expect(toggle).toHaveTextContent("Show all");
      expect(
        screen.getByTestId("structured-requirements-diff").lastElementChild,
      ).toContainElement(toggle);
      fireEvent.click(toggle);

      const proposed = screen.getByTestId("structured-requirements-proposed");
      expect(proposed).toHaveTextContent("Two");
      expect(hiddenCounts(proposed)).toEqual([]);
      expect(toggle).toHaveTextContent("Hide unchanged");

      fireEvent.click(toggle);
      expect(proposed).not.toHaveTextContent("Two");
      expect(hiddenCounts(proposed)).toEqual([
        "1 unchanged requirement hidden",
      ]);
    });

    it("shows no count or control when nothing is unchanged", () => {
      renderProposal(
        makeProposal([
          requirement(id("1"), "One updated", "Access", {
            fulfilledBy: existingRecords[0].fulfilledBy,
          }),
          requirement(id("3"), "Two updated", "Billing", {
            fulfilledBy: existingRecords[1].fulfilledBy,
          }),
        ]),
      );

      expect(
        screen.queryByTestId("structured-requirements-diff-show-all"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("structured-requirements-hidden-count"),
      ).not.toBeInTheDocument();
    });

    it("keeps the invalid-requirements error instead of hiding anything", () => {
      const proposal = makeProposal(undefined);
      proposal.updates.sections = [
        { key: "requirements", content: "- legacy markdown" },
      ];
      renderProposal(proposal);

      expect(
        screen.getByTestId("feature-requirements-invalid"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("structured-requirements-diff-show-all"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("structured-requirements-hidden-count"),
      ).not.toBeInTheDocument();
    });
  });
});

it("edits a future's structured overlap by hand and shows the complete revised result against current content", async () => {
  const updates = makeProposal([
    requirement(id("1"), "Future wording", "Access", {
      fulfilledBy: existingRecords[0].fulfilledBy,
    }),
    existingRecords[1],
  ]);
  const result = {
    ...existing,
    sections: [
      materializedRequirements([
        requirement(id("1"), "Future wording", "Access", {
          fulfilledBy: existingRecords[0].fulfilledBy,
        }),
        existingRecords[1],
      ]),
    ],
  };
  const future = {
    ...updates,
    action: "VERSIONED_UPDATE",
    status: "APPROVED",
    reviewedFuture: { outcome: "STAGED" },
    updates: {
      operation: "REVISE",
      baseline: { content: existing },
      result,
    },
  } as unknown as ProposalResponseDto;
  const basis = {
    entityType: "TASK" as const,
    entityId: existing.id,
    version: "current",
    content: {
      name: existing.name,
      type: "FEATURE",
      sections: { requirements: { records: existingRecords } },
      sectionOrder: { requirements: 0 },
    },
  };
  const state: ProposalReconciliationState = {
    status: "RECONCILIATION_REQUIRED",
    futureRevision: 3,
    currentBases: [basis],
    candidateRevisionId: "original",
    conflictingPaths: ["sections.requirements.records"],
    interveningProposals: [],
    overlaps: [
      {
        path: "sections.requirements.records",
        currentValue: existingRecords,
        proposedValue: JSON.parse(result.sections[0].materializedMarkdown)
          .records,
      },
    ],
    revisions: [
      {
        id: "original",
        proposalId: future.id,
        source: "ORIGINAL",
        bases: [basis],
        proposedResult: result,
        intent: "Readable future",
        createdAt: "2026-10-25T00:00:00Z",
      },
    ],
  };
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
    data: { data: state },
  } as never);
  vi.mocked(
    proposalsClient.createProposalReconciliationCandidate,
  ).mockImplementation(
    async (request) =>
      ({
        data: {
          data: {
            ...state,
            status: "READY_FOR_REVIEW",
            overlaps: [],
            conflictingPaths: [],
            candidateRevisionId: "resolved",
            revisions: [
              ...state.revisions,
              {
                ...state.revisions[0],
                id: "resolved",
                source: "MANUAL",
                proposedResult:
                  request.createProposalReconciliationCandidate.proposedResult,
              },
            ],
          },
        },
      }) as never,
  );
  const apply = vi.fn();
  render(
    <MemoryRouter>
      <ProposalReconciliationReview proposal={future} onApply={apply}>
        <TaskUpdateRenderer
          proposal={updates}
          existing={existing}
          status={{ state: "pending" }}
          onApply={apply}
          workItemTypeDefinition={definition}
        />
      </ProposalReconciliationReview>
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
  );
  const editable = screen
    .getAllByTestId("requirement-statement-input")
    .find((node) => !(node as HTMLTextAreaElement).disabled)!;
  fireEvent.change(editable, {
    target: { value: "Reviewed wording preserves current work" },
  });
  fireEvent.click(screen.getByTestId("proposal-reconciliation-manual-save"));
  await waitFor(() =>
    expect(
      screen.queryByTestId("proposal-reconciliation-manual-editor"),
    ).toBeNull(),
  );
  const diff = screen.getByTestId("structured-requirements-diff");
  expect(
    diff.querySelector('[data-testid="structured-requirements-current"]'),
  ).toHaveTextContent("One");
  expect(
    diff.querySelector('[data-testid="structured-requirements-proposed"]'),
  ).toHaveTextContent("Reviewed wording preserves current work");
  expect(
    diff.querySelector(`[data-entity-id="${id("2")}"]`),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("proposal-reconciliation-overlap")).toBeNull();
  expect(
    proposalsClient.createProposalReconciliationCandidate,
  ).toHaveBeenCalledWith(
    expect.objectContaining({
      createProposalReconciliationCandidate: expect.objectContaining({
        method: "MANUAL",
        expectedFutureRevision: 3,
        expectedCurrentBases: [basis],
      }),
    }),
  );
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("structured-requirements-diff-show-all"));
  expect(
    screen.getByTestId("structured-requirements-proposed"),
  ).toHaveTextContent("Two");
  fireEvent.click(screen.getByTestId("diff-renderer-view-mode-inline"));
  expect(
    screen.getByTestId("structured-requirements-inline"),
  ).toHaveTextContent("Reviewed wording preserves current work");
});
