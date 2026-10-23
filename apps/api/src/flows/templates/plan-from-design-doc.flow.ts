import { LocalPromptType } from 'src/generated/local';
import { WorkflowName, WorkflowReviewAction } from 'src/generated';
import { PlanFromDesignDocFlowContext } from 'src/types/flow-internal.types';
import { PLAN_SHAPING_NODES } from '../constants';
import { FEATURE_SYNC_ACTIONS } from '../nodes/feature-sync/schemas';
import { PLAN_SHAPING_ACTIONS } from '../nodes/plan-shaping/schemas';
import { createFlow } from './utils';

/**
 * CLI-driven plan-generation workflow seeded by an existing design-doc
 * markdown blob.
 *
 * The design-doc, plan, and conversation entities are materialized inside
 * the create_plan proposal-approval transaction (see
 * ProposalApprovalService.enactCreateConversation), so by the time the
 * workflow starts the entity facts the plan-shaping nodes need (planId,
 * linked designDocId, parentFeatureId) are already durable on the
 * conversation, the plan row, and the plan's LINKED PlanRelationship.
 * Each node resolves them per execution via PlanFromDesignDocSeedService
 * — they are not mirrored onto FlowContext. The graph is composed of
 * the plan-shaping nodes:
 *
 *   FEATURE_SYNC_ANALYZE is the opening node. The conversation's Run is
 *   bound up front by the `startConversationRun` materialize-only
 *   (workflow) arm — which fires no agent turn — so by the time the
 *   workflow starts there is already an active Run for the first SYSTEM
 *   trigger to land in. There is no in-graph opening gate: run-binding is
 *   a conversation-lifecycle concern, not a workflow-graph one.
 *
 *   The feature-sync analyze → review → iterate chain runs ahead of
 *   PROPOSED_STAGES to reconcile the plan's design-doc-declared structure
 *   against the observed plan shape before stages are proposed. When the
 *   analyze node finds no drift, NO_DISCREPANCY advances the graph straight
 *   to PROPOSED_STAGES. When drift is found, DISCREPANCY routes to the
 *   one-shot FEATURE_SYNC_REVIEW gate; `waitForUser` is false on the
 *   DISCREPANCY action so analyze presents the flagged items and emits its
 *   verdict on the same turn — the gate (not analyze) is what parks.
 *
 *   FEATURE_SYNC_ANALYZE (EXTERNAL_AGENT)
 *     action: NO_DISCREPANCY → PROPOSED_STAGES
 *     action: DISCREPANCY    → FEATURE_SYNC_REVIEW
 *     default fallback       → PROPOSED_STAGES
 *
 *   FEATURE_SYNC_REVIEW (QUESTIONS, one-shot input gate)
 *     Fires no agent: it emits the `plan_shaping_feature_sync_review`
 *     element (a feedback text area) plus two buttons and parks. The flagged
 *     items themselves are presented by the agent turn, not by this gate.
 *     Strictly one-shot — its only inbound edge is analyze's DISCREPANCY and
 *     nothing ever routes back into it.
 *     action: request_revisions ("Keep working on this") → FEATURE_SYNC_ITERATE
 *       (stash the text-area body on featureSyncPendingUserReply)
 *     action: plan_shaping_feature_sync_review_done ("Ignore") → PROPOSED_STAGES
 *       (clear the discrepancy stash; no approval)
 *     default fallback → FEATURE_SYNC_REVIEW  (self-loop only on an
 *       unrecognised submission — never in normal operation)
 *
 *   FEATURE_SYNC_ITERATE (EXTERNAL_AGENT, self-looping review surface)
 *     Owns the repeat loop. Entered only from the gate (after a reply) or its
 *     own self-loop, so its first trigger always carries the user's reply
 *     (featureSyncPendingUserReply → trigger userMessage).
 *     free-text reply (no action) → FEATURE_SYNC_ITERATE  (acceptsUserMessages
 *       self-loop in resolveExternalAgentRouting; processUserResponse stashes
 *       the reply on featureSyncPendingUserReply and the node re-fires with
 *       the user's notes in hand)
 *     action: REVISED  → FEATURE_SYNC_ITERATE  (agent refreshed the set;
 *       parkOnUserResponse: true — the review element rides on this output,
 *       so park on the user rather than re-firing the trigger)
 *     action: plan_shaping_feature_sync_review_request_revisions →
 *       FEATURE_SYNC_ITERATE  (the user's "Continue Revising" — the loop
 *       equivalent of the gate's "Keep working on this"; processUserResponse
 *       stashes the text-area body on featureSyncPendingUserReply and the node
 *       self-loops WITHOUT parkOnUserResponse so the trigger re-fires)
 *     action: plan_shaping_feature_sync_review_done → PROPOSED_STAGES  (the
 *       user's Done — declares the review finished; no approval, the iterate
 *       node clears the discrepancy stash, any pending reply, and the
 *       source-message id; per-proposal cards are the only accept surface)
 *     default fallback → FEATURE_SYNC_ITERATE  (self-loop)
 *     NOTE: RESOLVED is not a valid action — the engine validator rejects it
 *       as unknown_action; the user's Done is the only path to PROPOSED_STAGES.
 *
 *   PROPOSED_STAGES (EXTERNAL_AGENT)
 *     action: READY    → PROPOSED_STAGES_FEEDBACK
 *     default fallback → PROPOSED_STAGES_FEEDBACK
 *
 *   PROPOSED_STAGES_FEEDBACK (QUESTIONS, user-driven review gate)
 *     action: continue_revising → PROPOSED_STAGES
 *     action: approve_all       → VISUAL_PREVIEW (readiness only;
 *       individual PlanStage proposal state is unchanged)
 *     default fallback          → PROPOSED_STAGES_FEEDBACK
 *
 *   VISUAL_PREVIEW (EXTERNAL_AGENT)
 *     action: READY    → VISUAL_PREVIEW_FEEDBACK
 *     default fallback → VISUAL_PREVIEW
 *
 *   VISUAL_PREVIEW_FEEDBACK (QUESTIONS, user-driven review gate)
 *     action: continue_revising → VISUAL_PREVIEW
 *     action: approve_all       → PHASE_BREAKDOWN (explicit approval of the
 *       complete visual set is the only entry into stage/Task generation)
 *     default fallback          → VISUAL_PREVIEW_FEEDBACK
 *
 *   PHASE_BREAKDOWN (EXTERNAL_AGENT, self-loops once per journey step)
 *     action: DONE     → STEP_REVIEW  (static fallback; the per-action
 *       routing hook on the node redirects DONE back to PHASE_BREAKDOWN
 *       while another journey step still has work, derived from
 *       accumulatedPhases. On final-phase DONE the hook returns
 *       undefined and the static `DONE → STEP_REVIEW` transition fires
 *       — materialization no longer runs here; it has moved to
 *       step-review's loop-exit so the per-stage tightening pass can
 *       rewrite each stage's accumulated steps before they land.)
 *     action: ERROR    → PHASE_BREAKDOWN  (phase-cursor-mismatch
 *       completion synthesized by the node — re-trigger the phase for
 *       a retry)
 *     default fallback → STEP_REVIEW
 *
 *   STEP_REVIEW (EXTERNAL_AGENT, self-loops once per durable stage)
 *     action: STEP_REVIEW_DONE → EXECUTION_GUIDANCE_TRIGGER  (static
 *       fallback; the per-action routing hook on the node redirects
 *       STEP_REVIEW_DONE back to STEP_REVIEW while another stage still
 *       needs review, derived from reviewedStages. On the final stage
 *       the hook calls materializeAccumulatedPhases exactly once
 *       against the (now tightened) accumulated steps and returns
 *       undefined so the engine falls through to this static
 *       transition.)
 *     action: ERROR            → STEP_REVIEW  (stage-cursor-mismatch
 *       completion synthesized by the node — re-trigger the stage for
 *       a retry; accumulatedPhases and reviewedStages are both left
 *       unchanged so the re-derived cursor is the same one that
 *       mismatched.)
 *     default fallback         → EXECUTION_GUIDANCE_TRIGGER
 *
 *   EXECUTION_GUIDANCE_TRIGGER (ACTION, non-interactive)
 *     static nextNode → EXECUTION_GUIDANCE_WAIT  (seeds one execution
 *       guidance run per plan stage, then routes straight through. ACTION
 *       nodes emit no agent action or user intent, so they must advance
 *       via a static `nextNode` — a `transitions` table has no signal to
 *       key off and would leave the engine with no next node.)
 *
 *   EXECUTION_GUIDANCE_WAIT (ACTION, non-interactive)
 *     static nextNode → FINALIZE  (blocks until the first stage's
 *       guidance is READY, then routes straight through)
 *
 *   FINALIZE (QUESTIONS, terminal reload gate)
 *     default fallback → FINALIZE  (safe self-loop — re-entry only
 *       re-renders the reload element; there is no agent to re-dispatch)
 *
 *     Not an EXTERNAL_AGENT node: the plan is already landed and ACTIVE
 *     by the time this node is reached, so there is no agent work. The
 *     node flips the plan ACTIVE (idempotent) and renders the
 *     PlanGenerationFinalize element so the client can reload the plan
 *     in place. `acceptsUserMessages = false`, so the flow parks on the
 *     element and auto-pauses on the user-response timeout rather than
 *     re-running. Modeling it as EXTERNAL_AGENT previously self-looped
 *     on the agent's DONE completion, which re-emitted the trigger every
 *     cycle and looped the agent unboundedly.
 *
 * No initialContextTransform is needed — the seed context fields are
 * merged in from additionalContext at workflow initialization time.
 *
 * ROLLOUT CONSTRAINT — templates are unversioned at resolution time. The
 * engine resolves this graph from an in-memory registry keyed by flow id
 * alone (`NodeExecutionService.getFlow`); `version` below is informational
 * and never pins a running execution. Because Temporal re-resolves node
 * config from current code every step, any edit here that retargets or
 * deletes a transition — or tightens an agent-action/completion contract —
 * is adopted live by in-flight executions parked mid-graph (e.g. on
 * FEATURE_SYNC_ANALYZE/ITERATE awaiting an agent reply). Such a change is
 * deploy-safe only after draining those executions to zero. See
 * docs/conversation-workflows/WORKFLOW-SYSTEM.md
 * ("Flow Template Resolution & Live Adoption").
 */
