Workflows and nodes: quick understanding

Flows define the orchestration graph: templates in src/flows/templates/_ declare the start node and each node’s transitions, which is how the runtime knows where to go next.
Node IDs live in src/flows/constants/node-ids.ts and must be registered in the node module (src/flows/nodes/_/\*-nodes.module.ts) so the engine can instantiate and route to them.
Node implementations in src/flows/nodes/\*\* handle execution, routing, and user/system messaging; AGENT nodes use AgentNodeBase, call an external agent, and validate output with zod before updating context or UI.
Flow context is the durable state passed between nodes (src/types/flow-internal.types.ts); nodes read/mutate it via MutableContextHandle so later nodes can reuse decisions and avoid re-asking.
User/system message data shapes are contract-driven: UIElements + payloads come from OpenAPI-generated types and must match the schemas to render correctly and validate in the client.
Plan stage proposals render via the `plan_stage_proposal` UI element with `PlanStageProposalPayload`.
Plan step proposals render via the `plan_step_proposal` UI element with `PlanStepProposalPayload`.
determineRoutingFromUserMessage routes based on the latest FlowUserMessage; it should rely solely on the user message and not on context-driven fallbacks.
uiElements are the structured inputs rendered to users; they should be minimal, labeled clearly, and use the expected ExtendedUIFieldType so the client can render the right component.
secondaryActions are optional buttons attached to uiElements that invoke specific handlers (e.g., continue revising, apply edits) with typed payloads, letting users trigger side actions without a full text reply.
In /Users/zac/Desktop/code/hey-hey/openapi/specs/schemas/conversations.yaml, message schemas (e.g., PlanApprovalUserMessage) define what the client posts back to a node, while payload schemas (e.g., PlanGapDiscoveryPayload) define what nodes embed in UIElements to render rich review UIs.
SecondaryActionConfig and SecondaryActionHandler in conversations.yaml constrain secondary action wiring and handler identifiers so clients and servers agree on what actions are allowed.
