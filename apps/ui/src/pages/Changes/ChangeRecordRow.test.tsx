import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { MemoryRouter } from "react-router-dom";
import { ChangesView } from "./ChangesView";
import { FullFileSplitView } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/FullFileSplitView";
import { installDiffViewerLayoutShims } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/__tests__/diffViewerLayoutShims";
import { fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectChangeRecord } from "@hey-hey/ui-common/api";
import { ChangeRecordRow } from "./ChangeRecordRow";
import { RecordedEditModal } from "./RecordedEditModal";

const { read, changes } = vi.hoisted(() => ({
  read: vi.fn(),
  changes: vi.fn(),
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  useRecordedEdit: read,
  useProjectChanges: changes,
  useAgentSessionTitleOptions: () => ({
    options: [{ id: "session", title: "History session" }],
    hasNextPage: false,
    isLoading: false,
    isFetchingNextPage: false,
    initialError: null,
    nextPageError: null,
    loadNextPage: () => {},
    retry: () => {},
  }),
  useAgentSession: () => ({
    agentSession: { id: "session", title: "History session" },
  }),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useOrganization: () => ({ currentOrganization: { id: "org" } }),
}));
vi.mock("../../../../../packages/ui-common/src/data/hooks/useServices", () => ({
  useServices: () => ({
    services: [{ id: "service", name: "Application" }],
    isLoading: false,
  }),
}));
vi.mock(
  "../../../../../packages/ui-common/src/data/hooks/useWorkItems",
  () => ({
    useWorkItems: () => ({
      workItems: [{ id: "task", name: "Browse changes", source: "USER" }],
      isLoading: false,
    }),
  }),
);
vi.mock(
  "../../../../../packages/ui-common/src/data/hooks/useFeatureHierarchy",
  () => ({
    useFeatureHierarchy: () => ({
      nodes: new Map([
        ["feature", { feature: { id: "feature", name: "Change History" } }],
      ]),
      isLoading: false,
    }),
  }),
);
vi.mock(
  "../../../../../packages/ui-common/src/data/hooks/useFeatureDocumentContent",
  () => ({ useFeatureDocumentContent: () => ({ entries: new Map() }) }),
);

const edit = {
  path: "src/page.ts",
  turnId: "turn",
  occurredAt: "2026-11-13T12:00:00Z",
  beforeObjectId: "a".repeat(40),
  afterObjectId: "b".repeat(40),
  beforeRanges: [{ startLine: 2, endLine: 4 }],
  afterRanges: [{ startLine: 2, endLine: 5 }],
  approximate: true,
  versionsRecorded: true,
};
const record = {
  report: {
    id: "report",
    organizationId: "org",
    projectId: "project",
    reportType: "IMPLEMENT",
    audience: "PROJECT_VISIBLE",
    title: "Implement",
    version: 1,
    schemaVersion: 1,
    ragEnabled: true,
    createdAt: "2026-11-13T12:00:00Z",
    payload: {
      reportType: "IMPLEMENT",
      summary: "Add history",
      filesChanged: ["src/page.ts"],
      edits: [edit],
    },
    entities: [
      {
        entityType: "AGENT_SESSION",
        entityId: "session",
        displayName: "History session",
        relation: "CONTEXT",
        createdAt: "2026-11-13T12:00:00Z",
      },
      {
        entityType: "SERVICE",
        entityId: "service",
        displayName: "Application",
        relation: "CONTEXT",
        createdAt: "2026-11-13T12:00:00Z",
      },
      {
        entityType: "TASK",
        entityId: "task",
        displayName: "Browse changes",
        relation: "CONTEXT",
        createdAt: "2026-11-13T12:00:00Z",
      },
    ],
  },
  commits: [
    {
      reportId: "commit",
      service: "service",
      hash: "9f1cf0211111111111111111111111111111aaaa",
      branch: "main",
    },
  ],
} satisfies ProjectChangeRecord;

