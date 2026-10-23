import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConversationResponseDto } from "../../../api";
import { WorkflowName } from "../../../api";

const useWorkflowConversationsMock = vi.fn();

vi.mock("../useWorkflowConversations", () => ({
  useWorkflowConversations: (
    organizationId: string | undefined,
    projectId: string | undefined,
    workflowName: string | undefined,
    workflowAboutId: string | undefined,
    options: Record<string, unknown> = {}
  ) =>
    useWorkflowConversationsMock(
      organizationId,
      projectId,
      workflowName,
      workflowAboutId,
      options
    ),
}));

import { usePlanFromDesignDocConversation } from "../usePlanFromDesignDocConversation";

const baseQueryReturn = {
  data: [] as ConversationResponseDto[],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
};

describe("usePlanFromDesignDocConversation", () => {
  beforeEach(() => {
    useWorkflowConversationsMock.mockReset();
    useWorkflowConversationsMock.mockReturnValue(baseQueryReturn);
  });

  it("filters useWorkflowConversations by the plan-from-design-doc workflow", () => {
    renderHook(() =>
      usePlanFromDesignDocConversation("org-1", "proj-1", "plan-1")
    );

    expect(useWorkflowConversationsMock).toHaveBeenCalledTimes(1);
    const [organizationId, projectId, workflowName, workflowAboutId, options] =
      useWorkflowConversationsMock.mock.calls[0];
    expect(organizationId).toBe("org-1");
    expect(projectId).toBe("proj-1");
    expect(workflowName).toBe(WorkflowName.PlanFromDesignDoc);
    expect(workflowAboutId).toBe("plan-1");
    expect(options).toMatchObject({
      sortBy: "createdAt",
      sortOrder: "desc",
      enabled: true,
    });
  });

  it("returns the most recent conversation when one exists", () => {
    const conversation = {
      id: "conv-1",
      workflowName: WorkflowName.PlanFromDesignDoc,
    } as unknown as ConversationResponseDto;
    useWorkflowConversationsMock.mockReturnValue({
      ...baseQueryReturn,
      data: [conversation],
    });

    const { result } = renderHook(() =>
      usePlanFromDesignDocConversation("org-1", "proj-1", "plan-1")
    );

    expect(result.current.conversation).toBe(conversation);
    expect(result.current.isFetched).toBe(true);
  });

  it("returns null when no conversation exists", () => {
    const { result } = renderHook(() =>
      usePlanFromDesignDocConversation("org-1", "proj-1", "plan-1")
    );

    expect(result.current.conversation).toBeNull();
  });

  it("forwards enabled=false to useWorkflowConversations", () => {
    renderHook(() =>
      usePlanFromDesignDocConversation("org-1", "proj-1", "plan-1", {
        enabled: false,
      })
    );

    const [, , , , options] = useWorkflowConversationsMock.mock.calls[0];
    expect(options).toMatchObject({ enabled: false });
  });
});
