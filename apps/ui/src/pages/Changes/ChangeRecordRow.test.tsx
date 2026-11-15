import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChangesPage } from "./ChangesPage";
import { FullFileSplitView } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/FullFileSplitView";
import { installDiffViewerLayoutShims } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/__tests__/diffViewerLayoutShims";
import { fireEvent, render, screen } from "@testing-library/react";
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
  useAgentSessions: () => ({
    agentSessions: [{ id: "session", title: "History session" }],
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
    { reportId: "commit", service: "service", hash: "abc123", branch: "main" },
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
        <MemoryRouter initialEntries={["/projects/project/changes"]}>
          <Routes>
            <Route
              path="/projects/:projectId/changes"
              element={<ChangesPage />}
            />
          </Routes>
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

  it("shows provenance and approximation and selects the exact recorded edit", () => {
    const select = vi.fn();
    render(<ChangeRecordRow record={record} onSelect={select} />);
    expect(screen.getByText("History session")).toBeInTheDocument();
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(screen.getByText("Browse changes")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(screen.getByText("changes.approximate")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("change-edit"));
    expect(select).toHaveBeenCalledWith(edit);
  });

  it("keeps the durable record rendered when its machine is unavailable", () => {
    read.mockReturnValue({ status: "unavailable", file: null, retry: vi.fn() });
    render(
      <>
        <ChangeRecordRow record={record} onSelect={() => {}} />
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
      "changes.unavailable",
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
