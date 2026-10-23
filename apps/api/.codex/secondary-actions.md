SuggestedActions secondary actions (agentic workflows)

- Root-cause statement: identify the invariant (action payload must match handler schema), what breaks it (agent output is too loose), and which caller supplies required fields (agent node vs. controller).
- OpenAPI contract: extend or reuse `SecondaryActionPayload` in `/Users/zac/Desktop/code/hey-hey/openapi/specs/schemas/conversations.yaml`; if new action types are needed, add a payload schema + discriminator mapping and run `pnpm generate:api`.
- Handler registry: add the new handler enum value in `SecondaryActionHandler` and in `SecondaryActionPayloadBase.handlerType` to keep discriminators aligned.
- Response schema: ensure the agent response schema includes `suggestedActions` with enough structure to map into `SecondaryActionConfig` (see `adr-refinement/starting_agent.node.ts` and `initiative-refinement/agent_editor.node.ts`).
- Mapping step: in the agent node, transform each suggested action into a `SecondaryActionConfig` with a concrete `handler` and typed `payload` (avoid placeholders; validate required fields and throw on missing values).
- Presentation & scope: decide whether the action is `field_action` (tied to a UI element) or `form_action` (global); include a stable `fieldId` and presentation (INLINE vs BUTTON) that matches the UI surface.
- UI wiring: attach `secondaryActions` on the `systemMessageData` and set `fieldId` to the UI element you want the action to bind to.
- Tests: add/extend node tests to validate suggested action parsing, payload shape, and fallback behavior on invalid data.
