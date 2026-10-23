import { describe, it, expect } from "vitest";
import { ListQueryMap } from "../ListQueryMap";

describe("ListQueryMap", () => {
  describe("findKeysByFieldValue", () => {
    it("should find query keys containing a specific field=value segment", () => {
      const map = new ListQueryMap(
        new Map([
          [
            "entityType=task::organizationId=org-1::projectId=proj-1::parentTaskId=parent-A",
            ["item-1", "item-2"],
          ],
          [
            "entityType=task::organizationId=org-1::projectId=proj-1::parentTaskId=parent-B",
            ["item-3"],
          ],
          [
            "entityType=task::organizationId=org-1::projectId=proj-1::parentTaskId=null",
            ["item-4"],
          ],
        ])
      );

      const matches = map.findKeysByFieldValue("parentTaskId", "parent-A");
      expect(matches).toHaveLength(1);
      expect(matches[0]).toContain("parentTaskId=parent-A");
    });

    it("should return multiple matches when several queries share a field value", () => {
      const map = new ListQueryMap(
        new Map([
          [
            "entityType=task::orgId=org-1::parentTaskId=parent-A::status=active",
            ["item-1"],
          ],
          [
            "entityType=task::orgId=org-1::parentTaskId=parent-A::status=backlog",
            ["item-2"],
          ],
          [
            "entityType=task::orgId=org-1::parentTaskId=parent-B::status=active",
            ["item-3"],
          ],
        ])
      );

      const matches = map.findKeysByFieldValue("parentTaskId", "parent-A");
      expect(matches).toHaveLength(2);
    });

    it("should return empty array when no query keys match", () => {
      const map = new ListQueryMap(
        new Map([["entityType=task::parentTaskId=parent-A", ["item-1"]]])
      );

      const matches = map.findKeysByFieldValue("parentTaskId", "parent-Z");
      expect(matches).toHaveLength(0);
    });

    it("should match null values", () => {
      const map = new ListQueryMap(
        new Map([
          ["entityType=task::parentTaskId=null", ["item-1"]],
          ["entityType=task::parentTaskId=parent-A", ["item-2"]],
        ])
      );

      const matches = map.findKeysByFieldValue("parentTaskId", "null");
      expect(matches).toHaveLength(1);
      expect(matches[0]).toContain("parentTaskId=null");
    });

    it("should return empty array on empty map", () => {
      const map = new ListQueryMap();
      const matches = map.findKeysByFieldValue("parentTaskId", "parent-A");
      expect(matches).toHaveLength(0);
    });
  });
});
