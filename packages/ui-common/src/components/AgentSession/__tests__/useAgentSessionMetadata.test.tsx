import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AgentSessionDtoProviderEnum,
  AgentSessionServicePlaceKind,
  type AgentSessionDto,
} from "../../../api";
import { useAgentSessionMetadata } from "../useAgentSessionMetadata";

const useServicesMock = vi.hoisted(() => vi.fn());
vi.mock("../../../data/hooks/useServices", () => ({
  useServices: useServicesMock,
}));

const recordedAt = "2026-11-19T00:00:00.000Z";

const session = {
  organizationId: "org-1",
  projectId: "project-1",
  provider: AgentSessionDtoProviderEnum.Codex,
  config: {
    type: AgentSessionConfigV2TypeEnum.CodingSession,
    version: AgentSessionConfigV2VersionEnum.V2,
    model: "gpt-5-codex",
  },
  serviceIds: ["web", "api"],
  servicePlaces: [
    {
      serviceId: "web",
      kind: AgentSessionServicePlaceKind.Worktree,
      branch: "feature-x",
      worktreePath: "/w/web",
      recordedAt,
    },
    {
      serviceId: "api",
      kind: AgentSessionServicePlaceKind.MainFolder,
      branch: "dev",
      recordedAt,
    },
  ],
} as AgentSessionDto;

describe("useAgentSessionMetadata", () => {
  beforeEach(() => {
    useServicesMock.mockReturnValue({
      services: [
        { id: "web", name: "Web UI" },
        { id: "api", name: "API" },
      ],
    });
  });

  it("looks up the project's Service names so every surface shows each Service's place", () => {
    const { result } = renderHook(() => useAgentSessionMetadata(session));

    expect(result.current?.servicePlaces).toEqual([
      {
        serviceName: "Web UI",
        place: { kind: "worktree", branch: "feature-x" },
      },
      { serviceName: "API", place: { kind: "main-folder", branch: "dev" } },
    ]);
    expect(useServicesMock).toHaveBeenCalledWith("org-1", {
      projectId: "project-1",
      enabled: true,
    });
  });

  it("returns nothing and skips the Service lookup when there is no session", () => {
    const { result } = renderHook(() => useAgentSessionMetadata(null));

    expect(result.current).toBeUndefined();
    expect(useServicesMock).toHaveBeenCalledWith(undefined, {
      projectId: undefined,
      enabled: false,
    });
  });
});
