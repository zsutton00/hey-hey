import { describe, expect, it, vi } from "vitest";
import { syncTaskServiceLinks } from "./planStageTaskServiceLinks";

describe("syncTaskServiceLinks", () => {
  it("removes deselected links and creates newly selected links", async () => {
    const removeLink = vi.fn().mockResolvedValue(undefined);
    const createLink = vi.fn().mockResolvedValue(undefined);

    await syncTaskServiceLinks({
      client: {
        removeServiceLink: removeLink,
        createServiceLink: createLink,
      },
      organizationId: "org-1",
      taskId: "task-1",
      currentServiceIds: ["service-kept", "service-removed"],
      nextServiceIds: ["service-kept", "service-added"],
    });

    expect(removeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        serviceId: "service-removed",
        entityType: "task",
        entityId: "task-1",
      })
    );
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        serviceId: "service-added",
        serviceLinkDto: {
          entityType: "task",
          entityId: "task-1",
        },
      })
    );
  });
});
