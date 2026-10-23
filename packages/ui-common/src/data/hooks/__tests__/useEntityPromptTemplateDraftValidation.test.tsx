import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEntityPromptTemplateDraftValidation } from "../useEntityPromptTemplateDraftValidation";
const { validate } = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  entityPromptTemplatesClient: { validateEntityPromptTemplateDraft: validate },
}));
const identity = {
  organizationId: "org",
  projectId: "project",
  templateKey: "entity_context.project",
};
const draft = (content: string) => ({
  content,
  syntaxVersion: "V1" as const,
  selector: { entityType: "PROJECT" as const },
});
const valid = { data: { data: { status: "VALID", issues: [] } } };
describe("authoritative draft validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    validate.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("debounces exact content and rejects late responses after edits or identity changes", async () => {
    let finish: (value: typeof valid) => void = () => {
      throw new Error("Request not started");
    };
    validate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(valid);
    const { result, rerender } = renderHook(
      ({ content, projectId }) =>
        useEntityPromptTemplateDraftValidation(
          { ...identity, projectId },
          draft(content)
        ),
      { initialProps: { content: "old", projectId: "project" } }
    );
    expect(result.current.status).toBe("pending");
    await act(() => vi.advanceTimersByTimeAsync(300));
    rerender({ content: "new\r\n\t", projectId: "project" });
    await act(async () => {
      finish(valid);
    });
    expect(result.current.status).toBe("pending");
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current).toEqual({
      status: "valid",
      source: { content: "new\r\n\t", syntaxVersion: "V1" },
    });
    expect(validate.mock.calls[1][0]).toEqual({
      ...identity,
      entityPromptTemplateDraftValidationRequestDto: draft("new\r\n\t"),
    });
    rerender({ content: "new\r\n\t", projectId: "another" });
    expect(result.current.status).toBe("pending");
  });
  it("returns structured invalid, transport error, and cancelled states", async () => {
    validate
      .mockResolvedValueOnce({
        data: {
          data: {
            status: "INVALID",
            issues: [
              { code: "EMPTY_CONTENT", path: "content", message: "Empty" },
            ],
          },
        },
      })
      .mockRejectedValueOnce(new Error("Offline"));
    const { result, rerender } = renderHook(
      ({ content }: { content: string | null }) =>
        useEntityPromptTemplateDraftValidation(
          identity,
          content === null ? null : draft(content)
        ),
      { initialProps: { content: "" as string | null } }
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current.status).toBe("invalid");
    rerender({ content: "edit" });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current).toMatchObject({
      status: "error",
      message: "Offline",
    });
    rerender({ content: null });
    expect(result.current.status).toBe("idle");
  });
});
