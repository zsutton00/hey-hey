import {
  parseMentionToken,
  createMentionToken,
  deserializeContent,
  renderMentionsAsText,
} from "../SmarterTextAreaCard/mentionUtils";

describe("Mention utilities", () => {
  describe("parseMentionToken", () => {
    it("should parse a valid mention token", () => {
      const token = "@[task:123|Build login page]";
      const result = parseMentionToken(token);
      expect(result).toEqual({
        entityType: "task",
        entityId: "123",
        entityName: "Build login page",
      });
    });

    it("should return null for invalid token", () => {
      const token = "@[invalid]";
      const result = parseMentionToken(token);
      expect(result).toBeNull();
    });

    it("should handle entity names with special characters", () => {
      const token = "@[initiative:456|Q4 Goals: Build & Deploy]";
      const result = parseMentionToken(token);
      expect(result).toEqual({
        entityType: "initiative",
        entityId: "456",
        entityName: "Q4 Goals: Build & Deploy",
      });
    });
  });

  describe("createMentionToken", () => {
    it("should serialize mention objects to token strings", () => {
      const mentions = [
        { entityType: "task", entityId: "123", entityName: "Build login" },
        { entityType: "initiative", entityId: "456", entityName: "Q4 Goals" },
      ];

      const tokens = mentions.map((mention) => createMentionToken(mention));

      expect(tokens).toEqual([
        "@[task:123|Build login]",
        "@[initiative:456|Q4 Goals]",
      ]);
    });
  });

  describe("renderMentionsAsText", () => {
    it("should render mention tokens as display text", () => {
      const content =
        "Check out @[task:123|Build login] and @[initiative:456|Q4 Goals]";
      const rendered = renderMentionsAsText(content);
      expect(rendered).toBe("Check out @Build login and @Q4 Goals");
    });
  });

  describe("deserializeContent", () => {
    it("should extract mentions from content string", () => {
      const content =
        "Check out @[task:123|Build login] and @[initiative:456|Q4 Goals]";
      const mentions = deserializeContent(content);
      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toEqual({
        entityType: "task",
        entityId: "123",
        entityName: "Build login",
      });
    });

    it("should handle plain text without mentions", () => {
      const content = "This is just plain text";
      const mentions = deserializeContent(content);
      expect(mentions).toHaveLength(0);
    });
  });
});
