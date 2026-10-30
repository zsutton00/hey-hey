import {
  EntityType,
  type AttentionEventResponse,
} from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";
import { getRecentlyViewedEntityIconType } from "./recentlyViewed";

const event = (
  entity: AttentionEventResponse["entity"],
): AttentionEventResponse => ({
  id: "attention-event",
  entityType: EntityType.Task,
  entityId: "task-1",
  entityName: "Tracked work",
  entity,
  durationMs: 1000,
  focusStart: "2026-10-24T00:00:00.000Z",
  focusEnd: "2026-10-24T00:00:01.000Z",
});

describe("getRecentlyViewedEntityIconType", () => {
  it.each([
    ["FEATURE", "feature"],
    ["GOAL", "goal"],
  ])("uses the %s work-item icon for API task events", (type, icon) => {
    expect(getRecentlyViewedEntityIconType(event({ type }))).toBe(icon);
  });

  it("keeps the task icon for other or unavailable task data", () => {
    expect(getRecentlyViewedEntityIconType(event({ type: "CUSTOM" }))).toBe(
      EntityType.Task,
    );
    expect(getRecentlyViewedEntityIconType(event(null))).toBe(EntityType.Task);
  });

  it("keeps non-task icons even when their payload has a work-item type", () => {
    expect(
      getRecentlyViewedEntityIconType({
        ...event({ type: "FEATURE" }),
        entityType: EntityType.DesignDoc,
      }),
    ).toBe(EntityType.DesignDoc);
  });
});
