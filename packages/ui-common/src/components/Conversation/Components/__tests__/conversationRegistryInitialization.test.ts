import { expect, it } from "vitest";

// Keep these imports sequential: importing the context first reproduces the
// initialization order that previously exposed the registry cycle. Loading the
// full module graph belongs to collection, outside the assertion timeout.
const context = await import("../ConversationContext");
const registry = await import("../../../LlmForms/Registry/Registry");

it("loads conversation context before registry fields without an initialization cycle", () => {
  expect(context.ConversationProvider).toBeTypeOf("function");
  expect(registry.FIELD_REGISTRY.plan_gaps_design_docs.Component).toBeTypeOf(
    "function",
  );
});
