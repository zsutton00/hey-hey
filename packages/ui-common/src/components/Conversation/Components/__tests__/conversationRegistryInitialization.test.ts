import { expect, it, vi } from "vitest";

it("loads conversation context before registry fields without an initialization cycle", async () => {
  vi.resetModules();
  const context = await import("../ConversationContext");
  const registry = await import("../../../LlmForms/Registry/Registry");

  expect(context.ConversationProvider).toBeTypeOf("function");
  expect(registry.FIELD_REGISTRY.plan_gaps_design_docs.Component).toBeTypeOf(
    "function"
  );
});
