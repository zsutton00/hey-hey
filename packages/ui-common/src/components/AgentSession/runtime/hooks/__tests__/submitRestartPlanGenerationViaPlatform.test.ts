import { describe, expect, it, vi } from "vitest";
import type { AxiosResponse } from "axios";
import type { RestartPlanGenerationResponseDto } from "../../../../../api/index";
import {
  submitRestartPlanGenerationViaPlatform,
  type PlatformRestartPoster,
} from "../submitRestartPlanGenerationViaPlatform";

const buildResponse = <T>(data: T): AxiosResponse<T> =>
  ({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as AxiosResponse<T>["config"],
  } as AxiosResponse<T>);

const buildPoster = (
  response: RestartPlanGenerationResponseDto
): {
  apiClient: PlatformRestartPoster;
  restartPlanGeneration: ReturnType<typeof vi.fn>;
} => {
  const restartPlanGeneration = vi
    .fn()
    .mockResolvedValue(buildResponse(response));
  return { apiClient: { restartPlanGeneration }, restartPlanGeneration };
};

const baseInput = (apiClient: PlatformRestartPoster) => ({
  apiClient,
  organizationId: "org-1",
  projectId: "proj-1",
  agentSessionId: "as-1",
});

describe("submitRestartPlanGenerationViaPlatform", () => {
  it("returns the relaunched conversation id on success", async () => {
    const { apiClient, restartPlanGeneration } = buildPoster({
      restarted: true,
      conversationId: "conv-new",
    });

    const out = await submitRestartPlanGenerationViaPlatform(
      baseInput(apiClient)
    );

    expect(out).toEqual({ ok: true, conversationId: "conv-new" });
    expect(restartPlanGeneration).toHaveBeenCalledTimes(1);
    expect(restartPlanGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "as-1",
      })
    );
  });

  it("returns an error when the organization context is missing", async () => {
    const { apiClient, restartPlanGeneration } = buildPoster({
      restarted: true,
      conversationId: "conv-new",
    });

    const out = await submitRestartPlanGenerationViaPlatform({
      ...baseInput(apiClient),
      organizationId: null,
    });

    expect(out.ok).toBe(false);
    expect(restartPlanGeneration).not.toHaveBeenCalled();
  });

  it("returns an error when the agent session is missing", async () => {
    const { apiClient, restartPlanGeneration } = buildPoster({
      restarted: true,
      conversationId: "conv-new",
    });

    const out = await submitRestartPlanGenerationViaPlatform({
      ...baseInput(apiClient),
      agentSessionId: null,
    });

    expect(out.ok).toBe(false);
    expect(restartPlanGeneration).not.toHaveBeenCalled();
  });

  it("surfaces an error when the restart succeeds but no conversation id comes back", async () => {
    const { apiClient } = buildPoster({ restarted: true });

    const out = await submitRestartPlanGenerationViaPlatform(
      baseInput(apiClient)
    );

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/no new conversation/i);
    }
  });

  it("surfaces an error on an idempotent no-op (nothing to restart)", async () => {
    const { apiClient } = buildPoster({ restarted: false });

    const out = await submitRestartPlanGenerationViaPlatform(
      baseInput(apiClient)
    );

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/no active plan-generation run/i);
    }
  });

  it("surfaces the error when the api client throws", async () => {
    const restartPlanGeneration = vi
      .fn()
      .mockRejectedValue(new Error("network down"));
    const apiClient: PlatformRestartPoster = { restartPlanGeneration };

    const out = await submitRestartPlanGenerationViaPlatform(
      baseInput(apiClient)
    );

    expect(out).toEqual({ ok: false, error: "network down" });
  });
});
