# Open Items triage

The Open Items header resolves the authenticated user's project session and navigates to the existing Agent Session route. `AgentSessionContent` reads the bound Conversation's `open-items-triage` workflow discriminator before selecting `OpenItemsTriagePage`, so Explorer remains part of the surrounding application.

The first run and **Run Again** send `requestKind: freshPass`. Composer **Send** sends `requestKind: followUp` with the user's text. Both use the existing local Agent Session launch/message operations and a complete typed `open_items_triage` payload. Opening, resuming, or requesting suggestions never applies them.

UI Common's `TriageApplicationCoordinator` owns application progress, keyed by authenticated session and reply/field/suggestion identity. It retains only target placement premises, completed item identities, outcomes, and retry identities. The collection remains in the Open Items query cache. Progress survives page navigation within that query-cache lifetime; it is not server-persisted application history.

The conversation/form/registry path renders the summary, affected-item links, rationale, evidence, selections, and independent outcomes. It does not submit suggestion application as a conversation form answer. Each explicit application reads current authoritative state. Removal and grouping warn on conflicting placement changes; an already satisfied result succeeds without another write. Grouping retains the created group identity. Ordinary collection revision changes are not an applicability guard. Apply all continues after independent failures or cancelled promotion.

Reopening fetches canonical presentation only when explicitly applied and uses the manual activation operation. Removal and grouping reuse the adapter's manual operations. Tracking uses ordinary Goal creation and the existing target-owned TRACKS policy. A confirmed Goal identity is retained when attachment fails; retries skip successful attachments. Ordinary Goal creation has no idempotency key, so an unconfirmed creation result requires reviewing Goals instead of blindly repeating creation.

Promotion uses the same name/optional-date dialog as the manual group menu. It follows the approved ordered provider operation: create the Goal, attach TRACKS, then commit the collection. Earlier Goal/TRACKS writes can remain after a later failure. There is no distributed rollback or expected-revision input. A retry refreshes the collection, opens explicit confirmation again, and retains the same provider idempotency key and confirmed name/date.

Explicit failed triage operations are not added to the adapter's offline replay queue. Successful and partially successful work revalidates canonical collection and Goal reads. Existing scoped committed-change notifications, visibility, and reconnect reads provide collection convergence across tabs and devices.

## Validation

Run UI Common's `pnpm tsc --noEmit` and `pnpm test:run`, then UI's `pnpm type-check` and `pnpm test:run`. In environments that export `NODE_ENV=production`, set `NODE_ENV=test` for Vitest. When system temporary directories are outside the sandbox, use a writable worktree-local `TMPDIR`.

Focused checks cover the coordinator's five operations and retries, typed launch/follow-up requests, the real conversation/form/registry callback path, the sidebar header's actual resolution hook, dedicated routing, shared promotion confirmation/cancellation/failure, and the existing canonical adapter and cross-screen synchronization.
