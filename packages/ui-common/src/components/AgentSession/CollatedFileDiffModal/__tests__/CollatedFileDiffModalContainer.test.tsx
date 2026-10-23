import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CliReadChangedFileInventoryEntryStatusEnum,
  type CliReadChangedFileDetail,
  type CliReadChangedFileInventoryEntry,
} from "../../../../api";
import { useReports } from "../../../../data/hooks/useReports";
import { useServices } from "../../../../data/hooks/useServices";
import { useRemoteChangedFileDetail } from "../../runtime/hooks/useRemoteChangedFileDetail";
import { CollatedFileDiffModalContainer } from "../CollatedFileDiffModalContainer";

vi.mock("../../../../data/hooks/useReports", () => ({
  useReports: vi.fn(),
}));

vi.mock("../../../../data/hooks/useServices", () => ({
  useServices: vi.fn(),
}));

vi.mock("../../runtime/hooks/useRemoteChangedFileDetail", () => ({
  useRemoteChangedFileDetail: vi.fn(),
}));

vi.mock("../CollatedFileDiffModal", () => ({
  CollatedFileDiffModal: ({
    entries,
    onSelect,
    detail,
  }: {
    entries: CliReadChangedFileInventoryEntry[];
    onSelect: (identity: string) => void;
    detail: CliReadChangedFileDetail | null;
  }) => (
    <>
      {entries.map((entry) => {
        const identity = `${entry.serviceId}\u0000${entry.repoPath}\u0000${entry.filePath}`;
        return (
          <button
            key={identity}
            type="button"
            onClick={() => onSelect(identity)}
            data-testid="select-changed-file"
            data-service-id={entry.serviceId}
          >
            {entry.serviceId}
          </button>
        );
      })}
      <span data-testid="rendered-detail-size">
        {detail?.postContent?.length ?? 0}
      </span>
    </>
  ),
}));

const mockedUseReports = vi.mocked(useReports);
const mockedUseServices = vi.mocked(useServices);
const mockedUseRemoteChangedFileDetail = vi.mocked(useRemoteChangedFileDetail);

const duplicatePathEntries: CliReadChangedFileInventoryEntry[] = [
  {
    serviceId: "service-one",
    repoPath: "/workspace/service-one",
    filePath: "src/shared.ts",
    status: CliReadChangedFileInventoryEntryStatusEnum.Modify,
  },
  {
    serviceId: "service-two",
    repoPath: "/workspace/service-two",
    filePath: "src/shared.ts",
    status: CliReadChangedFileInventoryEntryStatusEnum.Modify,
  },
];

describe("CollatedFileDiffModalContainer", () => {
  it("forwards the exact selected service-qualified inventory entry to the detail read", async () => {
    mockedUseReports.mockReturnValue({ reports: [] } as ReturnType<
      typeof useReports
    >);
    mockedUseServices.mockReturnValue({
      services: [
        { id: "service-one", name: "Service One" },
        { id: "service-two", name: "Service Two" },
      ],
      isFetched: true,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useServices>);
    mockedUseRemoteChangedFileDetail.mockReturnValue({
      file: null,
      status: "loading",
      retry: vi.fn(),
    });

    render(
      <CollatedFileDiffModalContainer
        open
        onClose={vi.fn()}
        entries={duplicatePathEntries}
        readState={{ status: "ready" }}
        onRetry={vi.fn()}
        organizationId="organization-one"
        projectId="project-one"
        agentSessionId="agent-session-one"
        runId="run-one"
      />
    );

    const secondEntryButton = screen
      .getAllByTestId("select-changed-file")
      .find((button) => button.dataset.serviceId === "service-two");
    expect(secondEntryButton).toBeDefined();
    await userEvent.setup().click(secondEntryButton!);

    await waitFor(() => {
      const latestCall =
        mockedUseRemoteChangedFileDetail.mock.calls.at(-1)?.[0];
      expect(latestCall?.file).toBe(duplicatePathEntries[1]);
    });
  });

  it("forwards complete oversized local detail to the renderer", () => {
    const postContent = "x".repeat(1_000_000);
    mockedUseReports.mockReturnValue({ reports: [] } as ReturnType<
      typeof useReports
    >);
    mockedUseServices.mockReturnValue({
      services: [
        { id: "service-one", name: "Service One" },
        { id: "service-two", name: "Service Two" },
      ],
      isFetched: true,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useServices>);
    mockedUseRemoteChangedFileDetail.mockReturnValue({
      file: {
        ...duplicatePathEntries[0],
        diff: "@@ oversized @@",
        preContent: "before",
        postContent,
      },
      status: "success",
      error: null,
      errorCode: null,
      retry: vi.fn(),
    });

    render(
      <CollatedFileDiffModalContainer
        open
        onClose={vi.fn()}
        entries={duplicatePathEntries}
        readState={{ status: "ready" }}
        onRetry={vi.fn()}
        organizationId="organization-one"
        projectId="project-one"
        agentSessionId="agent-session-one"
        runId="run-one"
      />
    );

    expect(screen.getByTestId("rendered-detail-size")).toHaveTextContent(
      "1000000"
    );
  });
});
