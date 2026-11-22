import { describe, expect, it } from "vitest";
import type { ServiceDto } from "../../../../../api";
import {
  filterCodingSessionServices,
  resolveInitialServiceSelection,
  resolveCodingSetupSelection,
} from "../useAgentSetup";

const createService = (
  id: string,
  projectId: string,
  status: ServiceDto["status"],
  archivedAt?: string,
): ServiceDto => ({
  id,
  name: id,
  organizationId: "org-1",
  projectId,
  status,
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
  ...(archivedAt ? { archivedAt } : {}),
});

describe("filterCodingSessionServices", () => {
  it("keeps only non-archived services owned by the active project", () => {
    const services = [
      createService("active", "project-1", "ACTIVE"),
      createService("deprecated", "project-1", "DEPRECATED"),
      createService("archived", "project-1", "ARCHIVED"),
      createService(
        "archive-timestamp",
        "project-1",
        "ACTIVE",
        "2026-07-30T00:00:00Z",
      ),
      createService("other-project", "project-2", "ACTIVE"),
    ];

    expect(
      filterCodingSessionServices(services, "project-1").map(
        (service) => service.id,
      ),
    ).toEqual(["active", "deprecated"]);
  });
});

describe("resolveCodingSetupSelection", () => {
  it("prefers bound service id over task-linked services when resetting selection", () => {
    const result = resolveCodingSetupSelection({
      selection: {
        agentSessionId: "session-1",
        selectedServiceId: "service-user",
        selectedProvider: "codex",
      },
      agentSessionId: "session-2",
      boundServiceId: "service-bound",
      taskServiceIds: ["service-task"],
      boundProvider: null,
    });

    expect(result.selectedServiceId).toBe("service-bound");
  });

  it("uses the single task-linked service as the fallback when no bound service is present", () => {
    const result = resolveCodingSetupSelection({
      selection: {
        agentSessionId: "session-1",
        selectedServiceId: null,
        selectedProvider: null,
      },
      agentSessionId: "session-1",
      boundServiceId: null,
      taskServiceIds: ["service-task"],
      boundProvider: null,
    });

    expect(result.selectedServiceId).toBe("service-task");
  });

  it("does not auto-select when the task is linked to multiple services", () => {
    const result = resolveCodingSetupSelection({
      selection: {
        agentSessionId: "session-1",
        selectedServiceId: null,
        selectedProvider: null,
      },
      agentSessionId: "session-1",
      boundServiceId: null,
      taskServiceIds: ["service-task-a", "service-task-b"],
      boundProvider: null,
    });

    expect(result.selectedServiceId).toBeNull();
  });

  it("preserves explicit user selection for the active coding session", () => {
    const result = resolveCodingSetupSelection({
      selection: {
        agentSessionId: "session-1",
        selectedServiceId: "service-user",
        selectedProvider: null,
      },
      agentSessionId: "session-1",
      boundServiceId: null,
      taskServiceIds: ["service-task"],
      boundProvider: null,
    });

    expect(result.selectedServiceId).toBe("service-user");
  });
});

describe("resolveInitialServiceSelection", () => {
  it("selects every usable task-linked Service for an unbound launch", () => {
    expect(
      resolveInitialServiceSelection({
        usableTaskServiceIds: ["service-a", "service-b", "other-project"],
        usableServiceIds: new Set(["service-a", "service-b"]),
        boundServiceId: null,
        persistedServiceIds: null,
        persistedLaunchServiceId: null,
      }),
    ).toEqual({
      selectedServiceIds: ["service-a", "service-b"],
      launchServiceId: "service-a",
    });
  });

  it("keeps an explicit Service scope and launch anchor inside that scope", () => {
    expect(
      resolveInitialServiceSelection({
        usableTaskServiceIds: ["service-a", "service-b"],
        usableServiceIds: new Set(["service-a", "service-b"]),
        boundServiceId: "service-b",
        persistedServiceIds: ["service-a", "service-a", "unknown"],
        persistedLaunchServiceId: "unknown",
      }),
    ).toEqual({
      selectedServiceIds: ["service-b"],
      launchServiceId: "service-b",
    });
  });

  it("selects the only usable task-linked Service", () => {
    expect(
      resolveInitialServiceSelection({
        usableTaskServiceIds: ["service-a", "archived"],
        usableServiceIds: new Set(["service-a", "service-b"]),
        boundServiceId: null,
        persistedServiceIds: null,
        persistedLaunchServiceId: null,
      }),
    ).toEqual({
      selectedServiceIds: ["service-a"],
      launchServiceId: "service-a",
    });
  });

  it("selects the only usable project Service when the task links none", () => {
    expect(
      resolveInitialServiceSelection({
        usableTaskServiceIds: [],
        usableServiceIds: new Set(["service-a"]),
        boundServiceId: null,
        persistedServiceIds: null,
        persistedLaunchServiceId: null,
      }),
    ).toEqual({
      selectedServiceIds: ["service-a"],
      launchServiceId: "service-a",
    });
  });

  it("leaves several unlinked project Services unselected", () => {
    expect(
      resolveInitialServiceSelection({
        usableTaskServiceIds: [],
        usableServiceIds: new Set(["service-a", "service-b"]),
        boundServiceId: null,
        persistedServiceIds: null,
        persistedLaunchServiceId: null,
      }),
    ).toEqual({ selectedServiceIds: [], launchServiceId: null });
  });

  it("keeps an explicit empty selection", () => {
    expect(
      resolveInitialServiceSelection({
        usableTaskServiceIds: ["service-a"],
        usableServiceIds: new Set(["service-a"]),
        boundServiceId: null,
        persistedServiceIds: [],
        persistedLaunchServiceId: null,
      }),
    ).toEqual({ selectedServiceIds: [], launchServiceId: null });
  });
});
