import { describe, it, expect } from "vitest";
import {
  MENTION_MAX_QUERY_LENGTH,
  shouldSearchMentionQuery,
} from "../mentionQuery";

describe("shouldSearchMentionQuery", () => {
  it('rejects an empty query so bare "@" stays literal', () => {
    expect(shouldSearchMentionQuery("")).toBe(false);
  });

  it("rejects queries starting with whitespace or punctuation", () => {
    expect(shouldSearchMentionQuery("-")).toBe(false);
    expect(shouldSearchMentionQuery(" ")).toBe(false);
    expect(shouldSearchMentionQuery(":task")).toBe(false);
    expect(shouldSearchMentionQuery(".name")).toBe(false);
    expect(shouldSearchMentionQuery("/foo")).toBe(false);
  });

  it("allows queries starting with a letter or digit", () => {
    expect(shouldSearchMentionQuery("a")).toBe(true);
    expect(shouldSearchMentionQuery("Z")).toBe(true);
    expect(shouldSearchMentionQuery("7-eleven")).toBe(true);
  });

  it("accepts arbitrary characters after the first alphanumeric char", () => {
    expect(shouldSearchMentionQuery("Test: My cool task -")).toBe(true);
    expect(shouldSearchMentionQuery("foo/bar|baz")).toBe(true);
    expect(shouldSearchMentionQuery("name with [brackets]")).toBe(true);
  });

  it("rejects queries longer than the max length", () => {
    const tooLong = "a".repeat(MENTION_MAX_QUERY_LENGTH + 1);
    expect(shouldSearchMentionQuery(tooLong)).toBe(false);
    expect(shouldSearchMentionQuery("a".repeat(MENTION_MAX_QUERY_LENGTH))).toBe(
      true
    );
  });
});
