import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeType,
  EntityType,
  ProjectRole,
  ReportType,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeScalarField,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import type {
  UseCreateWorkItemTypeOptions,
  CreateWorkItemTypeVariables,
} from "@hey-hey/ui-common/data";
import { buildWorkItemTypeRelationshipIndex } from "@hey-hey/ui-common/data";
import type {
  ProposalResponseDto,
  WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import { WorkItemTypeFormPage } from "./WorkItemTypeFormPage";

const mockNavigate = vi.fn();
const mockCreateMutate =
  vi.fn<(vars: CreateWorkItemTypeVariables) => Promise<ProposalResponseDto>>();
const mockUseWorkItemTypes = vi.fn();
const mockUseWorkItemTypeRelationshipIndex = vi.fn();
const mockUseWorkItemTypeByKey = vi.fn();
const mockAnalyzeWorkItemTypeEdit = vi.fn();
const mockEditMutate = vi.fn();
const mockArchiveMutate = vi.fn();
const mockResetMutate = vi.fn();
const mockHardDeleteMutate = vi.fn();
const mockCascadeImpact = vi.fn();
const mockSectionImpact = vi.fn();
const mockTrackingImpact = vi.fn();
const mockRefetchWorkItemTypes = vi.fn();
const mockRefetchWorkItemType = vi.fn();
let mockTypeKey: string | undefined;
let mockCurrentOrgId: string | undefined;
let mockProjectRole: ProjectRole;
let capturedEditOptions: UseCreateWorkItemTypeOptions | undefined;
let capturedArchiveOptions: UseCreateWorkItemTypeOptions | undefined;
let capturedResetOptions: UseCreateWorkItemTypeOptions | undefined;
let capturedHardDeleteOptions: UseCreateWorkItemTypeOptions | undefined;

// Capture the callbacks the form wires into each mutation so mocked requests
// exercise the same success and failure handling as production.
let capturedCreateOptions: UseCreateWorkItemTypeOptions | undefined;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ projectId: "proj-1", typeKey: mockTypeKey }),
  };
});

vi.mock("@hey-hey/ui-common/data", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/data")
  >("@hey-hey/ui-common/data");
  return {
    ...actual,
    analyzeWorkItemTypeEdit: (
      ...args: Parameters<typeof actual.analyzeWorkItemTypeEdit>
    ) => {
      mockAnalyzeWorkItemTypeEdit(...args);
      return actual.analyzeWorkItemTypeEdit(...args);
    },
    useCreateWorkItemType: (options: UseCreateWorkItemTypeOptions) => {
      capturedCreateOptions = options;
      return {
        mutate: mockCreateMutate,
        isPending: false,
        isSuccess: false,
        isError: false,
        error: null,
      };
    },
    useWorkItemTypes: (...args: unknown[]) => mockUseWorkItemTypes(...args),
    useProject: () => ({
      data: { name: "Example Project", currentUserRole: mockProjectRole },
    }),
    useWorkItemTypeRelationshipIndex: (...args: unknown[]) =>
      mockUseWorkItemTypeRelationshipIndex(...args),
    useWorkItemTypeByKey: (...args: unknown[]) =>
      mockUseWorkItemTypeByKey(...args),
    useEditWorkItemType: (options: UseCreateWorkItemTypeOptions) => {
      capturedEditOptions = options;
      return { mutate: mockEditMutate, isPending: false };
    },
    useArchiveWorkItemType: (options: UseCreateWorkItemTypeOptions) => {
      capturedArchiveOptions = options;
      return { mutate: mockArchiveMutate, isPending: false };
    },
    useResetWorkItemType: (options: UseCreateWorkItemTypeOptions) => {
      capturedResetOptions = options;
      return { mutate: mockResetMutate, isPending: false };
    },
    useHardDeleteWorkItemType: (options: UseCreateWorkItemTypeOptions) => {
      capturedHardDeleteOptions = options;
      return { mutate: mockHardDeleteMutate, isPending: false };
    },
    useWorkItemTypeCascadeImpact: (...args: unknown[]) =>
      mockCascadeImpact(...args),
    useWorkItemTypeSectionContentImpact: (...args: unknown[]) =>
      mockSectionImpact(...args),
    useWorkItemTypeTrackingLinkRevocationImpact: (...args: unknown[]) =>
      mockTrackingImpact(...args),
  };
});

vi.mock("@hey-hey/ui-common/hooks", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/hooks")
  >("@hey-hey/ui-common/hooks");
  return {
    ...actual,
    useUserIdentity: () => ({ currentOrgId: mockCurrentOrgId }),
  };
});

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: ({
    items,
  }: {
    items: Array<{ label: string; to?: string; isCurrent?: boolean }>;
  }) => (
    <nav aria-label="breadcrumb" data-testid="breadcrumbs">
      {items.map((item, index) => (
        <div
          key={index}
          data-testid={`breadcrumbs-item-${index}`}
          data-current={item.isCurrent ? "true" : undefined}
          data-to={item.to}
        >
          {item.label}
        </div>
      ))}
    </nav>
  ),
}));

function renderForm() {
  return render(
    <MemoryRouter>
      <WorkItemTypeFormPage />
    </MemoryRouter>,
  );
}

/** Type into the input nested inside a MUI TextField identified by its testid. */
function fillField(testId: string, value: string): void {
  const input = screen
    .getByTestId(testId)
    .querySelector(
      'input:not([aria-hidden="true"]), textarea:not([aria-hidden="true"])',
    );
  if (!input) throw new Error(`Missing editable field: ${testId}`);
  fireEvent.change(input, { target: { value } });
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("tab", { name }));
}

function selectTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

function activeCustomSummary(
  definition: WorkItemTypeSummaryDto["definition"],
): WorkItemTypeSummaryDto {
  return {
    id: `type-${definition.key}`,
    status: WorkItemTypeLifecycleStatus.Active,
    projectId: "proj-1",
    effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
    definition: {
      ...definition,
      tracking: definition.tracking ?? {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      },
    },
  };
}

function canonicalSummary(
  definition: WorkItemTypeSummaryDto["definition"],
  status: WorkItemTypeLifecycleStatus = WorkItemTypeLifecycleStatus.Active,
): WorkItemTypeSummaryDto {
  return {
    ...activeCustomSummary(definition),
    status,
    effectiveSource: WorkItemTypeEffectiveSource.CanonicalOverride,
  };
}

function builtInCanonicalSummary(
  definition: WorkItemTypeSummaryDto["definition"],
): WorkItemTypeSummaryDto {
  return {
    ...activeCustomSummary(definition),
    effectiveSource: WorkItemTypeEffectiveSource.Canonical,
  };
}

function prepareArchivedCustomEdit(): WorkItemTypeSummaryDto {
  mockTypeKey = "CUSTOM";
  const summary = {
    ...activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    }),
    status: WorkItemTypeLifecycleStatus.Archived,
  };
  mockUseWorkItemTypeByKey.mockReturnValue({
    workItemTypeSummary: summary,
    isLoading: false,
    error: null,
  });
  mockUseWorkItemTypes.mockReturnValue({
    workItemTypes: [summary],
    isLoading: false,
  });
  return summary;
}

