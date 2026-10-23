/**
 * Tests that inline constructs (mentions and inline code spans) stay atomic
 * through word-level diffing, so they are never split across diff operations
 * (which would break mention/code rendering downstream).
 */
import {
  diffWordsInlineAware,
  diffWordsWithSpaceInlineAware,
} from "../inlineTokenDiff";
import { applyDiffOperations, calculateWordDiff } from "../textDiff";

const MENTION =
  "@[task:4e3da6b7-60d5-4fcc-9538-95383c6a0e42|Goal V2: the standing PM conversation]";

describe("inlineTokenDiff", () => {
  test("keeps an inserted mention token in a single change", () => {
    const oldText = "Coverage is pending.";
    const newText = `Coverage is delivered by ${MENTION}.`;

    const changes = diffWordsInlineAware(oldText, newText);
    const added = changes.filter((c) => c.added);

    expect(added.some((c) => c.value.includes(MENTION))).toBe(true);
    // The token must never appear only partially in any single change.
    for (const change of changes) {
      if (change.value.includes("@[") || change.value.includes("]")) {
        expect(change.value).toContain(MENTION);
      }
    }
  });

  test("treats an unchanged mention as equal even when neighbours change", () => {
    const oldText = `delivered by ${MENTION} yesterday`;
    const newText = `delivered by ${MENTION} today`;

    const changes = diffWordsWithSpaceInlineAware(oldText, newText);
    const equalChange = changes.find((c) => !c.added && !c.removed);

    expect(equalChange?.value).toContain(MENTION);
    expect(changes.some((c) => c.added && c.value.includes("today"))).toBe(
      true
    );
    expect(
      changes.some((c) => c.removed && c.value.includes("yesterday"))
    ).toBe(true);
  });

  test("keeps an inline code span atomic across a changed line", () => {
    const oldText = "Each runner fulfills compaction via an adapter.";
    const newText = "Each runner fulfills `compact_run` via an adapter.";

    const changes = diffWordsWithSpaceInlineAware(oldText, newText);
    const added = changes.filter((c) => c.added);

    expect(added.some((c) => c.value.includes("`compact_run`"))).toBe(true);
    // No change object holds a dangling, unbalanced backtick.
    for (const change of changes) {
      const backticks = (change.value.match(/`/g) ?? []).length;
      expect(backticks % 2).toBe(0);
    }
  });

  test("calculateWordDiff yields whole-token operations and reconstructs exactly", () => {
    const oldText = "The coverage is pending review.";
    const newText = `The coverage is delivered by ${MENTION} and \`compact_run\` now.`;

    const { operations } = calculateWordDiff(oldText, newText);

    expect(
      operations.some(
        (op) =>
          op.newText.includes(MENTION) || op.originalText.includes(MENTION)
      )
    ).toBe(true);
    expect(operations.some((op) => op.newText.includes("`compact_run`"))).toBe(
      true
    );

    // Accepting every change must reproduce newText verbatim (tokens intact).
    const acceptAll = new Set(operations.map((_op, index) => index));
    expect(applyDiffOperations(operations, acceptAll)).toBe(newText);
  });

  test("reconstructs exactly when an atomic token is replaced by a different one", () => {
    // Regression: distinct sentinels must diff as a clean replace. A multi-char
    // sentinel with shared delimiters would mis-align here and lose the token.
    const otherMention = "@[task:zzz-999|A completely different goal]";
    const oldText = `see ${MENTION} and \`old_fn\` over here`;
    const newText = `see ${otherMention} and \`new_fn\` over here`;

    for (const changes of [
      diffWordsInlineAware(oldText, newText),
      diffWordsWithSpaceInlineAware(oldText, newText),
    ]) {
      expect(changes.map((c) => (c.removed ? "" : c.value)).join("")).toBe(
        newText
      );
      expect(changes.map((c) => (c.added ? "" : c.value)).join("")).toBe(
        oldText
      );
    }
  });

  test("reconstructs exactly across multiple lines", () => {
    const oldText = "## Head\n\nfirst pending.\n\nlast `code` line.";
    const newText = `## Head\n\nfirst delivered by ${MENTION}.\n\nlast \`compact_run\` line.`;

    const changes = diffWordsWithSpaceInlineAware(oldText, newText);
    expect(changes.map((c) => (c.removed ? "" : c.value)).join("")).toBe(
      newText
    );
    expect(changes.map((c) => (c.added ? "" : c.value)).join("")).toBe(oldText);
  });

  test("keeps bold and strikethrough atomic when replaced", () => {
    const oldText = "Note: **the old policy** and ~~drop this~~ remain.";
    const newText = "Note: **the new policy** and ~~drop that~~ remain.";

    for (const changes of [
      diffWordsInlineAware(oldText, newText),
      diffWordsWithSpaceInlineAware(oldText, newText),
    ]) {
      expect(changes.map((c) => (c.removed ? "" : c.value)).join("")).toBe(
        newText
      );
      // The bold span is never split: any change touching `**` carries a pair.
      for (const change of changes) {
        const stars = (change.value.match(/\*\*/g) ?? []).length;
        expect(stars % 2).toBe(0);
      }
    }
  });

  test("is a no-op for text without inline tokens", () => {
    const changes = diffWordsInlineAware("hello world", "hello brave world");
    expect(changes.map((c) => c.value).join("")).toBe("hello brave world");
  });
});
