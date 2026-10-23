import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRepositoryImportEntry } from "./useRepositoryImportEntry";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  create: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@hey-hey/ui-common/data", () => ({
  useConversationByWorkflow: mocks.lookup,
  useCreateConversation: () => ({ mutate: mocks.create }),
}));

const query = () => ({
  data: null as { id: string } | null,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn().mockResolvedValue(null),
});

describe("repository import entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockImplementation(() => query());
    mocks.create.mockResolvedValue({ id: "new-conversation" });
  });
  it("creates a dedicated conversation in the supplied scope and prevents same-tick duplicate starts", async () => {
    let finish: (value: { id: string }) => void = () => {};
    mocks.create.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useRepositoryImportEntry("explicit-org", "project"),
    );
    act(() => {
      result.current.action.execute();
      result.current.action.execute();
    });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(result.current.action.status).toBe("pending");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "explicit-org",
        projectId: "project",
        conversationDto: expect.objectContaining({
          workflowName: "repository-import",
          workflowAboutId: "project",
          workflowAboutType: "project",
          triggerEvent: "services_import",
        }),
      }),
    );
    await act(async () => finish({ id: "new-conversation" }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/projects/project/repository-import?conversationId=new-conversation",
    );
  });
  it.each(["repository-import", "onboarding"])(
    "offers resume and distinct creation for %s",
    async (workflow) => {
      mocks.lookup.mockImplementation(
        (_org: string, _project: string, name: string) => ({
          ...query(),
          data: name === workflow ? { id: "existing-conversation" } : null,
        }),
      );
      const { result } = renderHook(() =>
        useRepositoryImportEntry("org", "project"),
      );
      act(() => result.current.action.execute());
      expect(result.current.showImportChoice).toBe(true);
      expect(mocks.create).not.toHaveBeenCalled();
      act(() => result.current.resume());
      expect(mocks.navigate).toHaveBeenLastCalledWith(
        "/projects/project/repository-import?conversationId=existing-conversation",
      );
      act(() => {
        result.current.action.execute();
        result.current.createNew();
        result.current.createNew();
      });
      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenLastCalledWith(
          "/projects/project/repository-import?conversationId=new-conversation",
        ),
      );
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.lookup).toHaveBeenCalledWith(
        "org",
        "project",
        "onboarding",
        expect.objectContaining({ triggerEvent: "services_import" }),
      );
    },
  );
  it.each(["repository-import", "onboarding"])(
    "blocks entry until the %s lookup settles and retries lookup failures",
    async (workflow) => {
      const lookup = query();
      lookup.isLoading = true;
      mocks.lookup.mockImplementation(
        (_org: string, _project: string, name: string) =>
          name === workflow ? lookup : query(),
      );
      const { result, rerender } = renderHook(() =>
        useRepositoryImportEntry("org", "project"),
      );
      act(() => result.current.action.execute());
      expect(result.current.action.status).toBe("loading");
      expect(mocks.create).not.toHaveBeenCalled();
      lookup.isLoading = false;
      lookup.error = new Error("Lookup failed");
      rerender();
      expect(result.current.action.status).toBe("error");
      act(() => result.current.action.execute());
      expect(mocks.create).not.toHaveBeenCalled();
      lookup.refetch.mockImplementation(async () => {
        lookup.error = null;
        return null;
      });
      await act(async () => result.current.action.retry());
      rerender();
      expect(lookup.refetch).toHaveBeenCalledOnce();
      expect(result.current.action.status).toBe("ready");
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("exposes creation failure and retries without losing the choice", async () => {
    mocks.lookup.mockImplementation(() => ({
      ...query(),
      data: { id: "existing" },
    }));
    mocks.create.mockRejectedValueOnce(new Error("Creation failed"));
    const { result } = renderHook(() =>
      useRepositoryImportEntry("org", "project"),
    );
    act(() => result.current.action.execute());
    act(() => result.current.createNew());
    await waitFor(() =>
      expect(result.current.action.error).toBe("Creation failed"),
    );
    expect(result.current.showImportChoice).toBe(true);
    await act(async () => result.current.action.retry());
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/projects/project/repository-import?conversationId=new-conversation",
    );
  });
});
