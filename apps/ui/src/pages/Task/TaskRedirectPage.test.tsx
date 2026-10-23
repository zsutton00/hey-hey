import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItem: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

import { useParams } from "react-router-dom";
import { useWorkItem } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { TaskRedirectPage } from "./TaskRedirectPage";

const mockUseParams = vi.mocked(useParams);
const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseUserIdentity = vi.mocked(useUserIdentity);

describe("TaskRedirectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ taskId: "goal-1" });
    mockUseUserIdentity.mockReturnValue({ currentOrgId: "org-1" } as ReturnType<
      typeof useUserIdentity
    >);
    mockUseWorkItem.mockReturnValue({
      workItem: {
        id: "goal-1",
        type: "GOAL",
        projectId: "project-1",
      },
      isLoading: false,
      isFetched: true,
      error: null,
    } as ReturnType<typeof useWorkItem>);
  });

  it("redirects a task-only Goal URL to the canonical project task path", async () => {
    render(<TaskRedirectPage />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        "/projects/project-1/tasks/goal-1",
        { replace: true },
      );
    });
  });
});
