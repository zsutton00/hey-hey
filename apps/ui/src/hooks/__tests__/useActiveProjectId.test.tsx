import { renderHook } from "@testing-library/react";
import { useActiveProjectId } from "../useActiveProjectId";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

describe("useActiveProjectId", () => {
  const createWrapper = (initialPath: string) => {
    return ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
    );
  };

  it("should extract projectId from /projects/:projectId path", () => {
    const { result } = renderHook(() => useActiveProjectId(), {
      wrapper: createWrapper("/projects/proj-123"),
    });

    expect(result.current).toBe("proj-123");
  });

  it("should extract projectId from nested path like /projects/:projectId/tasks", () => {
    const { result } = renderHook(() => useActiveProjectId(), {
      wrapper: createWrapper("/projects/proj-456/tasks"),
    });

    expect(result.current).toBe("proj-456");
  });

  it("should extract projectId from deeply nested path", () => {
    const { result } = renderHook(() => useActiveProjectId(), {
      wrapper: createWrapper(
        "/projects/proj-789/initiatives/init-123/tasks/task-456",
      ),
    });

    expect(result.current).toBe("proj-789");
  });

  it("should return undefined when no projectId is in the path", () => {
    const { result } = renderHook(() => useActiveProjectId(), {
      wrapper: createWrapper("/"),
    });

    expect(result.current).toBeUndefined();
  });

  it("should return undefined for non-project paths", () => {
    const { result } = renderHook(() => useActiveProjectId(), {
      wrapper: createWrapper("/tasks/task-123"),
    });

    expect(result.current).toBeUndefined();
  });
});
