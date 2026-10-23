# Plan generation reset

A PLAN work item in BACKLOG may have no generation session. The draft screen
shows the design-doc review and generation settings immediately. **Start
generating** prepares a NOT_STARTED session on the same work item and continues
into the existing launch flow with the selected machine, model, and worktree.
Session preparation is an internal step, not a separate user action.

The work-item generation endpoints are:

- `POST /organizations/{organizationId}/projects/{projectId}/work-items/{taskId}/plan-generation`: prepare or return a generation session; does not start a run.
- `DELETE` at the same path: stop generation, remove its session, discard pending
  proposals and reports, archive generated stages/tasks, and return the PLAN to
  BACKLOG. The PLAN identity and seed design doc are preserved.

Preparation and reset serialize on the PLAN row. Reset also clears generated
legacy projection rows for migrated Plans. Legacy reset endpoints remain
available for older clients.

New sessions use TASK identity and a PLAN coordinator association. Seed lookup
prefers outgoing `TASK DERIVES_FROM DESIGN_DOC` graph edges. Migration-preserved
`RELATED_TO` edges explicitly marked as legacy `LINKED` Plan relationships are
also recognized; arbitrary related documents are not generation seeds. The
document can remain owned by the parent Feature. The preview document query and
generation preparation/activity lookup share this graph resolver, with
work-item-owned documents and legacy relational links retained as fallbacks. Existing
plan-about conversations retain their seed resolution path.

No Temporal workflow command sequence, routing, timers, or activity scheduling
changes were introduced. The activity-side seed lookup accepts the new identity
while retaining legacy behavior; existing workflow histories need no new patch
marker. Live Temporal replay and an end-to-end CLI generation run were not run.
