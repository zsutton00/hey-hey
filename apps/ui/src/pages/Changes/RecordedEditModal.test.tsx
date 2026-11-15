import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ImplementReportEdit,
  ProjectChangeRecord,
} from "@hey-hey/ui-common/api";
import { RecordedEditModal } from "./RecordedEditModal";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@hey-hey/ui-common/data", () => ({ useRecordedEdit: read }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const edit = {
  path: "src/page.ts",
  turnId: "turn",
  occurredAt: "2026-11-13T12:00:00Z",
  beforeObjectId: "a".repeat(40),
  afterObjectId: "b".repeat(40),
  beforeRanges: [{ startLine: 2, endLine: 4 }],
  afterRanges: [{ startLine: 2, endLine: 5 }],
  approximate: false,
  versionsRecorded: true,
} satisfies ImplementReportEdit;
const entity = (entityType: string, entityId: string, displayName: string) => ({
  entityType,
  entityId,
  displayName,
  relation: "CONTEXT" as const,
  createdAt: "2026-11-13T12:00:00Z",
});
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
      filesChanged: [edit.path],
      edits: [edit],
    },
    entities: [
      entity("AGENT_SESSION", "session", "History session"),
      entity("SERVICE", "service", "Application"),
    ],
  },
  commits: [],
} satisfies ProjectChangeRecord;

describe("recorded edit dialog when a read fails", () => {
  const retry = vi.fn();
  const onClose = vi.fn();
  beforeEach(() => {
    retry.mockClear();
    onClose.mockClear();
    read.mockReturnValue({
      status: "unavailable",
      file: null,
      error: "fatal: bad object deadbeef\n    at Git.read (git.ts:41)",
      cause: { kind: "read-error", code: "NO_RECIPIENT" },
      retry,
    });
    render(
      <RecordedEditModal
        organizationId="org"
        projectId="project"
        selection={{ record, edit }}
        onClose={onClose}
      />,
    );
  });

  it("names the file and says why, without raw git text", () => {
    expect(screen.getByText("src/page.ts")).toBeInTheDocument();
    expect(screen.getByTestId("recorded-edit-state")).toHaveTextContent(
      "changes.reason.offline",
    );
    expect(screen.queryByText(/deadbeef/)).not.toBeInTheDocument();
  });

  it("reads again on Retry and closes on Close", () => {
    fireEvent.click(screen.getByTestId("recorded-edit-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("recorded-edit-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
