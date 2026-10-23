import { describe, expect, it, vi } from "vitest";
import {
  createBrowserApiRuntime,
  registerApiRuntime,
  tasksClient,
} from "../shared";
import { getApiRuntime, getApiClient } from "../runtime";
import { dataClient } from "../dataClient";

// Browser and CLI entrypoints must observe the same registered runtime.
describe("shared runtime registration", () => {
  it("routes existing clients and direct data requests to the latest registered runtime", async () => {
    const first = createBrowserApiRuntime({ baseUrl: "https://first.test" });
    registerApiRuntime(first);
    const second = createBrowserApiRuntime({ baseUrl: "https://second.test" });
    const failure = new Error("registered-runtime");
    const getTask = vi
      .spyOn(
        second.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet",
      )
      .mockRejectedValue(failure);
    const request = vi
      .spyOn(second.transport, "request")
      .mockResolvedValue({ data: { ok: true } });
    const registeredClient = registerApiRuntime(second);

    expect(getApiRuntime()).toBe(second);
    expect(getApiClient()).toBe(registeredClient);
    await expect(
      tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
        organizationId: "org",
        projectId: "project",
        taskId: "task",
      }),
    ).rejects.toBe(failure);
    await dataClient.request({ url: "/probe" });
    expect(getTask).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/probe" }),
    );
  });
});
