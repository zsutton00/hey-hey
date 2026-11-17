import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { MemoryRouter } from "react-router-dom";
import { ChangesView } from "./ChangesView";
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

  it("labels session, task and Service, shows the short commit hash, and selects a recorded edit", () => {
    const select = vi.fn();
    render(
      <MemoryRouter>
        <ChangeRecordRow
          projectId="project"
          record={record}
          onSelect={select}
        />
      </MemoryRouter>,
    );
    const labelled = (label: string, value: string) => {
      const term = screen.getByText(label, { selector: "dt" });
      const link = term.nextElementSibling?.querySelector("a");
      expect(link).toHaveTextContent(value);
      return link;
    };
    expect(labelled("changes.sessionLabel", "History session")).toHaveAttribute(
      "href",
      expect.stringContaining("session"),
    );
    labelled("changes.taskLabel", "Browse changes");
    labelled("changes.serviceLabel", "Application");
    expect(screen.getByText("changes.committed")).toBeInTheDocument();
    expect(screen.getByText("9f1cf021")).toBeInTheDocument();
    expect(screen.getByText("changes.approximate")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("change-edit"));
    expect(select).toHaveBeenCalledWith(edit);
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
        <ChangeRecordRow projectId="project" record={mixed} onSelect={select} />
      </MemoryRouter>,
    );
    expect(screen.getByText("changes.uncommitted")).toBeInTheDocument();
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
          <ChangeRecordRow
            projectId="project"
            record={record}
            onSelect={() => {}}
          />
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
