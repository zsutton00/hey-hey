# Message Posting — Ownership Rules

## We do not own message types

The CLI posts messages to the platform API. The message shapes are defined externally
in `../../openapi/specs/schemas/conversations.yaml` and consumed by the UI.

**Every message we post must use a generated type from conversations.yaml.**

## What goes where

| Concern                       | Defined in           | Example types                                                           |
| ----------------------------- | -------------------- | ----------------------------------------------------------------------- |
| Internal LLM response parsing | `src/shared/agent-bridge-contract/generated/api.ts` | `LocalFinalAssessmentResponse`, `LocalNeighborhoodTaskUpdatesResponse`  |
| Internal prompt payloads      | `src/shared/agent-bridge-contract` | `LocalFinalAssessmentPromptPayload`, `LocalStartupSessionPromptPayload` |
| Conversation message envelope | `conversations.yaml` | `CreateMessageDto`, `CreateSystemMessage`                               |
| Message data (discriminated)  | `conversations.yaml` | `QuestionsSystemMessageData`, `AgentSystemMessageData`                  |
| UI element payloads           | `conversations.yaml` | `CodingPromptFinalAssessmentPayload`, `CodingPromptStartupPlanPayload`  |

## Adding a new message type

1. Define the payload schema in `conversations.yaml`
2. Add it to the appropriate discriminator (`UIElementPayload` oneOf, `ExtendedUIFieldType` enum, etc.)
3. Regenerate platform API types
4. Use the generated type in the mapping function (`message-mapping.ts`)

## Forbidden

- `Record<string, unknown>` as message data
- JSON-stringified payloads in message fields
- Types invented in CLI code for message payloads
- Types from the agent bridge contract used as conversation message payloads
