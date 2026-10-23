import { describe, it, expect, vi } from "vitest";

const createMentionNodeMock = vi.fn((mention: unknown) => ({
  __mention: mention,
  getMention: () => mention,
}));
const isMentionNodeMock = vi.fn(
  (node: unknown): node is { getMention: () => unknown } =>
    !!node &&
    typeof (node as { getMention?: unknown }).getMention === "function"
);

vi.mock("../../SmarterTextAreaCard/MentionNode", () => ({
  $createMentionNode: (mention: unknown) => createMentionNodeMock(mention),
  $isMentionNode: (node: unknown) => isMentionNodeMock(node),
  MentionNode: class MockMentionNode {},
}));

import { MENTION_MARKDOWN_TRANSFORMER } from "../mentionMarkdownTransformer";
import type { TextMatchTransformer } from "@lexical/markdown";

const transformer = MENTION_MARKDOWN_TRANSFORMER as TextMatchTransformer;

describe("MENTION_MARKDOWN_TRANSFORMER", () => {
  const expectedMention = {
    entityType: "task",
    entityId: "abc-123",
    entityName: "Task A",
  };
  const unescapedToken = "@[task:abc-123|Task A]";
  const escapedToken = "@\\[task:abc-123|Task A]";

  describe("importRegExp", () => {
    it("matches the unescaped token", () => {
      const importRegExp = transformer.importRegExp;
      if (!(importRegExp instanceof RegExp)) {
        throw new Error("importRegExp must be a RegExp");
      }

      const match = unescapedToken.match(importRegExp);

      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("task");
      expect(match?.[2]).toBe("abc-123");
      expect(match?.[3]).toBe("Task A");
    });

    it("matches the escaped token with the same capture groups", () => {
      const importRegExp = transformer.importRegExp;
      if (!(importRegExp instanceof RegExp)) {
        throw new Error("importRegExp must be a RegExp");
      }

      const escapedMatch = escapedToken.match(importRegExp);
      const unescapedMatch = unescapedToken.match(importRegExp);

      expect(escapedMatch).not.toBeNull();
      expect(escapedMatch?.[1]).toBe(unescapedMatch?.[1]);
      expect(escapedMatch?.[2]).toBe(unescapedMatch?.[2]);
      expect(escapedMatch?.[3]).toBe(unescapedMatch?.[3]);
    });
  });

  describe("replace", () => {
    it("creates a MentionNode equivalent to the unescaped form when given an escaped match", () => {
      createMentionNodeMock.mockClear();

      const importRegExp = transformer.importRegExp;
      if (!(importRegExp instanceof RegExp)) {
        throw new Error("importRegExp must be a RegExp");
      }

      const escapedMatch = escapedToken.match(importRegExp);
      const unescapedMatch = unescapedToken.match(importRegExp);
      if (!escapedMatch || !unescapedMatch) {
        throw new Error("expected both variants to match");
      }

      const escapedTextNode = { replace: vi.fn() };
      const unescapedTextNode = { replace: vi.fn() };

      transformer.replace?.(
        escapedTextNode as unknown as Parameters<
          NonNullable<TextMatchTransformer["replace"]>
        >[0],
        escapedMatch as unknown as RegExpMatchArray
      );
      transformer.replace?.(
        unescapedTextNode as unknown as Parameters<
          NonNullable<TextMatchTransformer["replace"]>
        >[0],
        unescapedMatch as unknown as RegExpMatchArray
      );

      expect(createMentionNodeMock).toHaveBeenCalledTimes(2);
      expect(createMentionNodeMock.mock.calls[0]?.[0]).toEqual(expectedMention);
      expect(createMentionNodeMock.mock.calls[1]?.[0]).toEqual(expectedMention);
      expect(escapedTextNode.replace).toHaveBeenCalledTimes(1);
      expect(unescapedTextNode.replace).toHaveBeenCalledTimes(1);
    });
  });

  describe("export", () => {
    it("re-exports a MentionNode as the canonical unescaped token", () => {
      const stubNode = {
        getMention: () => expectedMention,
      };

      const exported = transformer.export?.(
        stubNode as unknown as Parameters<
          NonNullable<TextMatchTransformer["export"]>
        >[0],
        () => "",
        () => ""
      );

      expect(exported).toBe(unescapedToken);
      expect(exported).not.toContain("\\");
    });
  });

  it("round-trips an escaped token through import then export to the unescaped canonical form", () => {
    createMentionNodeMock.mockClear();

    const importRegExp = transformer.importRegExp;
    if (!(importRegExp instanceof RegExp)) {
      throw new Error("importRegExp must be a RegExp");
    }

    const match = escapedToken.match(importRegExp);
    if (!match) {
      throw new Error("escaped token must match importRegExp");
    }

    const textNode = { replace: vi.fn() };
    transformer.replace?.(
      textNode as unknown as Parameters<
        NonNullable<TextMatchTransformer["replace"]>
      >[0],
      match as unknown as RegExpMatchArray
    );

    const created = createMentionNodeMock.mock.results[0]?.value as {
      getMention: () => unknown;
    };

    const exported = transformer.export?.(
      created as unknown as Parameters<
        NonNullable<TextMatchTransformer["export"]>
      >[0],
      () => "",
      () => ""
    );

    expect(exported).toBe(unescapedToken);
  });
});