describe("change records", () => {
  it("carries combined URL filters and pagination into the project query", () => {
    changes.mockReturnValue({
      page: { records: [], hasMore: false },
      isLoading: false,
    });
    render(
      <NuqsTestingAdapter searchParams="?agentSessionId=session&serviceId=service&taskId=task&featureId=feature&committed=false&offset=50">
        <MemoryRouter>
          <ChangesView organizationId="org" projectId="project" />
        </MemoryRouter>
      </NuqsTestingAdapter>,
    );
    expect(changes).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "session",
      serviceId: "service",
      taskId: "task",
      featureId: "feature",
      committed: false,
      offset: 50,
      limit: 50,
    });
    expect(screen.getByTestId("changes-next")).toBeDisabled();
  });

  it("highlights recorded ranges on the corresponding before and after versions", () => {
    const shims = installDiffViewerLayoutShims();
    try {
      const { container, unmount } = render(
        <FullFileSplitView
          preContent={"first\nold\nlast\n"}
          postContent={"first\nnew\nlast\n"}
          filePath="src/page.ts"
          presentationMode="side-by-side"
          recordedRanges={{
            beforeRanges: [{ startLine: 2, endLine: 2 }],
            afterRanges: [{ startLine: 2, endLine: 3 }],
          }}
        />,
      );
      const before = container.querySelectorAll(
        '[data-diff-side="old"][data-recorded-change="true"]',
      );
      const after = container.querySelectorAll(
        '[data-diff-side="new"][data-recorded-change="true"]',
      );
      expect(before).toHaveLength(1);
      expect(before[0]).toHaveTextContent("old");
      expect(after).toHaveLength(2);
      expect(after[1]).toHaveTextContent("last");
      unmount();
    } finally {
      shims.restore();
    }
  });

  it("leads with the focal task, shows an unlabelled Service chip and links to the real session, with files collapsed", () => {
    const select = vi.fn();
    render(
      <MemoryRouter>
        <ChangeRecordRow record={record} onSelect={select} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("change-focal")).toHaveTextContent(
      "Browse changes",
    );
    expect(screen.getByTestId("change-service")).toHaveTextContent(
      "Application",
    );
    expect(
      screen.getByText("changes.viewSession").closest("a"),
    ).toHaveAttribute("href", expect.stringContaining("/session"));
    expect(screen.getByText("9f1cf021")).toBeInTheDocument();
    expect(screen.queryByTestId("change-edit")).not.toBeInTheDocument();

    const toggle = screen.getByTestId("change-files-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("changes.approximate")).toBeInTheDocument();
    expect(screen.queryByText(/2–4/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("change-edit"));
    expect(select).toHaveBeenCalledWith(record, edit);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("change-edit")).not.toBeInTheDocument();
  });

  it("stays usable without a focal entity", () => {
    const noTask = {
      ...record,
      report: {
        ...record.report,
        entities: record.report.entities.filter(
          (entity) => entity.entityType !== "TASK",
        ),
      },
    } satisfies ProjectChangeRecord;
    render(
      <MemoryRouter>
        <ChangeRecordRow record={noTask} onSelect={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("change-focal")).not.toBeInTheDocument();
    expect(screen.getByTestId("change-service")).toBeInTheDocument();
    expect(screen.getByText("changes.viewSession")).toBeInTheDocument();
  });

  it("marks uncommitted records and exact edits, and lists unrecorded edits without opening them", () => {
    const select = vi.fn();
    const mixed = {
      ...record,
      commits: [],
      report: {
        ...record.report,
        payload: {
          ...record.report.payload,
          edits: [
            { ...edit, approximate: false },
            {
              ...edit,
              path: "assets/logo.png",
              approximate: true,
              versionsRecorded: false,
            },
          ],
        },
      },
    } satisfies ProjectChangeRecord;
    render(
      <MemoryRouter>
        <ChangeRecordRow record={mixed} onSelect={select} />
      </MemoryRouter>,
    );
    expect(screen.getByText("changes.uncommitted")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("change-files-toggle"));
    expect(screen.getByText("changes.exact")).toBeInTheDocument();
    expect(screen.getAllByTestId("change-edit")).toHaveLength(1);
    const unrecorded = screen.getByTestId("change-edit-unrecorded");
    expect(unrecorded).toHaveTextContent("assets/logo.png");
    expect(unrecorded.tagName).not.toBe("BUTTON");
    expect(screen.getByText("changes.versionsNotRecorded")).toBeInTheDocument();
    fireEvent.click(unrecorded);
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps the durable record rendered when its machine is unavailable", () => {
    read.mockReturnValue({
      status: "unavailable",
      file: null,
      error: "raw failure",
      cause: { kind: "machine-unreachable" },
      retry: vi.fn(),
    });
    render(
      <>
        <MemoryRouter>
          <ChangeRecordRow record={record} onSelect={() => {}} />
        </MemoryRouter>
        <RecordedEditModal
          organizationId="org"
          projectId="project"
          selection={{ record, edit }}
          onClose={() => {}}
        />
      </>,
    );
    expect(screen.getByTestId("change-record")).toBeInTheDocument();
    expect(screen.getByTestId("recorded-edit-state")).toHaveTextContent(
      "changes.reason.offline",
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session",
        serviceId: "service",
        edit,
      }),
    );
  });
});

describe("change record rendering cost", () => {
  it("does not re-render a record whose data is unchanged, but does when it changes", () => {
    const onSelect = vi.fn();
    let renders = 0;
    let bump: () => void = () => {};
    function Parent({ shown }: { shown: ProjectChangeRecord }) {
      const [, setTick] = useState(0);
      bump = () => setTick((tick) => tick + 1);
      return (
        <MemoryRouter>
          <Profiler id="row" onRender={() => (renders += 1)}>
            <ChangeRecordRow record={shown} onSelect={onSelect} />
          </Profiler>
        </MemoryRouter>
      );
    }
    const { rerender } = render(<Parent shown={record} />);
    const initial = renders;

    fireEvent.click(screen.getByTestId("change-files-toggle"));
    const afterExpand = renders;
    expect(afterExpand).toBeGreaterThan(initial);

    bump();
    bump();
    expect(renders).toBe(afterExpand);

    const changed = {
      ...record,
      report: {
        ...record.report,
        payload: { ...record.report.payload, summary: "Updated summary" },
      },
    } as ProjectChangeRecord;
    rerender(<Parent shown={changed} />);
    expect(renders).toBeGreaterThan(afterExpand);
    expect(screen.getByTestId("change-files-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
