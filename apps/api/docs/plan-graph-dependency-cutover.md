# Plan dependency cutover: implementation and recovery

Implements @[task:b59439c5-d4a7-414c-8eb6-9d3fcf547cf0|Remove migration-added SQL dependency coupling from plan materialization].

## Implementation

Generic materialization creates, reconnects, updates and deletes relationships through the existing AgentEdgeClientService. Graph identity and Graph field postconditions determine whether a relationship operation has completed. The migration-only TaskService synchronization method and SQL relationship postconditions are removed.

PlanDependenciesService reads task-to-task DEPENDS_ON edges through the generated incident-edge endpoint. Source means dependent; target means prerequisite. Plan context, research context, stage ordering, finalization and hierarchy activation use this reader. Ordering preserves the creation-time/ID tie-break and cycle error; finalization still requires exactly one chain root; activation still waits for prerequisite stages to be COMPLETED or CANCELLED. Graph read failures propagate.

Projection validation preserves duplicate-endpoint and cycle checks previously enforced by the removed SQL helper. It hydrates outgoing prerequisite closure before projecting relationship changes, so cycles beyond the immediate neighborhood are checked against Graph, including updates and deletions. Existing stage-chain and endpoint/project validation remains.

Search, the SQL dependency table, Flyway history and unrelated legacy dependency APIs are unchanged. No migration is added or applied.

## Compatibility and validation

The user explicitly approved the Temporal activity behavior change. This patch changes activity-side persistence and reads; it does not change Temporal workflow command sequencing, activity signatures, review ordering, routing or checkpoint identities. No patched branch or Worker Versioning change is introduced. Deploy the activity implementation through the normal worker rollout, then reassess any pending intent before recovery. No live workflow replay, restart, cleanup or regeneration was performed.

Regression tests exercise real TaskService creation/section persistence methods, materializer checkpoint/postcondition code, and AgentEdgeClientService through its generated transport seam. Database delegates and Graph transport are test doubles. Both a failure before Graph commits and a timeout after Graph commits are tested after JSON persistence/reload: task and section writes are not repeated; the same relationship identity is reused; checkpoint states recover; reconnect and delete reach Graph. This is service-boundary coverage, not a live multi-store write test or Temporal history replay.

Focused suites also cover Graph request serialization/filtering, deterministic ordering, research sequence numbers, stage activation, duplicate dependencies and transitive cycles. All 608 tests across nine focused suites pass. The required pnpm tsc --noEmit passes.

## Existing failed run: read-only evidence

The audited intent belongs to @[proposal:1be46be6-23ec-43cf-a3ca-b3c6862262bb|Materialize reviewed Plan Tasks], created September 10 at 10:26:51 UTC. Local PostgreSQL was read around 19:02–19:06 UTC, followed by direct generated-client reads against the API's Graph endpoint.

- The intent remains PREPARED, with one attempt and no active claim. Its 54 checkpoints comprise six COMPLETED operations, one FAILED relationship operation at index 6, and 47 PENDING operations.
- Historical persistence confirms the first two task creates and four section replacements committed. The four section bodies exactly match the stored operation payloads, and stored Service assignments match the original arrays.
- Those two task rows were subsequently archived around 10:56:55 UTC. They are absent from usable context. The actual materializer create postconditions therefore return false; section postconditions remain true. The plan has no unarchived stages.
- Direct Graph identity reads find the pre-existing stage dependency in its original direction. All 12 reserved task-dependency identities return 404. A platform get_edges read returned empty neighborhoods even for the directly retrievable stage edge; direct Graph reads are the evidence used here.
- The initial direct-client probe used the generated client's different default port and returned route-level 404s. Those results were discarded; the findings above use the API provider's actual configured default, http://localhost:8081/api.

Do not resume this intent as-is. Its archived branch must first receive an explicit recovery/disposition decision. Only then should an operator recheck live task eligibility, Graph endpoints, stored mappings/revision, claims/fences and checkpoint postconditions before an authorized retry. The archived rows must not be treated as live prerequisites or recreated under their reserved identities. This patch neither restores them nor changes replay routing to bypass the mismatch.

Fresh regression success does not establish recoverability of this existing run.
