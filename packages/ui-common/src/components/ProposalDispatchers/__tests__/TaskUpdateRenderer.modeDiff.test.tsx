import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { TaskUpdateRenderer } from "../TaskUpdateRenderer";
import type { UpdateTaskProposalUpdates } from "../types";

const rendererSpies = vi.hoisted(() => ({
  htmlCss: vi.fn(),
  structuredMockup: vi.fn(),
  diff: vi.fn(),
  workItem: vi.fn(() => ({ workItem: undefined })),
  parents: new Map<
    string,
    { id: string; name: string; parentTaskId: string | null }
  >(),
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
  useWorkItem: rendererSpies.workItem,
}));

vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => ({
    isLoading: false,
    isReady: true,
    get: (id: string) => rendererSpies.parents.get(id),
  }),
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isLoading: false, error: null }),
}));

vi.mock("../modeAvailability", () => ({
  useModeAvailability: ({ modeTypeKey }: { modeTypeKey?: string }) =>
    modeTypeKey === "MODE"
      ? { kind: "ready", features: [] }
      : { kind: "not-applicable" },
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({
    children,
    mentionConfig,
  }: {
    children: React.ReactNode;
    mentionConfig?: { organizationId: string; projectId: string };
  }) => (
    <span
      data-testid="mock-markdown-renderer"
      data-mention-organization-id={mentionConfig?.organizationId}
      data-mention-project-id={mentionConfig?.projectId}
    >
      {children}
    </span>
  ),
}));

vi.mock("../../shared/HtmlCssSectionRenderer", () => ({
  HtmlCssSectionRenderer: (props: {
    content: unknown;
    definition: { key: string };
    context: string;
    materializedProposalId?: string;
    mockupSource?: unknown;
  }) => {
    rendererSpies.htmlCss(props);
    return (
      <div
        data-testid="html-css-preview"
        data-definition-key={props.definition.key}
        data-context={props.context}
      >
        {JSON.stringify(props.content)}
      </div>
    );
  },
}));

vi.mock("../../shared/StructuredMockupSectionRenderer", () => ({
  StructuredMockupSectionRenderer: (props: {
    content: unknown;
    definition: { key: string };
    context: string;
  }) => {
    rendererSpies.structuredMockup(props);
    return (
      <div
        data-testid="structured-mockup-preview"
        data-definition-key={props.definition.key}
        data-context={props.context}
      >
        {JSON.stringify(props.content)}
      </div>
    );
  },
}));

vi.mock("../../SuggestedContent", () => ({
  DiffRenderer: (props: {
    oldContent: string;
    newContent: string;
    defaultViewMode?: string;
  }) => {
    rendererSpies.diff(props);
    return <div data-testid="ordinary-section-diff">{props.newContent}</div>;
  },
}));

vi.mock("../ProposalStateIndicator", () => ({
  ProposalStateIndicator: ({
    disabled,
    onApply,
  }: {
    disabled?: boolean;
    onApply: () => void;
  }) => (
    <button data-testid="proposal-state" disabled={disabled} onClick={onApply}>
      Approve
    </button>
  ),
}));

vi.mock("../ProposalEdges", () => ({ ProposalEdges: () => null }));

const htmlDefinition = {
  key: "preview",
  label: "Preview",
  kind: "html/css" as const,
  sizeProfiles: [
    { key: "desktop", label: "Desktop", width: 1200, height: 800 },
  ],
  defaultSizeKey: "desktop",
};
const mockupDefinition = {
  key: "composition",
  label: "Composition",
  kind: "structured-mockup" as const,
  sizeProfiles: [
    { key: "desktop", label: "Desktop", width: 1200, height: 800 },
  ],
  defaultSizeKey: "desktop",
};
const definition: WorkItemTypeDefinitionDto = {
  key: "mockups_v3",
  name: "Mockups V3",
  sections: [
    { key: "description", label: "Description", kind: "markdown" },
    htmlDefinition,
    mockupDefinition,
  ],
  allowedStatuses: [],
};

const existing = {
  id: "task-1",
  name: "Visual task",
  type: "mockups_v3",
  organizationId: "org-1",
  projectId: "project-1",
  sections: [
    { key: "description", materializedMarkdown: "Current description" },
    {
      key: "preview",
      materializedMarkdown: "current html",
      materializedProposalId: "20000000-0000-4000-8000-000000000001",
    },
    { key: "composition", materializedMarkdown: "current composition" },
  ],
} as unknown as TaskResponseDto;

