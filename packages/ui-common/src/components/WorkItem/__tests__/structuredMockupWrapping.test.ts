import { describe, expect, it } from "vitest";
import type { StructuredMockupPuckData } from "../../shared/structuredMockupPuck";
import { wrapStructuredMockupSiblings } from "../structuredMockupWrapping";

const leaf = (id: string) => ({
  type: "text" as const,
  props: {
    id,
    widthMode: "fit" as const,
    widthValue: 240,
    heightMode: "content" as const,
    heightValue: 80,
    text: id,
  },
});

const data = (content: StructuredMockupPuckData["content"]) => ({
  content,
  root: {},
});

describe("wrapStructuredMockupSiblings", () => {
  it("wraps contiguous root siblings in document order without mutating them", () => {
    const first = leaf("first");
    const second = leaf("second");
    const third = leaf("third");
    const original = data([first, second, third]);
    const result = wrapStructuredMockupSiblings({
      data: original,
      selectors: [
        { index: 2, zone: "root:default-zone" },
        { index: 1, zone: "root:default-zone" },
      ],
      wrapperId: "wrapper",
      direction: "vertical",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected wrapping to succeed");
    expect(result.wrapperSelector).toEqual({
      index: 1,
      zone: "root:default-zone",
    });
    expect(result.data.content).toHaveLength(2);
    expect(result.data.content[0]).toBe(first);
    expect(result.data.content[1]).toMatchObject({
      type: "column",
      props: { id: "wrapper", direction: "column" },
    });
    const wrapper = result.data.content[1];
    if (wrapper.type !== "column") throw new Error("Expected column wrapper");
    expect(wrapper.props.children).toEqual([second, third]);
    expect(wrapper.props.children[0]).toBe(second);
    expect(wrapper.props.children[1]).toBe(third);
    expect(original.content).toEqual([first, second, third]);
  });

  it("wraps one nested sibling horizontally and preserves unrelated branches", () => {
    const selected = leaf("selected");
    const other = leaf("other");
    const parent = {
      type: "column" as const,
      props: {
        id: "parent",
        widthMode: "fit" as const,
        widthValue: 240,
        heightMode: "content" as const,
        heightValue: 80,
        direction: "column" as const,
        gap: 8,
        padding: 8,
        justify: "start" as const,
        align: "stretch" as const,
        children: [selected, other],
      },
    };
    const untouched = leaf("untouched");
    const original = data([parent, untouched]);
    const result = wrapStructuredMockupSiblings({
      data: original,
      selectors: [{ index: 0, zone: "parent:children" }],
      wrapperId: "nested-wrapper",
      direction: "horizontal",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected wrapping to succeed");
    expect(result.data.content[1]).toBe(untouched);
    const nextParent = result.data.content[0];
    if (nextParent.type !== "column") throw new Error("Expected parent");
    expect(nextParent.props.children[0]).toMatchObject({
      type: "row",
      props: { id: "nested-wrapper", direction: "row" },
    });
    expect(nextParent.props.children[1]).toBe(other);
  });

  it.each([
    {
      name: "an empty selection",
      selectors: [],
      reason: "empty-selection",
    },
    {
      name: "selectors from different parents",
      selectors: [
        { index: 0, zone: "root:default-zone" },
        { index: 1, zone: "parent:children" },
      ],
      reason: "cross-parent-selection",
    },
    {
      name: "a missing selector",
      selectors: [{ index: 5, zone: "root:default-zone" }],
      reason: "missing-selection",
    },
    {
      name: "a non-contiguous range",
      selectors: [
        { index: 0, zone: "root:default-zone" },
        { index: 2, zone: "root:default-zone" },
      ],
      reason: "non-contiguous-selection",
    },
  ])("rejects $name", ({ selectors, reason }) => {
    const original = data([leaf("one"), leaf("two"), leaf("three")]);
    const result = wrapStructuredMockupSiblings({
      data: original,
      selectors,
      wrapperId: "wrapper",
      direction: "vertical",
    });
    expect(result).toEqual({ ok: false, reason });
  });
});