describe("WorkItemTypeFormPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCreateOptions = undefined;
    capturedEditOptions = undefined;
    capturedArchiveOptions = undefined;
    capturedResetOptions = undefined;
    capturedHardDeleteOptions = undefined;
    mockTypeKey = undefined;
    mockCurrentOrgId = "org-1";
    mockProjectRole = ProjectRole.Owner;
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [],
      isLoading: false,
      refetch: mockRefetchWorkItemTypes,
    });
    mockUseWorkItemTypeRelationshipIndex.mockImplementation(
      (organizationId: string | undefined, projectId: string | undefined) => {
        const query = mockUseWorkItemTypes(organizationId, { projectId });
        return {
          ...query,
          isFetching: query.isFetching ?? false,
          isReady: query.isReady ?? !query.error,
          error: query.error ?? null,
          relationshipIndex: buildWorkItemTypeRelationshipIndex(
            query.workItemTypes,
          ),
        };
      },
    );
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetchWorkItemType,
    });
    mockRefetchWorkItemTypes.mockResolvedValue([]);
    mockRefetchWorkItemType.mockResolvedValue(null);
    mockCascadeImpact.mockImplementation(
      (
        _organizationId: string | undefined,
        _projectId: string | undefined,
        _typeKey: string | undefined,
        enabled: boolean,
      ) => ({
        data: enabled ? { itemCount: 12, edgeCount: 7 } : null,
        isLoading: false,
        isFetching: false,
        isFetched: enabled,
        isReady: enabled,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    );
    mockSectionImpact.mockImplementation(
      (
        _organizationId: string | undefined,
        _projectId: string | undefined,
        _typeKey: string | undefined,
        removedSectionKeys: readonly string[] | undefined,
        options: { enabled?: boolean } | undefined,
      ) => ({
        data:
          options?.enabled &&
          removedSectionKeys &&
          removedSectionKeys.length > 0
            ? {
                totalAffectedItemCount: 3,
                sections: removedSectionKeys.map((sectionKey) => ({
                  sectionKey,
                  affectedItemCount: sectionKey === "details" ? 2 : 1,
                })),
              }
            : null,
        isLoading: false,
        isFetching: false,
        isFetched: Boolean(options?.enabled),
        isReady: Boolean(options?.enabled),
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    );
    mockTrackingImpact.mockImplementation(
      (
        _organizationId: string | undefined,
        _projectId: string | undefined,
        _typeKey: string | undefined,
        revokedSourceKeys: readonly string[] | undefined,
        options: { enabled?: boolean } | undefined,
      ) => ({
        data:
          options?.enabled && revokedSourceKeys && revokedSourceKeys.length > 0
            ? {
                totalAffectedLinkCount: 4,
                sources: revokedSourceKeys.map((sourceTypeKey) => ({
                  sourceTypeKey,
                  affectedLinkCount: sourceTypeKey === "BUG" ? 4 : 1,
                })),
              }
            : null,
        isLoading: false,
        isFetching: false,
        isFetched: Boolean(options?.enabled),
        isReady: Boolean(options?.enabled),
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    );
    // Default: mutate resolves to a proposal and drives onSuccess, mirroring the
    // production hook so a submit exercises the form's full success path.
    mockCreateMutate.mockImplementation(async (vars) => {
      const proposal = {
        id: "prop-1",
        projectId: vars.projectId,
      } as ProposalResponseDto;
      capturedCreateOptions?.onSuccess?.(proposal);
      return proposal;
    });
    mockEditMutate.mockImplementation(async (vars) => {
      const proposal = {
        id: "edit-prop-1",
        projectId: vars.projectId,
      } as ProposalResponseDto;
      capturedEditOptions?.onSuccess?.(proposal);
      return proposal;
    });
    mockArchiveMutate.mockImplementation(async (vars) => {
      const proposal = {
        id: "archive-prop-1",
        projectId: vars.projectId,
      } as ProposalResponseDto;
      capturedArchiveOptions?.onSuccess?.(proposal);
      return proposal;
    });
    mockResetMutate.mockImplementation(async (vars) => {
      const proposal = {
        id: "reset-prop-1",
        projectId: vars.projectId,
      } as ProposalResponseDto;
      capturedResetOptions?.onSuccess?.(proposal);
      return proposal;
    });
    mockHardDeleteMutate.mockImplementation(async (vars) => {
      const proposal = {
        id: "hard-delete-prop-1",
        projectId: vars.projectId,
      } as ProposalResponseDto;
      capturedHardDeleteOptions?.onSuccess?.(proposal);
      return proposal;
    });
  });

  it("shows project chrome breadcrumbs on the create route", () => {
    renderForm();

    expect(screen.getByTestId("breadcrumbs-item-1")).toHaveTextContent(
      "Example Project",
    );
    expect(screen.getByTestId("breadcrumbs-item-2")).toHaveTextContent(
      "Work Item Types",
    );
    expect(screen.getByTestId("breadcrumbs-item-2")).toHaveAttribute(
      "data-to",
      "/projects/proj-1?tab=settings&settingsSubTab=types&typesSubTab=work-item-types",
    );
    expect(screen.getByTestId("breadcrumbs-item-3")).toHaveTextContent(
      "Define a work-item type",
    );
    expect(screen.getByTestId("breadcrumbs-item-3")).toHaveAttribute(
      "data-current",
      "true",
    );
  });

  it("shows the edited type in project chrome", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();

    expect(screen.getByTestId("breadcrumbs-item-3")).toHaveTextContent(
      "Custom work",
    );
  });

  it("offers labeled icon previews from the closed palette and submits the selection", async () => {
    const user = userEvent.setup();
    renderForm();
    fillField("wit-form-key", "CUSTOM");
    fillField("wit-form-name", "Custom work");

    const iconSelect = screen.getByRole("combobox", { name: "Icon" });
    fireEvent.mouseDown(iconSelect);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "No icon",
      "Task",
      "Bug",
      "Feature",
      "Goal",
      "Contract",
      "Design doc",
      "Decision",
      "Diagram",
      "Plan",
      "Plan stage",
      "Star",
      "Flag",
      "Folder",
      "Book",
      "Lightbulb",
      "Science",
      "Code",
      "Database",
      "Link",
      "People",
      "Chat",
      "Calendar",
      "Timer",
      "Chart",
      "Shield",
    ]);
    expect(
      options.slice(1).every((option) => option.querySelector("svg") !== null),
    ).toBe(true);
    const bugOption = screen.getByRole("option", { name: "Bug" });
    await user.click(bugOption);

    await openTab(user, "Content");
    await openTab(user, "Overview");
    expect(iconSelect).toHaveTextContent("Bug");
    await user.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate.mock.calls[0][0].definition.iconKey).toBe("bug");
    expect(screen.getByTestId("wit-form-proposal-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/proposals/prop-1",
    );
  });

  it("selects an independent custom color and preserves it across tabs and submission", async () => {
    const user = userEvent.setup();
    renderForm();
    fillField("wit-form-key", "CUSTOM");
    fillField("wit-form-name", "Custom work");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Icon" }));
    await user.click(screen.getByRole("option", { name: "Star" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Color" }));
    await user.click(screen.getByRole("option", { name: "Purple" }));
    expect(
      screen.getByTestId("wit-form-presentation-preview"),
    ).toBeInTheDocument();
    await openTab(user, "Content");
    await openTab(user, "Overview");
    expect(screen.getByRole("combobox", { name: "Color" })).toHaveTextContent(
      "Purple",
    );
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(mockCreateMutate.mock.calls[0][0].definition).toMatchObject({
      iconKey: "star",
      colorKey: "secondary",
    });
  });


  it("preserves the color draft while submission is pending and after rejection", async () => {
    const user = userEvent.setup();
    renderForm();
    fillField("wit-form-key", "CUSTOM");
    fillField("wit-form-name", "Custom work");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Color" }));
    await user.click(screen.getByRole("option", { name: "Green" }));
    let rejectSubmission: ((reason: Error) => void) | undefined;
    mockCreateMutate.mockImplementation(() => new Promise((_resolve, reject) => { rejectSubmission = reject; }));
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(mockCreateMutate.mock.calls[0][0].definition.colorKey).toBe("success");
    expect(screen.queryByTestId("wit-form-proposal-link")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Color" })).toHaveTextContent("Green");
    const failure = new Error("Color proposal rejected");
    await act(async () => {
      capturedCreateOptions?.onError?.(failure);
      rejectSubmission?.(failure);
    });
    expect(screen.getByText("Color proposal rejected")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Color" })).toHaveTextContent("Green");
    mockCreateMutate.mockImplementation(async (vars) => {
      const proposal = { id: "retry-proposal", projectId: vars.projectId } as ProposalResponseDto;
      capturedCreateOptions?.onSuccess?.(proposal);
      return proposal;
    });
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(screen.getByTestId("wit-form-proposal-link")).toHaveAttribute("href", "/projects/proj-1/proposals/retry-proposal");
    expect(mockCreateMutate.mock.calls[1][0].definition.colorKey).toBe("success");
  });

  it.each(["unchanged", "change", "clear"] as const)(
    "submits a complete custom color definition on %s",
    (action) => {
      mockTypeKey = "CUSTOM";
      const summary = activeCustomSummary({
        key: "CUSTOM",
        name: "Custom work",
        role: "work-item",
        iconKey: "bug",
        colorKey: "primary",
        sections: [],
        allowedStatuses: [],
      });
      mockUseWorkItemTypeByKey.mockReturnValue({
        workItemTypeSummary: summary,
        isLoading: false,
        error: null,
      });
      mockUseWorkItemTypes.mockReturnValue({
        workItemTypes: [summary],
        isLoading: false,
      });
      renderForm();
      if (action !== "unchanged") {
        fireEvent.mouseDown(screen.getByRole("combobox", { name: "Color" }));
        fireEvent.click(
          screen.getByRole("option", {
            name: action === "clear" ? "Default" : "Red",
          }),
        );
      }
      fireEvent.click(screen.getByTestId("wit-form-submit"));
      const submitted = mockEditMutate.mock.calls[0][0].definition;
      if (action === "clear") expect(submitted).not.toHaveProperty("colorKey");
      else
        expect(submitted.colorKey).toBe(
          action === "change" ? "error" : "primary",
        );
    },
  );

  it.each([
    WorkItemTypeEffectiveSource.Canonical,
    WorkItemTypeEffectiveSource.CanonicalOverride,
  ])("hides color authoring for %s", (effectiveSource) => {
    mockTypeKey = "BUG";
    const summary = {
      ...activeCustomSummary({
        key: "BUG",
        name: "Bug",
        role: "work-item",
        iconKey: "bug",
        sections: [],
        allowedStatuses: [],
      }),
      effectiveSource,
    };
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });
    renderForm();
    expect(
      screen.queryByRole("combobox", { name: "Color" }),
    ).not.toBeInTheDocument();
  });

  it("does not submit an icon name outside the closed palette", () => {
    renderForm();
    fillField("wit-form-key", "CUSTOM");
    fillField("wit-form-name", "Custom work");

    const iconField = screen.getByTestId("wit-form-icon-field");
    const iconInput = iconField.querySelector("input");
    if (!iconInput) throw new Error("Missing work-item icon input");
    fireEvent.change(iconInput, { target: { value: "not-a-work-item-icon" } });
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate.mock.calls[0][0].definition).not.toHaveProperty(
      "iconKey",
    );
  });

  it("clears a saved icon from the edit proposal", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      iconKey: "bug",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });
    renderForm();

    const iconSelect = screen.getByRole("combobox", { name: "Icon" });
    expect(iconSelect).toHaveTextContent("Bug");
    fireEvent.mouseDown(iconSelect);
    fireEvent.click(screen.getByRole("option", { name: "No icon" }));
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate.mock.calls[0][0].definition).not.toHaveProperty(
      "iconKey",
    );
  });

  it("keeps guidance keystrokes out of page renders and impact analysis, then submits the latest draft", async () => {
    const user = userEvent.setup();
    renderForm();
    fillField("wit-form-key", "CUSTOM");
    fillField("wit-form-name", "Custom");
    await openTab(user, "Agent guidance");
    const pageRenders = mockUseWorkItemTypeByKey.mock.calls.length;
    const analyses = mockAnalyzeWorkItemTypeEdit.mock.calls.length;
    await user.click(
      screen.getByRole("button", { name: "Add semantic guidance" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Overview/ }),
      "Latest meaning",
    );
    await user.click(
      screen.getByRole("button", { name: "Add general example" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Example title/ }),
      "Title",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Example guidance/ }),
      "Body",
    );
    expect(mockUseWorkItemTypeByKey).toHaveBeenCalledTimes(pageRenders);
    expect(mockAnalyzeWorkItemTypeEdit).toHaveBeenCalledTimes(analyses);

    await openTab(user, "Overview");
    fillField("wit-form-name", "Renamed");
    await openTab(user, "Agent guidance");
    expect(screen.getByRole("textbox", { name: /Overview/ })).toHaveValue(
      "Latest meaning",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: /Example guidance/ }),
      { target: { value: "Last character!" } },
    );
    fireEvent.submit(screen.getByTestId("wit-form"));
    expect(mockCreateMutate.mock.calls[0][0].definition).toMatchObject({
      name: "Renamed",
      agentGuidance: {
        overview: "Latest meaning",
        examples: [{ title: "Title", guidance: "Last character!" }],
      },
    });
    expect(
      mockAnalyzeWorkItemTypeEdit.mock.lastCall?.[1].agentGuidance,
    ).toEqual(mockCreateMutate.mock.calls[0][0].definition.agentGuidance);
  });

  it("resets local guidance from a refreshed authoritative definition", async () => {
    const user = userEvent.setup();
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      agentGuidance: { overview: "Original" },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });
    const view = renderForm();
    await openTab(user, "Agent guidance");
    await user.type(
      screen.getByRole("textbox", { name: /Overview/ }),
      " local edit",
    );
    const refreshed = {
      ...summary,
      definition: {
        ...summary.definition,
        agentGuidance: { overview: "Authoritative refresh", examples: [] },
      },
    };
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: refreshed,
      isLoading: false,
    });
    view.rerender(
      <MemoryRouter>
        <WorkItemTypeFormPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("textbox", { name: /Overview/ })).toHaveValue(
      "Authoritative refresh",
    );
    fireEvent.submit(screen.getByTestId("wit-form"));
    expect(mockEditMutate.mock.calls[0][0].definition.agentGuidance).toEqual(
      refreshed.definition.agentGuidance,
    );
    await user.click(
      screen.getByRole("button", { name: "Remove semantic guidance" }),
    );
    fireEvent.submit(screen.getByTestId("wit-form"));
    expect(mockEditMutate.mock.calls[1][0].definition).not.toHaveProperty(
      "agentGuidance",
    );
  });

  it("authors semantic guidance through the create proposal with named project focal options", async () => {
    const user = userEvent.setup();
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [
        activeCustomSummary({
          key: "FEATURE",
          name: "Product feature",
          role: "project-info",
          sections: [],
          allowedStatuses: [],
        }),
      ],
      isLoading: false,
    });
    renderForm();
    fillField("wit-form-key", "CUSTOM");
    fillField("wit-form-name", "Custom");
    await openTab(user, "Agent guidance");
    await user.click(
      screen.getByRole("button", { name: "Add semantic guidance" }),
    );
    fireEvent.submit(screen.getByTestId("wit-form"));
    expect(mockCreateMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Enter an overview.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agent guidance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /Overview/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Overview/ }),
      " Meaning ",
    );
    await user.click(
      screen.getByRole("button", { name: "Add general example" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Example title/ }),
      "Example",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Example guidance/ }),
      "General body",
    );
    await user.click(
      screen.getByRole("button", { name: "Add contextual guidance" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Contextual guidance/ }),
      "Context body",
    );
    fireEvent.submit(screen.getByTestId("wit-form"));
    expect(mockCreateMutate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Focal types" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Focal types" }));
    await user.click(screen.getByRole("option", { name: "Product feature" }));
    expect(
      screen.getByRole("option", { name: "Product feature" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Add context example" }),
    );
    const context = within(
      screen.getByRole("group", { name: "Contextual guidance 1" }),
    );
    await user.type(
      context.getByRole("textbox", { name: /Example title/ }),
      "Nested",
    );
    await user.type(
      context.getByRole("textbox", { name: /Example guidance/ }),
      "Nested body",
    );
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(mockCreateMutate.mock.calls[0][0].definition.agentGuidance).toEqual({
      overview: " Meaning ",
      examples: [{ title: "Example", guidance: "General body" }],
      contexts: [
        {
          focalTypeKeys: ["FEATURE"],
          guidance: "Context body",
          examples: [{ title: "Nested", guidance: "Nested body" }],
        },
      ],
    });
    expect(mockUseWorkItemTypeRelationshipIndex).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
    );
    expect(screen.getByTestId("wit-form-proposal-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/proposals/prop-1",
    );
  }, 15000);

  it("preserves example order without move controls, reorders contexts, and removes guidance", async () => {
    const user = userEvent.setup();
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      agentGuidance: {
        overview: " Raw overview \n",
        examples: [
          { title: "First", guidance: "One" },
          { title: "Second", guidance: "Two" },
        ],
        contexts: [
          {
            focalTypeKeys: ["MISSING", "CUSTOM"],
            guidance: "First context",
            examples: [
              { title: "Nested first", guidance: "One" },
              { title: "Nested second", guidance: "Two" },
            ],
          },
          {
            focalTypeKeys: ["CUSTOM"],
            guidance: "Second context",
            examples: [],
          },
        ],
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });
    renderForm();
    await openTab(user, "Agent guidance");
    expect(screen.getByText("Unavailable type (MISSING)")).toBeInTheDocument();
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(mockEditMutate.mock.calls[0][0].definition).toEqual(
      summary.definition,
    );
    const firstContext = within(
      screen.getByRole("group", { name: "Contextual guidance 1" }),
    );
    expect(
      firstContext.queryByRole("button", { name: /Move focal type/ }),
    ).not.toBeInTheDocument();
    await user.click(
      firstContext.getByRole("combobox", { name: "Focal types" }),
    );
    expect(screen.getByRole("option", { name: "Custom" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("option", { name: "Unavailable type (MISSING)" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("button", { name: /Move example/ }),
    ).not.toBeInTheDocument();
    await user.click(
      firstContext.getByRole("button", {
        name: "Move contextual guidance down",
      }),
    );
    await user.click(screen.getByTestId("wit-form-submit"));
    const original = summary.definition.agentGuidance!;
    expect(mockEditMutate.mock.calls[1][0].definition).toEqual({
      ...summary.definition,
      agentGuidance: {
        ...original,
        examples: original.examples,
        contexts: [original.contexts![1], original.contexts![0]],
      },
    });
    const secondContext = within(
      screen.getByRole("group", { name: "Contextual guidance 2" }),
    );
    await user.click(
      within(
        secondContext.getByText("Unavailable type (MISSING)").parentElement!,
      ).getByTestId("CancelIcon"),
    );
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(
      mockEditMutate.mock.calls[2][0].definition.agentGuidance.contexts[1]
        .focalTypeKeys,
    ).toEqual(["CUSTOM"]);
    await user.click(
      screen.getByRole("button", { name: "Remove semantic guidance" }),
    );
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(mockEditMutate.mock.calls[3][0].definition).not.toHaveProperty(
      "agentGuidance",
    );
    expect(summary.definition.agentGuidance).toEqual(original);
  });

  it("renders an input for every type-definition axis", () => {
    renderForm();

    // Identity
    expect(screen.getByTestId("wit-form-key")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-name")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-role")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-description")).toBeInTheDocument();

    // Sections & writing standards
    expect(screen.getByTestId("wit-form-add-section")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-section-0")).toBeInTheDocument();

    // Scalar membership — one control per scalar field in the closed set
    for (const field of Object.values(WorkItemTypeScalarField)) {
      expect(
        screen.getByTestId(`wit-form-scalar-membership-${field}`),
      ).toBeInTheDocument();
    }

    // Statuses & agent-settable statuses
    expect(screen.getByTestId("wit-form-statuses")).toBeInTheDocument();
    expect(
      screen.getByTestId("wit-form-agent-settable-statuses"),
    ).toBeInTheDocument();

    // Placement — child-owned parent type keys and parent entity types
    expect(screen.getByTestId("wit-form-parent-types")).toBeInTheDocument();
    expect(
      screen.getByTestId("wit-form-parent-entity-types"),
    ).toBeInTheDocument();

    // Edge targets
    expect(screen.getByTestId("wit-form-add-edge")).toBeInTheDocument();

    // Inbound tracking policy
    expect(
      screen.getByTestId("wit-form-tracking-source-task-types"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("wit-form-tracking-source-entity-types"),
    ).not.toBeInTheDocument();

    // Anchorable report types
    expect(screen.getByTestId("wit-form-report-types")).toBeInTheDocument();

    // Type-level writing standards
    expect(
      screen.getByTestId("wit-form-writing-standard-create"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("wit-form-writing-standard-edit"),
    ).toBeInTheDocument();

    // Capabilities
    expect(screen.getByTestId("wit-form-new-capability")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-add-capability")).toBeInTheDocument();
  });

  it("keeps one draft across tabs and submits visited and unvisited create fields", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Content",
      "Lifecycle",
      "Relationships",
      "Capabilities",
      "Agent guidance",
    ]);

    fillField("wit-form-key", "marketing");
    await openTab(user, "Agent guidance");
    await user.click(screen.getByTestId("wit-form-submit"));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Go to Overview" }),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(
      within(screen.getByTestId("wit-form-name")).getByRole("textbox"),
    );

    fillField("wit-form-name", "Marketing");
    await openTab(user, "Content");
    const section = within(
      screen.getByTestId("wit-form-section-0"),
    ).getAllByRole("textbox");
    fireEvent.change(section[0], { target: { value: "details" } });
    fireEvent.change(section[1], { target: { value: "Details" } });
    fireEvent.change(section[2], { target: { value: "Be specific." } });

    await openTab(user, "Agent guidance");
    fillField("wit-form-writing-standard-create", "Lead with the audience.");
    await user.click(
      screen.getByRole("button", { name: "Add semantic guidance" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Overview/ }),
      "Meaning",
    );
    await openTab(user, "Relationships");
    await openTab(user, "Agent guidance");
    expect(screen.getByRole("textbox", { name: /Overview/ })).toHaveValue(
      "Meaning",
    );
    await openTab(user, "Capabilities");
    await user.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(mockCreateMutate.mock.calls[0][0].definition).toMatchObject({
      key: "MARKETING",
      name: "Marketing",
      sections: [
        { key: "details", label: "Details", writingStandard: "Be specific." },
      ],
      allowedStatuses: [],
      writingStandards: { create: "Lead with the audience.", edit: "" },
      agentGuidance: { overview: "Meaning" },
    });
  });

  it("presents friendly labels and semantic help from the shared catalog", () => {
    renderForm();

    expect(screen.getByLabelText("Purpose")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Explain what work this type represents and when people should use it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Parent types this child may sit beneath. No selection means this type is top-level only.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Behavior the type supports. Structural parentage is declared through allowed parent types.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("wit-form-child-types"),
    ).not.toBeInTheDocument();
  });

  it("shows All for a new relationship and serializes it as any type", () => {
    renderForm();
    fillField("wit-form-key", "marketing");
    fillField("wit-form-name", "Marketing");
    fireEvent.click(screen.getByTestId("wit-form-add-edge"));

    expect(screen.getByTestId("wit-form-edge-targets-0")).toHaveTextContent(
      "All",
    );
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate.mock.calls[0][0].definition.edgeTargets).toEqual([
      {
        edgeType: AgentEdgeType.RelatedTo,
        targetTypeKeys: [],
      },
    ]);
  });

  it("switches relationship targets between All and explicit types", () => {
    const activeType = activeCustomSummary({
      key: "FEATURE",
      name: "Feature",
      role: "project-info",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [activeType],
      isLoading: false,
    });
    renderForm();
    selectTab("Relationships");
    fireEvent.click(screen.getByTestId("wit-form-add-edge"));

    const selector = screen.getByTestId("wit-form-edge-targets-0");
    fireEvent.mouseDown(within(selector).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /FEATURE/ }));
    expect(selector).toHaveTextContent("FEATURE");
    expect(within(selector).queryByText("All")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /^All$/ }));
    expect(within(selector).getByText("All")).toBeInTheDocument();
    expect(selector).not.toHaveTextContent("FEATURE");
  });

  it("offers reset-to-canonical review for an eligible active override", async () => {
    mockTypeKey = "STANDARD";
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: canonicalSummary({
        key: "STANDARD",
        name: "Task",
        role: "work-item",
        description: "Current project task",
        sections: [],
        allowedStatuses: [],
      }),
      isLoading: false,
      error: null,
    });

    renderForm();

    expect(screen.getByTestId("wit-form-template-info")).toHaveTextContent(
      "Canonical definition",
    );
    expect(screen.getByTestId("wit-form-effective-source")).toHaveTextContent(
      "Source: Canonical override",
    );
    fireEvent.click(screen.getByTestId("wit-form-reset-to-canonical"));

    await waitFor(() =>
      expect(mockResetMutate).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "proj-1",
        typeKey: "STANDARD",
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/proj-1/proposals/reset-prop-1",
    );
  });

  it("offers reset-to-canonical review for an eligible archived override without enabling edits", () => {
    mockTypeKey = "STANDARD";
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: canonicalSummary(
        {
          key: "STANDARD",
          name: "Task",
          role: "work-item",
          description: "Archived project task",
          sections: [],
          allowedStatuses: [],
        },
        WorkItemTypeLifecycleStatus.Archived,
      ),
      isLoading: false,
      error: null,
    });

    renderForm();

    expect(
      screen.getByTestId("wit-form-reset-to-canonical"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
    expect(screen.queryByTestId("wit-form-archive")).not.toBeInTheDocument();
  });

  it("renders only the work-item tracking-source selector", () => {
    renderForm();

    expect(
      screen.getByTestId("wit-form-tracking-source-task-types"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("wit-form-tracking-source-entity-types"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose which work-item types may track items of this target type. TRACKS sources are always work items.",
      ),
    ).toBeInTheDocument();
  });

  it("requests active definitions for relationship choices", () => {
    renderForm();

    expect(mockUseWorkItemTypes).toHaveBeenCalledWith("org-1", {
      projectId: "proj-1",
    });
    expect(mockUseWorkItemTypes).toHaveBeenCalledWith("org-1", {
      projectId: "proj-1",
      status: WorkItemTypeLifecycleStatus.Active,
    });
  });

  it("still detects key collisions with retired definitions", () => {
    const retiredType = {
      ...activeCustomSummary({
        key: "RETIRED_TYPE",
        name: "Retired type",
        role: "work-item",
        sections: [],
        allowedStatuses: [],
      }),
      status: WorkItemTypeLifecycleStatus.Archived,
    };
    mockUseWorkItemTypes.mockImplementation(
      (_organizationId, options: { status?: WorkItemTypeLifecycleStatus }) => ({
        workItemTypes: options.status ? [] : [retiredType],
        isLoading: false,
      }),
    );
    renderForm();

    fillField("wit-form-key", "retired_type");

    expect(
      screen.getByText('A type with key "RETIRED_TYPE" already exists.'),
    ).toBeInTheDocument();
  });

  it("offers only active keys for allowed parents", () => {
    const activeType = activeCustomSummary({
      key: "ACTIVE_TYPE",
      name: "Active type",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    const archivedType = {
      ...activeCustomSummary({
        key: "ARCHIVED_TYPE",
        name: "Archived type",
        role: "work-item",
        sections: [],
        allowedStatuses: [],
      }),
      status: WorkItemTypeLifecycleStatus.Archived,
    };
    mockUseWorkItemTypes.mockImplementation(
      (_organizationId, options: { status?: WorkItemTypeLifecycleStatus }) => ({
        workItemTypes: options.status
          ? [activeType]
          : [activeType, archivedType],
        isLoading: false,
      }),
    );
    renderForm();
    selectTab("Relationships");

    fireEvent.mouseDown(
      within(screen.getByTestId("wit-form-parent-types")).getByRole("combobox"),
    );

    expect(
      screen.getByRole("option", { name: /ACTIVE_TYPE/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /ARCHIVED_TYPE/ }),
    ).not.toBeInTheDocument();
  });

  it("uses active keys for edges and authoritative inverse eligibility for tracking sources", () => {
    const allowedSource = activeCustomSummary({
      key: "ALLOWED_SOURCE",
      name: "Allowed source",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    const disallowedSource = activeCustomSummary({
      key: "DISALLOWED_SOURCE",
      name: "Disallowed source",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    const archivedSource = {
      ...activeCustomSummary({
        key: "ARCHIVED_SOURCE",
        name: "Archived source",
        role: "work-item",
        sections: [],
        allowedStatuses: [],
      }),
      status: WorkItemTypeLifecycleStatus.Archived,
    };
    const targetType = activeCustomSummary({
      key: "TRACKING_TARGET",
      name: "Tracking target",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      tracking: {
        allowedSourceEntityTypes: [EntityType.Task],
        allowedSourceTaskTypes: ["ALLOWED_SOURCE", "ARCHIVED_SOURCE"],
      },
    });
    mockUseWorkItemTypes.mockImplementation(
      (_organizationId, options: { status?: WorkItemTypeLifecycleStatus }) => ({
        workItemTypes: options.status
          ? [allowedSource, disallowedSource, targetType]
          : [allowedSource, disallowedSource, archivedSource, targetType],
        isLoading: false,
      }),
    );
    renderForm();
    selectTab("Relationships");

    fireEvent.click(screen.getByTestId("wit-form-add-edge"));
    fireEvent.mouseDown(
      within(screen.getByTestId("wit-form-edge-targets-0")).getByRole(
        "combobox",
      ),
    );
    expect(
      screen.getByRole("option", { name: "ALLOWED_SOURCE" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /DISALLOWED_SOURCE/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /ARCHIVED_SOURCE/ }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    fireEvent.mouseDown(
      within(
        screen.getByTestId("wit-form-tracking-source-task-types"),
      ).getByRole("combobox"),
    );
    expect(
      screen.getByRole("option", { name: "ALLOWED_SOURCE" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /DISALLOWED_SOURCE/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /ARCHIVED_SOURCE/ }),
    ).not.toBeInTheDocument();
  });

  it("authors TASK as the only entity kind when tracking sources are selected", () => {
    const allowedSource = activeCustomSummary({
      key: "GOAL",
      name: "Goal",
      role: "project-info",
      sections: [],
      allowedStatuses: [],
    });
    const existingTarget = activeCustomSummary({
      key: "FEATURE",
      name: "Feature",
      role: "project-info",
      sections: [],
      allowedStatuses: [],
      tracking: {
        allowedSourceEntityTypes: [EntityType.Task],
        allowedSourceTaskTypes: ["GOAL"],
      },
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [allowedSource, existingTarget],
      isLoading: false,
    });
    renderForm();
    selectTab("Relationships");
    fillField("wit-form-key", "deliverable");
    fillField("wit-form-name", "Deliverable");

    fireEvent.mouseDown(
      within(
        screen.getByTestId("wit-form-tracking-source-task-types"),
      ).getByRole("combobox"),
    );
    fireEvent.click(screen.getByRole("option", { name: "GOAL" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate.mock.calls[0][0].definition.tracking).toEqual({
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: ["GOAL"],
    });
  });

  it("fails closed while tracking-source authority is loading", () => {
    mockUseWorkItemTypeRelationshipIndex.mockReturnValue({
      workItemTypes: [],
      isLoading: true,
      isFetching: true,
      isReady: false,
      error: null,
      relationshipIndex: undefined,
      refetch: mockRefetchWorkItemTypes,
    });

    renderForm();

    expect(
      screen.getByTestId("wit-form-tracking-sources-loading"),
    ).toHaveTextContent("Loading eligible tracking source types");
    expect(
      screen.getByTestId("wit-form-tracking-source-task-types"),
    ).toHaveClass("Mui-disabled");
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
  });

  it("fails closed when tracking-source authority is unavailable", () => {
    mockUseWorkItemTypeRelationshipIndex.mockReturnValue({
      workItemTypes: [],
      isLoading: false,
      isFetching: false,
      isReady: false,
      error: new Error("registry unavailable"),
      relationshipIndex: undefined,
      refetch: mockRefetchWorkItemTypes,
    });

    renderForm();

    expect(
      screen.getByTestId("wit-form-tracking-sources-unavailable"),
    ).toHaveTextContent("Tracking changes cannot be submitted");
    expect(
      screen.getByTestId("wit-form-tracking-source-task-types"),
    ).toHaveClass("Mui-disabled");
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
  });

  it("shows an eligibility-specific empty state for an authoritative empty index", () => {
    renderForm();
    selectTab("Relationships");

    fireEvent.mouseDown(
      within(
        screen.getByTestId("wit-form-tracking-source-task-types"),
      ).getByRole("combobox"),
    );

    expect(
      screen.getByRole("option", {
        name: "No eligible tracking source types",
      }),
    ).toBeInTheDocument();
  });

  it("removes a deleted key from relationship choices after the registry refetch", () => {
    const activeType = activeCustomSummary({
      key: "ACTIVE_TYPE",
      name: "Active type",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    const deletedType = activeCustomSummary({
      key: "DELETED_TYPE",
      name: "Deleted type",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [activeType, deletedType],
      isLoading: false,
    });
    const { rerender } = render(
      <MemoryRouter>
        <WorkItemTypeFormPage />
      </MemoryRouter>,
    );
    selectTab("Relationships");

    fireEvent.mouseDown(
      within(screen.getByTestId("wit-form-parent-types")).getByRole("combobox"),
    );
    expect(
      screen.getByRole("option", { name: /DELETED_TYPE/ }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [activeType],
      isLoading: false,
    });
    rerender(
      <MemoryRouter>
        <WorkItemTypeFormPage />
      </MemoryRouter>,
    );
    fireEvent.mouseDown(
      within(screen.getByTestId("wit-form-parent-types")).getByRole("combobox"),
    );

    expect(
      screen.queryByRole("option", { name: /DELETED_TYPE/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /ACTIVE_TYPE/ }),
    ).toBeInTheDocument();
  });

  it("keeps the normalized draft key selectable for self-references", () => {
    renderForm();
    selectTab("Relationships");
    fillField("wit-form-key", "self_reference");

    fireEvent.mouseDown(
      within(screen.getByTestId("wit-form-parent-types")).getByRole("combobox"),
    );

    expect(
      screen.getByRole("option", { name: /SELF_REFERENCE/ }),
    ).toBeInTheDocument();
  });

  it("preserves retired relationship values loaded on an existing definition", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      allowedParentTypes: ["ARCHIVED_PARENT"],
      edgeTargets: [
        {
          edgeType: AgentEdgeType.RelatedTo,
          targetTypeKeys: ["ARCHIVED_EDGE_TARGET"],
        },
      ],
      tracking: {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: ["DELETED_TRACKING_SOURCE"],
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [
        activeCustomSummary({
          key: "ACTIVE_TYPE",
          name: "Active type",
          role: "work-item",
          sections: [],
          allowedStatuses: [],
        }),
      ],
      isLoading: false,
    });
    renderForm();
    selectTab("Relationships");

    expect(screen.getByTestId("wit-form-parent-types")).toHaveTextContent(
      "ARCHIVED_PARENT",
    );
    expect(screen.getByTestId("wit-form-edge-targets-0")).toHaveTextContent(
      "ARCHIVED_EDGE_TARGET",
    );
    expect(
      screen.getByTestId("wit-form-tracking-source-task-types"),
    ).toHaveTextContent("DELETED_TRACKING_SOURCE");

    fireEvent.mouseDown(
      within(screen.getByTestId("wit-form-parent-types")).getByRole("combobox"),
    );
    expect(
      screen.queryByRole("option", { name: /ARCHIVED_PARENT/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /ACTIVE_TYPE/ }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    fireEvent.mouseDown(
      within(
        screen.getByTestId("wit-form-tracking-source-task-types"),
      ).getByRole("combobox"),
    );
    expect(
      screen.queryByRole("option", { name: /DELETED_TRACKING_SOURCE/ }),
    ).not.toBeInTheDocument();
  });

  it("normalizes legacy non-work-item tracking declarations to TASK", () => {
    mockTypeKey = "FEATURE";
    const summary = activeCustomSummary({
      key: "FEATURE",
      name: "Feature",
      role: "project-info",
      sections: [],
      allowedStatuses: [],
      tracking: {
        allowedSourceEntityTypes: [EntityType.Message],
        allowedSourceTaskTypes: ["GOAL"],
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [
        summary,
        activeCustomSummary({
          key: "GOAL",
          name: "Goal",
          role: "project-info",
          sections: [],
          allowedStatuses: [],
        }),
      ],
      isLoading: false,
    });

    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate.mock.calls[0][0].definition.tracking).toEqual({
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: ["GOAL"],
    });
  });

  it("adds TASK parent entity support when parent work-item types are configured", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      allowedParentTypes: ["FEATURE"],
      allowedParentEntityTypes: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
      refetch: mockRefetchWorkItemType,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
      refetch: mockRefetchWorkItemTypes,
    });

    renderForm();

    expect(
      screen.getByTestId("wit-form-parent-entity-types"),
    ).toHaveTextContent(EntityType.Task);
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(
      mockEditMutate.mock.calls[0][0].definition.allowedParentEntityTypes,
    ).toEqual([EntityType.Task]);
  });

  it("submits an assembled definition with tracking zeroed and writing standards null when left blank", () => {
    renderForm();

    fillField("wit-form-key", "marketing");
    fillField("wit-form-name", "Marketing");

    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(mockCreateMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      definition: {
        // Key is normalized to uppercase before submission.
        key: "MARKETING",
        name: "Marketing",
        role: "work-item",
        description: null,
        // The single empty starter section is filtered out.
        sections: [],
        requiredScalars: [],
        forbiddenScalars: [],
        allowedStatuses: [],
        allowedParentTypes: [],
        edgeTargets: [],
        allowedParentEntityTypes: [],
        tracking: {
          allowedSourceEntityTypes: [],
          allowedSourceTaskTypes: [],
        },
        agentSettableStatuses: [],
        anchorableReportTypes: [],
        // Null because both create/edit standards are blank.
        writingStandards: null,
        capabilities: {},
      },
    });
  });

  it("assembles writing standards and description when those fields are filled", () => {
    renderForm();

    fillField("wit-form-key", "marketing");
    fillField("wit-form-name", "Marketing");
    fillField("wit-form-description", "Captures go-to-market work.");
    fillField("wit-form-writing-standard-create", "Lead with the audience.");

    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    const variables = mockCreateMutate.mock.calls[0][0];
    expect(variables.definition.description).toBe(
      "Captures go-to-market work.",
    );
    // Edit standard stays empty; the non-null object derivation must still fire.
    expect(variables.definition.writingStandards).toEqual({
      create: "Lead with the audience.",
      edit: "",
    });
  });

  it("submits maintenance advice as its own optional definition field", () => {
    renderForm();
    fillField("wit-form-key", "marketing");
    fillField("wit-form-name", "Marketing");
    fillField(
      "wit-form-maintenance-guidance",
      "  Review campaign previews against approved behavior.  ",
    );
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          maintenanceGuidance:
            "Review campaign previews against approved behavior.",
        }),
      }),
    );
  });

  it("stays on the form, links the created proposal, and refreshes registry data", () => {
    renderForm();

    fillField("wit-form-key", "marketing");
    fillField("wit-form-name", "Marketing");

    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("wit-form-proposal-created")).toHaveTextContent(
      "Proposal created",
    );
    expect(screen.getByTestId("wit-form-proposal-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/proposals/prop-1",
    );
    expect(mockRefetchWorkItemTypes).toHaveBeenCalledTimes(2);
  });

  it("blocks submission and surfaces an error when the key collides with an existing type", () => {
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [{ definition: { key: "MARKETING" } }],
      isLoading: false,
    });
    renderForm();

    fillField("wit-form-key", "marketing");
    fillField("wit-form-name", "Marketing");

    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("wit-form-error")).toBeInTheDocument();
  });

  it("renders an existing BUG definition before any edit impact exists", () => {
    mockTypeKey = "BUG";
    const summary = activeCustomSummary({
      key: "BUG",
      name: "Bug",
      role: "work-item",
      description: "A delivered behavior defect.",
      sections: [],
      allowedStatuses: [WorkStatus.Active],
      tracking: {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();

    expect(
      within(screen.getByTestId("wit-form-key")).getByRole("textbox"),
    ).toHaveValue("BUG");
    expect(
      within(screen.getByTestId("wit-form-name")).getByRole("textbox"),
    ).toHaveValue("Bug");
    expect(
      screen.queryByTestId("wit-form-edit-impact"),
    ).not.toBeInTheDocument();
    expect(mockTrackingImpact).toHaveBeenLastCalledWith(
      "org-1",
      "proj-1",
      "BUG",
      [],
      { enabled: false },
    );
  });

  it("hydrates an unconstrained relationship as All on the edit route", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      edgeTargets: [
        {
          edgeType: AgentEdgeType.RelatedTo,
          targetTypeKeys: [],
        },
      ],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();

    expect(screen.getByTestId("wit-form-edge-targets-0")).toHaveTextContent(
      "All",
    );
    fireEvent.click(screen.getByTestId("wit-form-submit"));
    expect(mockEditMutate.mock.calls[0][0].definition.edgeTargets).toEqual([
      {
        edgeType: AgentEdgeType.RelatedTo,
        targetTypeKeys: [],
      },
    ]);
    expect(screen.getByTestId("wit-form-proposal-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/proposals/edit-prop-1",
    );
  });

  it("preserves minimal section metadata and treats discovered capabilities as authorable", () => {
    mockTypeKey = "CUSTOM";
    const definition: WorkItemTypeSummaryDto["definition"] = {
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      iconKey: "workflow",
      description: null,
      sections: [
        { key: "description", label: "Description" },
        { key: "acceptanceCriteria", label: "Acceptance criteria" },
      ],
      requiredScalars: [],
      forbiddenScalars: [],
      allowedStatuses: [],
      allowedParentTypes: [],
      edgeTargets: [],
      allowedParentEntityTypes: [],
      tracking: {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      },
      agentSettableStatuses: [],
      anchorableReportTypes: [],
      writingStandards: null,
      capabilities: { rendersInline: true },
    };
    const summary = activeCustomSummary(definition);
    const typeWithAdditionalCapability = activeCustomSummary({
      ...definition,
      key: "PLAN",
      name: "Plan",
      role: "project-info",
      capabilities: {
        rendersInline: true,
        planEligible: true,
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary, typeWithAdditionalCapability],
      isLoading: false,
    });

    renderForm();
    expect(screen.getByRole("combobox", { name: "Icon" })).toHaveTextContent(
      "Diagram",
    );
    selectTab("Capabilities");

    expect(
      screen.getByTestId("wit-form-capability-planEligible"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("wit-form-capability-planEligible")).getByRole(
        "switch",
      ),
    ).not.toBeChecked();
    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();

    selectTab("Overview");
    expect(screen.getByRole("combobox", { name: "Icon" })).toHaveTextContent(
      "Diagram",
    );
    selectTab("Capabilities");
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      typeKey: "CUSTOM",
      definition,
    });

    fireEvent.click(
      within(screen.getByTestId("wit-form-capability-planEligible")).getByRole(
        "switch",
      ),
    );

    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wit-form-submit"));
    expect(mockEditMutate.mock.calls[1][0].definition.capabilities).toEqual({
      rendersInline: true,
      planEligible: true,
    });
  });

  it("keeps object-valued graph capability declarations intact", () => {
    mockTypeKey = "WORKFLOW";
    const graph = {
      nodeChildType: "WORKFLOW_STEP",
      layout: {
        sectionKey: "layout",
        schemaRef: "#/components/schemas/WorkItemGraphLayoutValue",
      },
      readableRelationships: [],
      editableRelationships: [],
      rendererKey: "workflow",
      editorKey: "workflow",
      supportedActions: [],
    };
    const summary = activeCustomSummary({
      key: "WORKFLOW",
      name: "Workflow",
      role: "project-info",
      sections: [],
      allowedStatuses: [],
      capabilities: {
        graph,
        rendersInline: true,
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();

    expect(
      screen.queryByTestId("wit-form-capability-graph"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wit-form-submit"));
    expect(mockEditMutate.mock.calls[0][0].definition.capabilities).toEqual({
      graph,
      rendersInline: true,
    });
  });

  it("seeds every definition axis in edit mode and preserves hidden section metadata on submission", () => {
    mockTypeKey = "CUSTOM";
    const summary: WorkItemTypeSummaryDto = {
      id: "custom-type",
      status: WorkItemTypeLifecycleStatus.Active,
      projectId: "proj-1",
      effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
      definition: {
        key: "CUSTOM",
        name: "Custom work",
        role: "work-item",
        description: "A custom type.",
        sections: [
          {
            key: "details",
            label: "Details",
            writingStandard: "Be precise.",
            kind: "json",
            schemaRef: "#/components/schemas/Details",
          },
        ],
        requiredScalars: [WorkItemTypeScalarField.DueDate],
        forbiddenScalars: [WorkItemTypeScalarField.Tag],
        allowedStatuses: [WorkStatus.Ready, WorkStatus.Active],
        allowedParentTypes: ["FEATURE"],
        edgeTargets: [
          {
            edgeType: AgentEdgeType.DependsOn,
            targetTypeKeys: ["STANDARD"],
          },
        ],
        allowedParentEntityTypes: [EntityType.Plan, EntityType.Task],
        tracking: {
          allowedSourceEntityTypes: [EntityType.Task],
          allowedSourceTaskTypes: ["GOAL"],
        },
        agentSettableStatuses: [WorkStatus.Ready],
        anchorableReportTypes: [ReportType.Implement],
        writingStandards: { create: "Create well.", edit: "Edit well." },
        capabilities: { rendersInline: true },
      },
    };
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();

    expect(
      within(screen.getByTestId("wit-form-key")).getByRole("textbox"),
    ).toHaveValue("CUSTOM");
    expect(
      within(screen.getByTestId("wit-form-key")).getByRole("textbox"),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId("wit-form-name")).getByRole("textbox"),
    ).toHaveValue("Custom work");
    expect(screen.getByDisplayValue("Details")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Be precise.")).toBeInTheDocument();
    expect(
      screen.queryByTestId("wit-form-tracking-source-entity-types"),
    ).not.toBeInTheDocument();
    selectTab("Capabilities");
    expect(
      within(screen.getByTestId("wit-form-capability-rendersInline")).getByRole(
        "switch",
      ),
    ).toBeChecked();

    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockCreateMutate).not.toHaveBeenCalled();
    expect(mockEditMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      typeKey: "CUSTOM",
      definition: summary.definition,
    });
    expect(screen.getByTestId("wit-form-proposal-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/proposals/edit-prop-1",
    );
  });

  it("submits additive edits without impact confirmation", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      description: "A custom type.",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-add-section"));
    const section = screen.getByTestId("wit-form-section-0");
    fireEvent.change(within(section).getByLabelText("Section key"), {
      target: { value: "notes" },
    });
    fireEvent.change(within(section).getByLabelText("Section heading"), {
      target: { value: "Notes" },
    });

    expect(
      screen.queryByTestId("wit-form-edit-impact"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).toHaveBeenCalledTimes(1);
    expect(mockEditMutate.mock.calls[0][0].definition.sections).toEqual([
      {
        key: "notes",
        label: "Notes",
        writingStandard: null,
      },
    ]);
    expect(
      mockSectionImpact.mock.calls.some(
        (call) => (call[4] as { enabled?: boolean } | undefined)?.enabled,
      ),
    ).toBe(false);
    expect(
      mockTrackingImpact.mock.calls.some(
        (call) => (call[4] as { enabled?: boolean } | undefined)?.enabled,
      ),
    ).toBe(false);
  });

  it("submits authorable semantic edits without impact confirmation", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      description: "A custom type.",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    fillField("wit-form-description", "A revised custom type.");

    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).toHaveBeenCalledTimes(1);
    expect(mockEditMutate.mock.calls[0][0].definition.description).toBe(
      "A revised custom type.",
    );
    expect(
      mockSectionImpact.mock.calls.some(
        (call) => (call[4] as { enabled?: boolean } | undefined)?.enabled,
      ),
    ).toBe(false);
    expect(
      mockTrackingImpact.mock.calls.some(
        (call) => (call[4] as { enabled?: boolean } | undefined)?.enabled,
      ),
    ).toBe(false);
  });

  it("allows an active project-owned type to change hierarchy behavior", () => {
    mockTypeKey = "FEATURE";
    const summary = activeCustomSummary({
      key: "FEATURE",
      name: "Feature",
      role: "project-info",
      sections: [],
      allowedStatuses: [],
      capabilities: { isHierarchyNode: true },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    selectTab("Capabilities");
    fireEvent.click(
      within(
        screen.getByTestId("wit-form-capability-isHierarchyNode"),
      ).getByRole("switch"),
    );

    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeEnabled();
  });

  it("explains why parent-required types cannot appear in the Explorer Sidebar when creating", () => {
    const capabilitySource = activeCustomSummary({
      key: "CAPABILITY_SOURCE",
      name: "Capability source",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      capabilities: {
        requiresParent: false,
        showsInExplorerSidebar: false,
      },
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [capabilitySource],
      isLoading: false,
    });

    renderForm();
    selectTab("Capabilities");
    fireEvent.click(
      within(
        screen.getByTestId("wit-form-capability-requiresParent"),
      ).getByRole("switch"),
    );
    fireEvent.click(
      within(
        screen.getByTestId("wit-form-capability-showsInExplorerSidebar"),
      ).getByRole("switch"),
    );

    const capabilities = screen.getByTestId("wit-form-capabilities");
    expect(
      within(capabilities).getByTestId("wit-form-capabilities-error"),
    ).toHaveTextContent(
      "Explorer Sidebar entries are top-level, so a work-item type that requires a parent cannot be shown there.",
    );
    expect(
      within(capabilities).getByTestId("wit-form-capabilities-error"),
    ).toHaveTextContent("Choose compatible capabilities");
    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("explains the Explorer Sidebar capability conflict when editing", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
      capabilities: {
        requiresParent: false,
        showsInExplorerSidebar: false,
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    selectTab("Capabilities");
    fireEvent.click(
      within(
        screen.getByTestId("wit-form-capability-requiresParent"),
      ).getByRole("switch"),
    );
    fireEvent.click(
      within(
        screen.getByTestId("wit-form-capability-showsInExplorerSidebar"),
      ).getByRole("switch"),
    );

    expect(
      within(screen.getByTestId("wit-form-capabilities")).getByTestId(
        "wit-form-capabilities-error",
      ),
    ).toHaveTextContent(
      "Explorer Sidebar entries are top-level, so a work-item type that requires a parent cannot be shown there.",
    );
    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
    expect(mockEditMutate).not.toHaveBeenCalled();
  });

  it("preserves absent optional definition fields on an unchanged edit", () => {
    mockTypeKey = "MINIMAL";
    const definition: WorkItemTypeSummaryDto["definition"] = {
      key: "MINIMAL",
      name: "Minimal",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    };
    const summary: WorkItemTypeSummaryDto = {
      id: "minimal-type",
      status: WorkItemTypeLifecycleStatus.Active,
      projectId: "proj-1",
      effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
      definition,
    };
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate.mock.calls[0][0].definition).toEqual(definition);
  });

  it("uses the stored key when the disabled local key state is stale", () => {
    mockTypeKey = "LOCAL_KEY";
    const summary = activeCustomSummary({
      key: "LOCAL_KEY",
      name: "Custom work",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    const { rerender } = renderForm();
    expect(
      within(screen.getByTestId("wit-form-key")).getByRole("textbox"),
    ).toHaveValue("LOCAL_KEY");

    summary.definition.key = "STORED_KEY";
    rerender(
      <MemoryRouter>
        <WorkItemTypeFormPage />
      </MemoryRouter>,
    );

    expect(
      within(screen.getByTestId("wit-form-key")).getByRole("textbox"),
    ).toHaveValue("LOCAL_KEY");
    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      typeKey: "STORED_KEY",
      definition: expect.objectContaining({ key: "STORED_KEY" }),
    });
  });

  it("submits allowed-status edits for custom definitions", () => {
    mockTypeKey = "STATUSFUL";
    const summary: WorkItemTypeSummaryDto = {
      id: "statusful-type",
      status: WorkItemTypeLifecycleStatus.Active,
      projectId: "proj-1",
      effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
      definition: {
        key: "STATUSFUL",
        name: "Statusful",
        role: "work-item",
        sections: [],
        allowedStatuses: [],
      },
    };
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    selectTab("Lifecycle");
    const selector = screen.getByTestId("wit-form-statuses");
    fireEvent.mouseDown(within(selector).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: WorkStatus.Active }));
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate.mock.calls[0][0].definition.allowedStatuses).toEqual([
      WorkStatus.Active,
    ]);
    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
  });

  it("requires explicit risk confirmation before customizing a built-in type", async () => {
    mockTypeKey = "STANDARD";
    const summary = builtInCanonicalSummary({
      key: "STANDARD",
      name: "Standard task",
      role: "work-item",
      sections: [],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).not.toHaveBeenCalled();
    const dialog = screen.getByTestId(
      "wit-form-canonical-customization-dialog",
    );
    expect(dialog).toHaveTextContent("may cause instability");
    expect(dialog).toHaveTextContent("inconsistent behavior");
    expect(dialog).toHaveTextContent("broken features");
    expect(dialog).toHaveTextContent("future platform updates");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog).not.toBeVisible());
    expect(mockEditMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("wit-form-submit"));
    fireEvent.click(
      screen.getByTestId("wit-form-canonical-customization-confirm"),
    );

    expect(mockEditMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      typeKey: "STANDARD",
      definition: expect.objectContaining({ key: "STANDARD" }),
      acknowledgeCanonicalCustomization: true,
    });
  });

  it.each([
    ["project custom", WorkItemTypeEffectiveSource.ProjectCustom],
    ["canonical override", WorkItemTypeEffectiveSource.CanonicalOverride],
  ])(
    "bypasses the built-in warning for %s edits",
    (_label, effectiveSource) => {
      mockTypeKey = "EDITABLE";
      const summary: WorkItemTypeSummaryDto = {
        ...activeCustomSummary({
          key: "EDITABLE",
          name: "Editable type",
          role: "work-item",
          sections: [],
          allowedStatuses: [],
        }),
        effectiveSource,
      };
      mockUseWorkItemTypeByKey.mockReturnValue({
        workItemTypeSummary: summary,
        isLoading: false,
        error: null,
      });
      mockUseWorkItemTypes.mockReturnValue({
        workItemTypes: [summary],
        isLoading: false,
      });

      renderForm();
      fireEvent.click(screen.getByTestId("wit-form-submit"));

      expect(
        screen.queryByTestId("wit-form-canonical-customization-dialog"),
      ).not.toBeInTheDocument();
      expect(mockEditMutate).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "proj-1",
        typeKey: "EDITABLE",
        definition: expect.objectContaining({ key: "EDITABLE" }),
      });
    },
  );

  it("requires count-backed confirmation before submitting a section removal", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      description: "A custom type.",
      sections: [
        { key: "audience", label: "Audience", writingStandard: null },
        { key: "details", label: "Details", writingStandard: null },
      ],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    fireEvent.click(screen.getAllByLabelText("Remove section")[1]);

    expect(screen.getByTestId("wit-form-section-impact")).toHaveTextContent(
      "3 existing items",
    );
    expect(screen.getByText("details: 2 items")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("wit-form-impact-confirm"));
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).toHaveBeenCalledTimes(1);
    expect(mockEditMutate.mock.calls[0][0].definition.sections).toEqual([
      {
        key: "audience",
        label: "Audience",
        writingStandard: null,
      },
    ]);
  });

  it("requires count-backed confirmation before removing an allowed tracking source type", async () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      description: "A custom type.",
      sections: [],
      allowedStatuses: [],
      tracking: {
        allowedSourceEntityTypes: [EntityType.Task],
        allowedSourceTaskTypes: ["BUG", "FEATURE"],
      },
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [
        summary,
        activeCustomSummary({
          key: "BUG",
          name: "Bug",
          role: "work-item",
          sections: [],
          allowedStatuses: [],
        }),
        activeCustomSummary({
          key: "FEATURE",
          name: "Feature",
          role: "project-info",
          sections: [],
          allowedStatuses: [],
        }),
      ],
      isLoading: false,
    });

    renderForm();
    selectTab("Relationships");
    fireEvent.mouseDown(
      within(
        screen.getByTestId("wit-form-tracking-source-task-types"),
      ).getByRole("combobox"),
    );
    fireEvent.click(await screen.findByRole("option", { name: /BUG/ }));

    expect(mockTrackingImpact).toHaveBeenLastCalledWith(
      "org-1",
      "proj-1",
      "CUSTOM",
      ["BUG"],
      { enabled: true },
    );
    expect(screen.getByTestId("wit-form-tracking-impact")).toHaveTextContent(
      "4 existing tracking links",
    );
    expect(screen.getByText("BUG: 4 links")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("wit-form-impact-confirm"));
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    await waitFor(() => expect(mockEditMutate).toHaveBeenCalledTimes(1));
    expect(
      mockEditMutate.mock.calls[0][0].definition.tracking
        .allowedSourceTaskTypes,
    ).toEqual(["FEATURE"]);
  });

  it.each([
    {
      name: "loading",
      message: "Edit impact counts are still loading.",
      makeImpact: () => ({
        data: null,
        isLoading: true,
        isFetching: true,
        isFetched: true,
        isReady: false,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    },
    {
      name: "failure",
      message:
        "Could not load edit impact counts. Try again before submitting.",
      makeImpact: () => ({
        data: null,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: false,
        error: new Error("impact failed"),
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    },
  ])(
    "blocks submission when destructive impact is $name",
    ({ message, makeImpact }) => {
      mockTypeKey = "CUSTOM";
      const summary = activeCustomSummary({
        key: "CUSTOM",
        name: "Custom work",
        role: "work-item",
        description: "A custom type.",
        sections: [
          { key: "audience", label: "Audience", writingStandard: null },
          { key: "details", label: "Details", writingStandard: null },
        ],
        allowedStatuses: [],
      });
      mockUseWorkItemTypeByKey.mockReturnValue({
        workItemTypeSummary: summary,
        isLoading: false,
        error: null,
      });
      mockUseWorkItemTypes.mockReturnValue({
        workItemTypes: [summary],
        isLoading: false,
      });
      mockSectionImpact.mockImplementation(makeImpact);

      renderForm();
      fireEvent.click(screen.getAllByLabelText("Remove section")[1]);
      fireEvent.submit(screen.getByTestId("wit-form"));

      expect(screen.getByTestId("wit-form-error")).toHaveTextContent(message);
      expect(mockEditMutate).not.toHaveBeenCalled();
    },
  );

  it("requires confirmation for section key replacement", () => {
    mockTypeKey = "CUSTOM";
    const summary = activeCustomSummary({
      key: "CUSTOM",
      name: "Custom work",
      role: "work-item",
      description: "A custom type.",
      sections: [
        { key: "audience", label: "Audience", writingStandard: null },
        {
          key: "details",
          label: "Details",
          writingStandard: null,
          kind: "json",
          schemaRef: "#/components/schemas/Details",
        },
      ],
      allowedStatuses: [],
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    fireEvent.click(screen.getAllByLabelText("Remove section")[0]);
    fireEvent.click(screen.getByTestId("wit-form-add-section"));
    const addedSection = screen.getByTestId("wit-form-section-1");
    fireEvent.change(within(addedSection).getByLabelText("Section key"), {
      target: { value: "context" },
    });
    fireEvent.change(within(addedSection).getByLabelText("Section heading"), {
      target: { value: "Context" },
    });

    expect(screen.getByTestId("wit-form-edit-impact")).toBeInTheDocument();
    expect(
      screen.queryByTestId("wit-form-unsupported-impact"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("wit-form-section-impact")).toHaveTextContent(
      "3 existing items",
    );
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("wit-form-impact-confirm"));
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).toHaveBeenCalledTimes(1);
    expect(mockEditMutate.mock.calls[0][0].definition.sections).toEqual([
      {
        key: "details",
        label: "Details",
        writingStandard: null,
        kind: "json",
        schemaRef: "#/components/schemas/Details",
      },
      {
        key: "context",
        label: "Context",
        writingStandard: null,
      },
    ]);
  });

  it("keeps restore and hard delete separate and loads cascade impact only while confirmation is open", () => {
    prepareArchivedCustomEdit();
    renderForm();

    expect(screen.getByTestId("wit-form-restore")).toHaveTextContent(
      "Restore for review",
    );
    expect(screen.getByTestId("wit-form-hard-delete-open")).toHaveTextContent(
      "Hard delete",
    );
    expect(
      screen.queryByTestId("wit-form-hard-delete-dialog"),
    ).not.toBeInTheDocument();
    expect(mockCascadeImpact).toHaveBeenLastCalledWith(
      "org-1",
      "proj-1",
      "CUSTOM",
      false,
    );

    fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));

    expect(screen.getByTestId("wit-form-hard-delete-dialog")).toHaveTextContent(
      "This removal is irreversible",
    );
    expect(screen.getByTestId("wit-form-hard-delete-impact")).toHaveTextContent(
      "12 work items",
    );
    expect(screen.getByTestId("wit-form-hard-delete-impact")).toHaveTextContent(
      "7 graph edges",
    );
    expect(mockCascadeImpact).toHaveBeenLastCalledWith(
      "org-1",
      "proj-1",
      "CUSTOM",
      true,
    );
  });

  it.each([
    {
      name: "loading",
      state: {
        data: null,
        isLoading: true,
        isFetching: true,
        error: null,
        isStale: false,
      },
      testId: "wit-form-hard-delete-impact-loading",
    },
    {
      name: "failed",
      state: {
        data: null,
        isLoading: false,
        isFetching: false,
        error: new Error("impact failed"),
        isStale: false,
      },
      testId: "wit-form-hard-delete-impact-error",
    },
  ])(
    "keeps hard delete unavailable while impact is $name",
    ({ state, testId }) => {
      prepareArchivedCustomEdit();
      mockCascadeImpact.mockImplementation(
        (_orgId, _projectId, _typeKey, enabled: boolean) => ({
          ...state,
          data: enabled ? state.data : null,
          isFetched: enabled,
          isReady: false,
          refetch: vi.fn(),
          markStale: vi.fn(),
        }),
      );
      renderForm();

      fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));

      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.getByTestId("wit-form-hard-delete-confirm")).toBeDisabled();
      expect(mockHardDeleteMutate).not.toHaveBeenCalled();
    },
  );

  it("requires the exact displayed item and edge counts before hard delete", () => {
    prepareArchivedCustomEdit();
    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));

    const confirmButton = screen.getByTestId("wit-form-hard-delete-confirm");
    expect(confirmButton).toBeDisabled();

    fillField("wit-form-hard-delete-confirmation", "DELETE CUSTOM");
    expect(confirmButton).toBeDisabled();
    expect(mockHardDeleteMutate).not.toHaveBeenCalled();

    fillField(
      "wit-form-hard-delete-confirmation",
      "DELETE 12 ITEMS AND 7 EDGES",
    );
    expect(confirmButton).toBeEnabled();
  });

  it("invalidates typed confirmation when refreshed cascade impact changes", () => {
    prepareArchivedCustomEdit();
    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));

    mockCascadeImpact.mockImplementation(
      (_orgId, _projectId, _typeKey, enabled: boolean) => ({
        data: enabled ? { itemCount: 13, edgeCount: 9 } : null,
        isLoading: false,
        isFetching: false,
        isFetched: enabled,
        isReady: enabled,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    );
    fillField(
      "wit-form-hard-delete-confirmation",
      "DELETE 12 ITEMS AND 7 EDGES",
    );

    expect(screen.getByTestId("wit-form-hard-delete-impact")).toHaveTextContent(
      "13 work items",
    );
    expect(screen.getByText("DELETE 13 ITEMS AND 9 EDGES")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-hard-delete-confirm")).toBeDisabled();
  });

  it("blocks stale cascade impact even when confirmation text matches", () => {
    prepareArchivedCustomEdit();
    mockCascadeImpact.mockImplementation(
      (_orgId, _projectId, _typeKey, enabled: boolean) => ({
        data: enabled ? { itemCount: 12, edgeCount: 7 } : null,
        isLoading: false,
        isFetching: false,
        isFetched: enabled,
        isReady: enabled,
        error: null,
        isStale: enabled,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    );
    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));

    expect(
      screen.getByTestId("wit-form-hard-delete-impact-stale"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("wit-form-hard-delete-confirmation")).getByRole(
        "textbox",
      ),
    ).toBeDisabled();
    expect(screen.getByTestId("wit-form-hard-delete-confirm")).toBeDisabled();
  });

  it("starts hard-delete review and navigates after exact confirmation", async () => {
    prepareArchivedCustomEdit();
    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));
    fillField(
      "wit-form-hard-delete-confirmation",
      "DELETE 12 ITEMS AND 7 EDGES",
    );

    fireEvent.click(screen.getByTestId("wit-form-hard-delete-confirm"));

    await waitFor(() => expect(mockHardDeleteMutate).toHaveBeenCalledTimes(1));
    expect(mockHardDeleteMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      typeKey: "CUSTOM",
      confirmedItemCount: 12,
      confirmedEdgeCount: 7,
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/proj-1/proposals/hard-delete-prop-1",
    );
  });

  it("refreshes displayed impact and clears confirmation after a stale-impact conflict", async () => {
    prepareArchivedCustomEdit();
    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));
    fillField(
      "wit-form-hard-delete-confirmation",
      "DELETE 12 ITEMS AND 7 EDGES",
    );
    fireEvent.click(screen.getByTestId("wit-form-hard-delete-confirm"));

    await waitFor(() => expect(mockHardDeleteMutate).toHaveBeenCalledTimes(1));
    act(() => {
      capturedHardDeleteOptions?.onError?.({
        response: {
          status: 409,
          data: {
            data: { currentImpact: { itemCount: 13, edgeCount: 9 } },
          },
        },
      } as never);
    });

    await waitFor(() =>
      expect(screen.getByTestId("wit-form-error")).toHaveTextContent(
        "The removal impact changed. Confirm the updated counts before trying again.",
      ),
    );
    expect(screen.getByTestId("wit-form-hard-delete-impact")).toHaveTextContent(
      "13 work items",
    );
    expect(screen.getByTestId("wit-form-hard-delete-impact")).toHaveTextContent(
      "9 graph edges",
    );
    expect(
      within(screen.getByTestId("wit-form-hard-delete-confirmation")).getByRole(
        "textbox",
      ),
    ).toHaveValue("");
    expect(screen.getByTestId("wit-form-hard-delete-confirm")).toBeDisabled();
  });

  it("keeps hard delete unavailable without organization context", () => {
    prepareArchivedCustomEdit();
    mockCurrentOrgId = undefined;
    renderForm();

    expect(
      screen.queryByTestId("wit-form-hard-delete-open"),
    ).not.toBeInTheDocument();
    expect(mockCascadeImpact).toHaveBeenLastCalledWith(
      undefined,
      "proj-1",
      "CUSTOM",
      false,
    );
  });

  describe.each([ProjectRole.Member, ProjectRole.Viewer])(
    "for a project %s",
    (role) => {
      beforeEach(() => {
        mockProjectRole = role;
      });

      it("shows an existing type read-only without submit, archive, reset or hard delete", () => {
        mockTypeKey = "CUSTOM";
        mockUseWorkItemTypeByKey.mockReturnValue({
          workItemTypeSummary: {
            id: "custom-type",
            status: WorkItemTypeLifecycleStatus.Active,
            projectId: "proj-1",
            effectiveSource: WorkItemTypeEffectiveSource.CanonicalOverride,
            definition: {
              key: "CUSTOM",
              name: "Custom work",
              role: "work-item",
              sections: [],
              allowedStatuses: [],
            },
          },
          isLoading: false,
          error: null,
        });

        renderForm();

        expect(screen.getByTestId("wit-form-read-only")).toBeInTheDocument();
        for (const testId of [
          "wit-form-submit",
          "wit-form-archive",
          "wit-form-restore",
          "wit-form-reset-to-canonical",
          "wit-form-hard-delete-open",
        ]) {
          expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
        }
        expect(screen.getByTestId("wit-form-cancel")).toBeInTheDocument();
      });

      it("shows the new-type form read-only without a submit control", () => {
        renderForm();

        expect(screen.getByTestId("wit-form-read-only")).toBeInTheDocument();
        expect(screen.queryByTestId("wit-form-submit")).not.toBeInTheDocument();
      });
    },
  );

  it("lets a project ARCHITECT edit and archive but not see the read-only banner", () => {
    mockProjectRole = ProjectRole.Architect;
    mockTypeKey = "CUSTOM";
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: {
        id: "custom-type",
        status: WorkItemTypeLifecycleStatus.Active,
        projectId: "proj-1",
        effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
        definition: {
          key: "CUSTOM",
          name: "Custom work",
          role: "work-item",
          sections: [],
          allowedStatuses: [],
        },
      },
      isLoading: false,
      error: null,
    });

    renderForm();

    expect(screen.queryByTestId("wit-form-read-only")).not.toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-archive")).toBeInTheDocument();
  });

  it("starts archive review for an active custom type", () => {
    mockTypeKey = "CUSTOM";
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: {
        id: "custom-type",
        status: WorkItemTypeLifecycleStatus.Active,
        projectId: "proj-1",
        effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
        definition: {
          key: "CUSTOM",
          name: "Custom work",
          role: "work-item",
          sections: [],
          allowedStatuses: [],
        },
      },
      isLoading: false,
      error: null,
    });

    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-archive"));

    expect(mockArchiveMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      typeKey: "CUSTOM",
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/proj-1/proposals/archive-prop-1",
    );
  });

  it("allows active canonical-seeded definitions to use edit and archive paths", async () => {
    mockTypeKey = "READ_ONLY";
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: {
        id: "read-only-type",
        status: WorkItemTypeLifecycleStatus.Active,
        projectId: "proj-1",
        effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        definition: {
          key: "READ_ONLY",
          name: "Read only",
          role: "work-item",
          description: null,
          sections: [],
          allowedStatuses: [],
          tracking: {
            allowedSourceEntityTypes: [],
            allowedSourceTaskTypes: [],
          },
        },
      },
      isLoading: false,
      error: null,
    });

    renderForm();

    expect(screen.queryByTestId("wit-form-read-only")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("wit-form-submit")).not.toBeDisabled();
      expect(screen.getByTestId("wit-form-archive")).not.toBeDisabled();
    });
    expect(
      screen.queryByTestId("wit-form-hard-delete-open"),
    ).not.toBeInTheDocument();
  });

  it("allows every authorable control for an active project-owned definition without template metadata", async () => {
    mockTypeKey = "CUSTOM";
    const summary = {
      id: "custom-type",
      status: WorkItemTypeLifecycleStatus.Active,
      projectId: "proj-1",
      effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
      definition: {
        key: "CUSTOM",
        name: "Custom work",
        role: "work-item",
        description: "Original description",
        sections: [],
        allowedStatuses: [],
        capabilities: { planEligible: false },
      },
    } as WorkItemTypeSummaryDto;
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
      refetch: mockRefetchWorkItemType,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
      refetch: mockRefetchWorkItemTypes,
    });

    renderForm();

    expect(screen.queryByTestId("wit-form-read-only")).not.toBeInTheDocument();
    fillField("wit-form-name", "Renamed work");
    fillField("wit-form-description", "Updated description");
    fillField("wit-form-writing-standard-create", "Create carefully");
    selectTab("Content");
    fireEvent.click(screen.getByTestId("wit-form-add-section"));
    const newSection = screen.getByTestId("wit-form-section-0");
    fireEvent.change(within(newSection).getAllByRole("textbox")[0], {
      target: { value: "details" },
    });
    fireEvent.change(within(newSection).getAllByRole("textbox")[1], {
      target: { value: "Details" },
    });
    selectTab("Capabilities");
    fireEvent.click(
      within(screen.getByTestId("wit-form-capability-planEligible")).getByRole(
        "switch",
      ),
    );

    await waitFor(() =>
      expect(screen.getByTestId("wit-form-submit")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          name: "Renamed work",
          description: "Updated description",
          sections: [
            expect.objectContaining({ key: "details", label: "Details" }),
          ],
          writingStandards: { create: "Create carefully", edit: "" },
          capabilities: { planEligible: true },
        }),
      }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockRefetchWorkItemTypes).toHaveBeenCalledTimes(2);
    expect(mockRefetchWorkItemType).toHaveBeenCalledTimes(1);
  });

  it("preserves whitespace in untouched text fields on a no-op submission", () => {
    mockTypeKey = "CUSTOM";
    const definition: WorkItemTypeSummaryDto["definition"] = {
      key: "CUSTOM",
      name: "  Custom work  ",
      role: "work-item",
      description: "  Keep this guidance verbatim.  ",
      sections: [
        {
          key: "details",
          label: "  Details  ",
          writingStandard: "  Preserve this section guidance.  ",
        },
      ],
      allowedStatuses: [],
      writingStandards: {
        create: "  Create carefully.  ",
        edit: "  Edit carefully.  ",
      },
    };
    const summary = activeCustomSummary(definition);
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: summary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [summary],
      isLoading: false,
    });

    renderForm();
    fireEvent.click(screen.getByTestId("wit-form-submit"));

    expect(mockEditMutate.mock.calls[0][0].definition).toEqual(
      summary.definition,
    );
  });

  it("submits the exact retained definition to restore an archived type", () => {
    mockTypeKey = "ARCHIVED";
    const retainedDefinition = {
      key: "ARCHIVED",
      name: "Archived work",
      role: "work-item",
      description: "Retained definition.",
      sections: [
        {
          key: "details",
          label: "Details",
          writingStandard: "Keep the history.",
          kind: "json" as const,
          schemaRef: "#/components/schemas/Details",
        },
      ],
      requiredScalars: [WorkItemTypeScalarField.DueDate],
      forbiddenScalars: [],
      allowedStatuses: [WorkStatus.Active],
      allowedParentTypes: [],
      edgeTargets: [],
      allowedParentEntityTypes: [],
      tracking: {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      },
      agentSettableStatuses: [],
      anchorableReportTypes: [],
      writingStandards: null,
      capabilities: { planEligible: true },
    };
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: {
        id: "archived-type",
        status: WorkItemTypeLifecycleStatus.Archived,
        projectId: "proj-1",
        effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
        definition: retainedDefinition,
      },
      isLoading: false,
      error: null,
    });

    renderForm();

    expect(screen.getByTestId("wit-form-read-only")).toHaveTextContent(
      "Archived",
    );
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
    expect(screen.queryByTestId("wit-form-archive")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wit-form-restore"));

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(mockCreateMutate.mock.calls[0][0].definition).toBe(
      retainedDefinition,
    );
    expect(screen.getByTestId("wit-form-proposal-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/proposals/prop-1",
    );
  });

  it("does not expose actions for a type owned by another project", () => {
    mockTypeKey = "FOREIGN";
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: {
        id: "foreign-type",
        status: WorkItemTypeLifecycleStatus.Active,
        projectId: "other-project",
        effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
        definition: {
          key: "FOREIGN",
          name: "Foreign work",
          role: "work-item",
          sections: [],
          allowedStatuses: [],
        },
      },
      isLoading: false,
      error: null,
    });

    renderForm();

    expect(
      screen.getByTestId("wit-form-missing-ownership"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("wit-form-restore")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wit-form-archive")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("wit-form-hard-delete-open"),
    ).not.toBeInTheDocument();
  });

  it("keeps archived custom definitions read-only while allowing exact-confirmation removal review", async () => {
    mockTypeKey = "ARCHIVED_CUSTOM";
    const archivedSummary = {
      ...activeCustomSummary({
        key: "ARCHIVED_CUSTOM",
        name: "Archived custom",
        role: "work-item",
        sections: [],
        allowedStatuses: [],
      }),
      status: WorkItemTypeLifecycleStatus.Archived,
    };
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: archivedSummary,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [archivedSummary],
      isLoading: false,
    });

    renderForm();

    expect(screen.getByTestId("wit-form-read-only")).toBeInTheDocument();
    expect(screen.getByTestId("wit-form-submit")).toBeDisabled();
    expect(screen.getByTestId("wit-form-hard-delete-open")).toBeEnabled();

    fireEvent.click(screen.getByTestId("wit-form-hard-delete-open"));
    expect(mockCascadeImpact).toHaveBeenLastCalledWith(
      "org-1",
      "proj-1",
      "ARCHIVED_CUSTOM",
      true,
    );
    fillField(
      "wit-form-hard-delete-confirmation",
      "DELETE 12 ITEMS AND 7 EDGES",
    );
    fireEvent.click(screen.getByTestId("wit-form-hard-delete-confirm"));

    await waitFor(() => expect(mockHardDeleteMutate).toHaveBeenCalledTimes(1));
    expect(mockHardDeleteMutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      typeKey: "ARCHIVED_CUSTOM",
      confirmedItemCount: 12,
      confirmedEdgeCount: 7,
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/proj-1/proposals/hard-delete-prop-1",
    );
  });

  it("keeps definitions owned by another project ineligible for hard delete", () => {
    mockTypeKey = "OTHER_PROJECT";
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: {
        ...activeCustomSummary({
          key: "OTHER_PROJECT",
          name: "Other project type",
          role: "work-item",
          sections: [],
          allowedStatuses: [],
        }),
        projectId: "proj-2",
      },
      isLoading: false,
      error: null,
    });

    renderForm();

    expect(
      screen.queryByTestId("wit-form-hard-delete-open"),
    ).not.toBeInTheDocument();
    expect(mockCascadeImpact).toHaveBeenLastCalledWith(
      "org-1",
      "proj-1",
      "OTHER_PROJECT",
      false,
    );
  });
});
