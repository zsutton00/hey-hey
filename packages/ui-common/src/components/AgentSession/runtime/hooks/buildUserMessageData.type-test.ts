/**
 * Compile-time barrier test for {@link buildUserMessageData}.
 *
 * This file is intentionally NOT a `*.test.ts`: those are excluded from
 * `tsconfig` and so are skipped by `tsc --noEmit`. Keeping it a plain `.ts`
 * means `pnpm type-check` evaluates every `@ts-expect-error` below, turning the
 * legacy-envelope regression into a build failure. It imports the helper but is
 * never imported itself, so tsup never bundles it — it exists only to be
 * type-checked.
 *
 * Each `@ts-expect-error` asserts that authoring a legacy dispatch field at the
 * `data` root fails to compile. If a future change makes any of them compile,
 * `tsc` reports the now-unused directive and the build breaks — exactly the
 * signal this barrier exists to give.
 */
import { buildAgentInput, buildUserMessageData } from "./directTriggerInput";

// --- Sanctioned shapes must keep compiling -----------------------------------

// The typed dispatch instruction rides the nested `agentInput` envelope.
void buildUserMessageData({
  agentInput: buildAgentInput({ promptType: "final_assessment" }),
});

// Freeform `round{N}_{fieldName}` keys and server-read extras ride the open bag.
void buildUserMessageData({
  comment: "looks good",
  references: { resolved: [], unresolved: [] },
  attachUserMessageData: true,
  triggerMessageId: "msg_123",
  round1_intent: "ship it",
  round2_confirmed: true,
});

// The runtime form bag flows through the dedicated `freeform` channel.
void buildUserMessageData(
  { agentInput: buildAgentInput({ promptType: "final_assessment" }) },
  { round1_answer: "yes" },
);

// --- The legacy envelope must NOT compile ------------------------------------

void buildUserMessageData({
  // @ts-expect-error - the legacy `data.payload` dispatch envelope is forbidden at the data root; route through `agentInput`.
  payload: { userMessage: "x", handlerPromptType: "entity_conversation" },
});

void buildUserMessageData({
  // @ts-expect-error - a root-level `promptType` is forbidden; the dispatch discriminator lives on `agentInput`.
  promptType: "entity_conversation",
});

void buildUserMessageData({
  // @ts-expect-error - `handlerPromptType` is the legacy handler routing key and is forbidden at the data root.
  handlerPromptType: "entity_conversation",
});

void buildUserMessageData({
  // @ts-expect-error - `triggersAgent` is server-stamped only; the UI never authors it.
  triggersAgent: "set-by-ui",
});
