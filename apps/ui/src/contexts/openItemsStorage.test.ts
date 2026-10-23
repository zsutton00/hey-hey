import { describe, expect, it } from "vitest";
import { parseOpenItems, readPersistedOpenItems } from "./openItemsStorage";

describe("Open Items migration source", () => {
  it("keeps valid group state and discards dangling membership and browser authority fields", () => {
    const record = readPersistedOpenItems(
      JSON.stringify({
        version: 1,
        items: [
          {
            entityType: "task",
            entityId: "task",
            presentation: { kind: "task", label: "Task", taskType: "STANDARD" },
            groupId: "local",
          },
          { entityType: "task", entityId: "other", groupId: "missing" },
        ],
        groups: [
          { id: "local", name: "  In   progress ", order: 5, collapsed: true },
        ],
        revisions: { task: { content: 99, position: 100 } },
        removed: { task: 100 },
        groupRevisions: { local: 90 },
      }),
    );
    expect(record.groups).toEqual([
      { id: "local", name: "In progress", order: 0, collapsed: true },
    ]);
    expect(record.items[0]?.groupId).toBe("local");
    expect(record.items[1]?.groupId).toBeUndefined();
    expect(record).not.toHaveProperty("revisions");
    expect(record).not.toHaveProperty("removed");
    expect(record).not.toHaveProperty("groupRevisions");
  });
  it("rejects unsupported records and invalid item types", () => {
    expect(
      parseOpenItems(
        JSON.stringify({
          version: 2,
          items: [{ entityType: "task", entityId: "task" }],
        }),
      ),
    ).toEqual([]);
    expect(
      parseOpenItems(
        JSON.stringify({
          version: 1,
          items: [{ entityType: "message", entityId: "message" }, null],
        }),
      ),
    ).toEqual([]);
    expect(parseOpenItems("invalid")).toEqual([]);
  });
});