const htmlAfter = {
  html: "<main>After</main>",
  css: "",
  sizeKey: "desktop",
  annotations: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      note: "Keep this visible.",
      author: {
        type: "human" as const,
        userId: "10000000-0000-4000-8000-000000000002",
      },
      category: "context" as const,
      lifecycle: "open" as const,
      authoredProposalId: "20000000-0000-4000-8000-000000000001",
      authoredSizeKey: "desktop",
      target: {
        type: "position" as const,
        x: 0.5,
        y: 0.5,
        sizeKey: "desktop",
      },
    },
  ],
};
const mockupAfter = {
  schemaVersion: "work-item-structured-mockup.v5",
  content: [
    {
      type: "icon",
      props: {
        id: "settings",
        width: { mode: "fit" },
        height: { mode: "content" },
        iconKey: "settings",
        accessibleLabel: "Settings",
        description: "Opens settings",
      },
    },
  ],
  sizeKey: "desktop",
};
const bundle = (files: Record<string, string>) =>
  JSON.stringify({ schemaVersion: "project-mode-files.v1", files });

const modeDefinition: WorkItemTypeDefinitionDto = {
  key: "MODE",
  name: "Agent Mode",
  sections: [
    { key: "description", label: "Description", kind: "markdown" },
    { key: "files", label: "Files", kind: "json" },
  ],
  allowedStatuses: [],
} as unknown as WorkItemTypeDefinitionDto;

const modeExisting = {
  id: "mode-1",
  name: "My mode",
  type: "MODE",
  organizationId: "org-1",
  projectId: "project-1",
  sections: [
    {
      key: "files",
      materializedMarkdown: bundle({ "MODE.md": "old entry", "a.md": "same" }),
    },
  ],
} as unknown as TaskResponseDto;

const renderUpdate = (
  existing: TaskResponseDto,
  def: WorkItemTypeDefinitionDto,
  updates: UpdateTaskProposalUpdates,
  extra: { diffDefaultViewMode?: "inline" | "split" } = {},
) =>
  render(
    <MemoryRouter>
      <TaskUpdateRenderer
        proposal={{ ...proposalBase, updates } as never}
        existing={existing}
        status={{ state: "pending" }}
        onApply={() => {}}
        workItemTypeDefinition={def}
        {...extra}
      />
    </MemoryRouter>,
  );

const proposalBase = {
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status: ProposalStatus.Pending,
  targetEntityId: "x",
  targetEntityType: TargetEntityType.Task,
};

describe("TaskUpdateRenderer diff default mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the selected changed file inline and changes the comparison with navigation", () => {
    renderUpdate(modeExisting, modeDefinition, {
      sections: [
        {
          key: "files",
          content: bundle({
            "MODE.md": "new entry",
            "a.md": "same",
            "b.md": "added",
          }),
        },
      ],
    });
    expect(screen.getAllByTestId("mode-file-diff")).toHaveLength(1);
    expect(rendererSpies.diff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        oldContent: "old entry",
        newContent: "new entry",
        defaultViewMode: "inline",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "b.md (added)" }));
    expect(rendererSpies.diff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        oldContent: "",
        newContent: "added",
        defaultViewMode: "inline",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "a.md (unchanged)" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mode-files-toggle-unchanged"));
    fireEvent.click(screen.getByRole("button", { name: "a.md (unchanged)" }));
    expect(screen.queryByTestId("mode-file-diff")).not.toBeInTheDocument();
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "same",
    );
  });

  it.each(["{invalid", "", "{}"])(
    "blocks approval when current files cannot be read: %s",
    (current) => {
      renderUpdate(
        {
          ...modeExisting,
          sections: [{ key: "files", materializedMarkdown: current }],
        },
        modeDefinition,
        {
          sections: [
            { key: "files", content: bundle({ "MODE.md": "proposed" }) },
          ],
        },
      );
      expect(
        screen.getByTestId("mode-files-current-unavailable"),
      ).toHaveTextContent("Current MODE files could not be read");
      expect(screen.getByTestId("proposal-state")).toBeDisabled();
      expect(screen.queryByTestId("mode-file-diff")).not.toBeInTheDocument();
    },
  );

  it("keeps Agent Mode inline even when the caller default is split", () => {
    renderUpdate(
      modeExisting,
      modeDefinition,
      { sections: [{ key: "files", content: bundle({ "MODE.md": "new" }) }] },
      { diffDefaultViewMode: "split" },
    );
    expect(
      rendererSpies.diff.mock.calls.every(
        ([p]) => p.defaultViewMode === "inline",
      ),
    ).toBe(true);
  });

  it("opens other types split", () => {
    renderUpdate(existing, definition, {
      sections: [{ key: "description", content: "Proposed description" }],
    });
    expect(rendererSpies.diff).toHaveBeenCalled();
    expect(
      rendererSpies.diff.mock.calls.every(
        ([p]) => p.defaultViewMode === "split",
      ),
    ).toBe(true);
  });

  it("applies the caller default to other types", () => {
    renderUpdate(
      existing,
      definition,
      { sections: [{ key: "description", content: "Proposed description" }] },
      { diffDefaultViewMode: "inline" },
    );
    expect(
      rendererSpies.diff.mock.calls.every(
        ([p]) => p.defaultViewMode === "inline",
      ),
    ).toBe(true);
  });
});