export const planFromDesignDocFlow = createFlow<PlanFromDesignDocFlowContext>({
  id: WorkflowName.PlanFromDesignDoc,
  name: 'Plan from Design Doc',
  description:
    'CLI-driven plan generation seeded by an existing design-doc markdown blob. The plan and design-doc are already materialized at conversation-creation time; the workflow opens on the agent-driven feature-sync head (FEATURE_SYNC_ANALYZE → one-shot FEATURE_SYNC_REVIEW gate → self-looping FEATURE_SYNC_ITERATE on drift, or straight to PROPOSED_STAGES on clean pass) that reconciles the design-doc structure before stage proposal, then drives the plan-shaping subgraph: PROPOSED_STAGES → PROPOSED_STAGES_FEEDBACK → VISUAL_PREVIEW → VISUAL_PREVIEW_FEEDBACK → PHASE_BREAKDOWN* → STEP_REVIEW* → FINALIZE.',
  version: 1,
  startNode: PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
  terminalPromptType: LocalPromptType.plan_shaping_finalize,

  nodes: {
    [PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES,
          description:
            'Fallback when the agent fast-paths without surfacing drift — advance to stage proposal.',
        },
        [FEATURE_SYNC_ACTIONS.NO_DISCREPANCY]: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES,
          description:
            'No drift between the design doc and the plan structure — advance straight to stage proposal.',
        },
        [FEATURE_SYNC_ACTIONS.DISCREPANCY]: {
          nextNodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW,
          description:
            'Drift detected — route to the one-shot feature-sync-review gate. waitForUser is false on the DISCREPANCY action so analyze presents the flagged items and emits its verdict on this same turn; the gate is what parks on the user.',
        },
      },
    },

    [PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW,
          description:
            'Self-loop fallback — the gate stays parked on the user only when an unrecognised submission lands. Normal operation never routes back into this one-shot gate; the repeat loop lives entirely on feature-sync-iterate.',
        },
        [WorkflowReviewAction.Refine]: {
          nextNodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
          description:
            'User chose "Keep working on this" — the gate stashed the text-area body on featureSyncPendingUserReply; hand off to feature-sync-iterate, whose first trigger surfaces it as userMessage.',
        },
        [WorkflowReviewAction.Dismissed]: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES,
          description:
            'User chose "Ignore" — skip the flagged items and advance to stage proposal. No proposal is approved; the gate cleared the discrepancy stash. Per-proposal cards are the only path that flips a DRAFT to approved.',
        },
      },
    },

    [PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
          description:
            'Self-loop — iterate parks on the user (and free-text replies re-fire the agent via the acceptsUserMessages self-loop in resolveExternalAgentRouting) on all submissions other than the user`s Done.',
        },
        [FEATURE_SYNC_ACTIONS.REVISED]: {
          nextNodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
          parkOnUserResponse: true,
          description:
            'Agent produced a revised discrepancy set — self-loop back onto iterate and park on the user. parkOnUserResponse: true because the plan_shaping_feature_sync_review element rides on this very agent output, so re-firing the trigger would re-run generation and emit a duplicate.',
        },
        [WorkflowReviewAction.Refine]: {
          nextNodeId: PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
          description:
            'User clicked "Continue Revising" on the review element the iterate output rides — the loop equivalent of the gate\'s "Keep working on this". The node stashed the text-area body on featureSyncPendingUserReply; self-loop back onto iterate WITHOUT parkOnUserResponse (unlike REVISED) so the trigger re-fires and the agent sees the stashed feedback as userMessage and produces another revised set.',
        },
        [WorkflowReviewAction.Dismissed]: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES,
          description:
            'User declared the review finished — no proposal is approved here; the iterate node clears the discrepancy stash, any pending reply, and the source-message id, then the flow advances to stage proposal. Per-proposal cards are the only path that flips a DRAFT to approved.',
        },
      },
    },

    [PLAN_SHAPING_NODES.PROPOSED_STAGES]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK,
          description:
            'Fallback when the agent advances without a recognised action key.',
        },
        [PLAN_SHAPING_ACTIONS.READY]: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK,
          description:
            'Stages proposed at theme fidelity — hand off to the user-driven review gate.',
        },
      },
    },

    [PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK,
          description:
            'Self-loop fallback — the gate stays parked on the user when no recognised action is submitted.',
        },
        [PLAN_SHAPING_ACTIONS.REFINE]: {
          nextNodeId: PLAN_SHAPING_NODES.PROPOSED_STAGES,
          description:
            'User asked to keep revising — loop back into proposed-stages with the captured feedback.',
        },
        [PLAN_SHAPING_ACTIONS.APPROVED]: {
          nextNodeId: PLAN_SHAPING_NODES.VISUAL_PREVIEW,
          description:
            'User is ready for the next step — advance straight to visual plan review without changing individual PlanStage proposal state.',
        },
      },
    },

    [PLAN_SHAPING_NODES.VISUAL_PREVIEW]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.VISUAL_PREVIEW,
          description:
            'Self-loop fallback — retry the visual-preview turn when no recognised completion action is emitted.',
        },
        [PLAN_SHAPING_ACTIONS.READY]: {
          nextNodeId: PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK,
          description:
            'The agent completed one visual proposal round; present the complete ordered set for user review.',
        },
      },
    },

    [PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK,
          description:
            'Self-loop fallback — keep the visual-preview review parked on the user.',
        },
        [PLAN_SHAPING_ACTIONS.REFINE]: {
          nextNodeId: PLAN_SHAPING_NODES.VISUAL_PREVIEW,
          description:
            'User requested attributable visual changes; loop back for one refinement round while unchanged proposal identities carry forward.',
        },
        [PLAN_SHAPING_ACTIONS.APPROVED]: {
          nextNodeId: PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
          description:
            'User explicitly approved the complete visual set; only now may the existing phase-breakdown and plan materialization handoff begin.',
        },
      },
    },

    [PLAN_SHAPING_NODES.PHASE_BREAKDOWN]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.STEP_REVIEW,
          description:
            'Fallback when the agent advances without a recognised action key. The per-action routing hook on the node overrides DONE to loop back into PHASE_BREAKDOWN while another journey step remains (derived from accumulatedPhases), so this fallback only fires on truly unrecognised completions.',
        },
        [PLAN_SHAPING_ACTIONS.DONE]: {
          nextNodeId: PLAN_SHAPING_NODES.STEP_REVIEW,
          description:
            'Structural fallback for DONE — the phase-breakdown node`s `determineRoutingFromAgentCompletion` hook redirects DONE back to PHASE_BREAKDOWN while another `(stageIdx, phaseIdx)` cursor still has no accumulated phase. Only the last phase`s DONE falls through to this static destination, which hands off to the per-stage step-review tightening sweep before materialization and the execution-guidance trigger/wait pair.',
        },
        [PLAN_SHAPING_ACTIONS.ERROR]: {
          nextNodeId: PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
          description:
            'phase-cursor-mismatch completion synthesized API-side by the phase-breakdown node when the agent echoes back a `(stageIdx, phaseIdx)` cursor that is neither the expected slot nor the idempotent-overwrite retry. accumulatedPhases is left unchanged, so re-entering PHASE_BREAKDOWN re-derives the same expected cursor and re-triggers the agent for a clean retry. Routing here (rather than onward) is what keeps a corrupt cursor from advancing the plan or landing partial work.',
        },
      },
    },

    [PLAN_SHAPING_NODES.STEP_REVIEW]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.FINALIZE,
          description:
            'Fallback when the agent advances without a recognised action key. The per-action routing hook on the node overrides STEP_REVIEW_DONE to loop back into STEP_REVIEW while another stage remains unreviewed (derived from reviewedStages), so this fallback only fires on truly unrecognised completions.',
        },
        [PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE]: {
          nextNodeId: PLAN_SHAPING_NODES.FINALIZE,
          description:
            'Structural fallback for STEP_REVIEW_DONE — the step-review node`s `determineRoutingFromAgentCompletion` hook redirects STEP_REVIEW_DONE back to STEP_REVIEW while another stage still has no review recorded on reviewedStages. Only the last stage`s STEP_REVIEW_DONE falls through to this static destination; on that branch the hook calls materializeAccumulatedPhases exactly once against the (now tightened) accumulated steps before falling through. EXECUTION_GUIDANCE_TRIGGER then seeds execution guidance before FINALIZE.',
        },
        [PLAN_SHAPING_ACTIONS.ERROR]: {
          nextNodeId: PLAN_SHAPING_NODES.STEP_REVIEW,
          description:
            'stage-cursor-mismatch completion synthesized API-side by the step-review node when the agent echoes back a `stageIdx` that is neither the expected slot nor the idempotent-overwrite retry of the most-recently-reviewed stage. accumulatedPhases and reviewedStages are both left unchanged, so re-entering STEP_REVIEW re-derives the same expected cursor and re-triggers the agent for a clean retry. Routing here (rather than onward) is what keeps a corrupt cursor from advancing the plan or skipping a stage. Distinct from a genuine agent/tool failure: that path falls through reviewed-as-drafted via the node`s `processUserResponse` accepting the drafted steps unchanged, so a stuck stage can never strand the plan.',
        },
      },
    },

    [PLAN_SHAPING_NODES.FINALIZE]: {
      transitions: {
        default: {
          nextNodeId: PLAN_SHAPING_NODES.FINALIZE,
          description:
            'Terminal reload gate (QUESTIONS, not EXTERNAL_AGENT). The plan is already landed and ACTIVE; the node renders the PlanGenerationFinalize reload element and parks. The self-loop is a safe fallback — re-entering a QUESTIONS node only re-renders the element, it does not re-dispatch an agent — and `acceptsUserMessages = false` means free-text never signals it, so the flow simply parks and auto-pauses on the user-response timeout.',
        },
      },
    },
  },
});
