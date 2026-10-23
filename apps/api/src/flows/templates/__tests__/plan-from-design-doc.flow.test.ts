import { planFromDesignDocFlow } from '../plan-from-design-doc.flow';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import { FEATURE_SYNC_ACTIONS } from '../../nodes/feature-sync/schemas';
import { PLAN_SHAPING_ACTIONS } from '../../nodes/plan-shaping/schemas';
import { LocalPromptType } from 'src/generated/local';
import { WorkflowReviewAction } from 'src/generated';
import type {
  NodeRoutingConfig,
  TransitionDefinition,
} from 'src/types/flow-internal.types';

function getNodeConfig(nodeId: string): NodeRoutingConfig {
  const config = planFromDesignDocFlow.nodes[nodeId];
  if (!config) {
    throw new Error(`planFromDesignDocFlow is missing node ${nodeId}`);
  }
  return config;
}

function getTransition(nodeId: string, key: string): TransitionDefinition {
  const node = getNodeConfig(nodeId);
  if (!node.transitions) {
    throw new Error(`Node ${nodeId} must have transitions`);
  }
  const transition = node.transitions[key];
  if (!transition) {
    throw new Error(`Node ${nodeId} is missing transition key "${key}"`);
  }
  return transition;
}

describe('planFromDesignDocFlow', () => {
  it('starts at FEATURE_SYNC_ANALYZE (the agent-driven feature-sync head runs ahead of stage proposal to reconcile the design-doc structure)', () => {
    expect(planFromDesignDocFlow.startNode).toBe(
      PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
    );
  });

  it('does not contain the retired DESIGN_DOC_REVIEW gate node', () => {
    // The gate's node id was 'plan-shaping-design-doc-review'; the constant
    // is gone, so assert against the retired literal directly.
    expect(planFromDesignDocFlow.nodes).not.toHaveProperty(
      'plan-shaping-design-doc-review',
    );
  });

  it('routes FEATURE_SYNC_ANALYZE NO_DISCREPANCY to PROPOSED_STAGES', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
        FEATURE_SYNC_ACTIONS.NO_DISCREPANCY,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
  });

  it('routes FEATURE_SYNC_ANALYZE DISCREPANCY to the one-shot FEATURE_SYNC_REVIEW gate (not iterate — there is no iterate agent turn before a user reply)', () => {
    const next = getTransition(
      PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
      FEATURE_SYNC_ACTIONS.DISCREPANCY,
    ).nextNodeId;
    expect(next).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW);
    expect(next).not.toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
  });

  it('routes FEATURE_SYNC_ANALYZE default fallback to PROPOSED_STAGES', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE, 'default')
        .nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
  });

  it('routes FEATURE_SYNC_REVIEW "Keep working on this" (request_revisions) to FEATURE_SYNC_ITERATE', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW,
        WorkflowReviewAction.Refine,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
  });

  it('routes FEATURE_SYNC_REVIEW "Ignore" (done) to PROPOSED_STAGES', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW,
        WorkflowReviewAction.Dismissed,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
  });

  it('FEATURE_SYNC_REVIEW only self-loops on the unrecognised-submission default — never in normal operation', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW, 'default')
        .nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW);
  });

  it('the gate is strictly one-shot: analyze`s DISCREPANCY is the only inbound edge and no node other than the gate`s own default routes back into FEATURE_SYNC_REVIEW', () => {
    const inboundEdges: Array<{ from: string; key: string }> = [];
    for (const [nodeId, config] of Object.entries(
      planFromDesignDocFlow.nodes,
    )) {
      for (const [key, transition] of Object.entries(
        config.transitions ?? {},
      )) {
        if (transition.nextNodeId === PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW) {
          inboundEdges.push({ from: nodeId, key });
        }
      }
    }
    // Exactly two edges reach the gate: analyze's DISCREPANCY (the one real
    // inbound) and the gate's own unrecognised-submission self-loop. No other
    // node routes back into it.
    expect(inboundEdges).toEqual(
      expect.arrayContaining([
        {
          from: PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
          key: FEATURE_SYNC_ACTIONS.DISCREPANCY,
        },
        { from: PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW, key: 'default' },
      ]),
    );
    expect(inboundEdges).toHaveLength(2);
  });

  it('routes FEATURE_SYNC_ITERATE REVISED back onto itself and parks on the user (the review element rides on the agent output, so park rather than re-fire)', () => {
    const transition = getTransition(
      PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
      FEATURE_SYNC_ACTIONS.REVISED,
    );
    expect(transition.nextNodeId).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
    expect(transition.parkOnUserResponse).toBe(true);
  });

  it('routes FEATURE_SYNC_ITERATE default fallback back onto itself (self-loop parks the user / re-fires on free-text)', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE, 'default')
        .nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
  });

  it('routes FEATURE_SYNC_ITERATE Done to PROPOSED_STAGES (the user`s Done is the only exit; advances without approval)', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        WorkflowReviewAction.Dismissed,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
  });

  it('the only FEATURE_SYNC_ITERATE transition reaching PROPOSED_STAGES is the user`s Done — no agent-keyed path bypasses user review', () => {
    const config = getNodeConfig(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);
    const reachingStages = Object.entries(config.transitions ?? {})
      .filter(([, t]) => t.nextNodeId === PLAN_SHAPING_NODES.PROPOSED_STAGES)
      .map(([key]) => key);
    expect(reachingStages).toEqual([WorkflowReviewAction.Dismissed]);
  });

  it('FEATURE_SYNC_ITERATE does not declare a RESOLVED transition — RESOLVED is not a valid action', () => {
    expect(
      getNodeConfig(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE).transitions?.[
        FEATURE_SYNC_ACTIONS.RESOLVED
      ],
    ).toBeUndefined();
  });

  it('routes PROPOSED_STAGES READY action to PROPOSED_STAGES_FEEDBACK', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.PROPOSED_STAGES,
        PLAN_SHAPING_ACTIONS.READY,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK);
  });

  it('routes PROPOSED_STAGES default fallback to PROPOSED_STAGES_FEEDBACK', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.PROPOSED_STAGES, 'default').nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK);
  });

  it('routes PROPOSED_STAGES_FEEDBACK continue_revising back to PROPOSED_STAGES', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK,
        PLAN_SHAPING_ACTIONS.REFINE,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES);
  });

  it('routes PROPOSED_STAGES_FEEDBACK readiness approval straight to VISUAL_PREVIEW', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK,
        PLAN_SHAPING_ACTIONS.APPROVED,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW);
  });

  it('does not declare the retired stage empty-set sentinel transition', () => {
    expect(
      getNodeConfig(PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK).transitions?.[
        'approve_all_blocked'
      ],
    ).toBeUndefined();
  });

  it('routes PROPOSED_STAGES_FEEDBACK default fallback to itself', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK, 'default')
        .nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK);
  });

  it('declares none of the retired fidelity, step-theme, or journey-map nodes', () => {
    for (const retiredNodeId of [
      'plan-shaping-fidelity-choice',
      'plan-shaping-proposed-steps-granular',
      'plan-shaping-proposed-steps-theme',
      'plan-shaping-proposed-steps-feedback',
      'plan-shaping-journey-map',
      'plan-shaping-journey-map-feedback',
    ]) {
      expect(planFromDesignDocFlow.nodes).not.toHaveProperty(retiredNodeId);
    }
  });

  it('routes the visual-preview completion through final user approval before phase breakdown', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.VISUAL_PREVIEW,
        PLAN_SHAPING_ACTIONS.READY,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK);
    expect(
      getTransition(
        PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK,
        PLAN_SHAPING_ACTIONS.REFINE,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.VISUAL_PREVIEW);
    expect(
      getTransition(
        PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK,
        PLAN_SHAPING_ACTIONS.APPROVED,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
  });

  it('routes PHASE_BREAKDOWN DONE to STEP_REVIEW as the static fallback (the per-action routing hook redirects to PHASE_BREAKDOWN while another journey step remains)', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
        PLAN_SHAPING_ACTIONS.DONE,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.STEP_REVIEW);
  });

  it('routes PHASE_BREAKDOWN ERROR (phaseIdx-mismatch completion) back to PHASE_BREAKDOWN for a retry', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
        PLAN_SHAPING_ACTIONS.ERROR,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
  });

  it('routes PHASE_BREAKDOWN default fallback to STEP_REVIEW', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.PHASE_BREAKDOWN, 'default').nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.STEP_REVIEW);
  });

  it('routes STEP_REVIEW STEP_REVIEW_DONE to FINALIZE as the static fallback (the per-action routing hook redirects to STEP_REVIEW while another durable stage remains, and materializes accumulated phases on loop exit)', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.STEP_REVIEW,
        PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.FINALIZE);
  });

  it('routes STEP_REVIEW ERROR (stageIdx-mismatch completion) back to STEP_REVIEW for a retry', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.STEP_REVIEW, PLAN_SHAPING_ACTIONS.ERROR)
        .nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.STEP_REVIEW);
  });

  it('keeps acceptance-time rejection on existing ERROR actions so prior completion histories need no new command shape', () => {
    expect(
      getTransition(
        PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
        PLAN_SHAPING_ACTIONS.ERROR,
      ).nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.PHASE_BREAKDOWN);
    expect(
      getTransition(PLAN_SHAPING_NODES.STEP_REVIEW, PLAN_SHAPING_ACTIONS.ERROR)
        .nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.STEP_REVIEW);
  });

  it('routes STEP_REVIEW default fallback to FINALIZE', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.STEP_REVIEW, 'default').nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.FINALIZE);
  });

  it('omits the retired execution-guidance nodes', () => {
    expect(planFromDesignDocFlow.nodes).not.toHaveProperty(
      PLAN_SHAPING_NODES.EXECUTION_GUIDANCE_TRIGGER,
    );
    expect(planFromDesignDocFlow.nodes).not.toHaveProperty(
      PLAN_SHAPING_NODES.EXECUTION_GUIDANCE_WAIT,
    );
  });

  it('routes FINALIZE default fallback to itself (safe self-loop — FINALIZE is now a QUESTIONS reload gate, so re-entry only re-renders the element and never re-dispatches an agent)', () => {
    expect(
      getTransition(PLAN_SHAPING_NODES.FINALIZE, 'default').nextNodeId,
    ).toBe(PLAN_SHAPING_NODES.FINALIZE);
  });

  it('FINALIZE no longer declares a DONE transition (the terminal node no longer drives an agent)', () => {
    expect(
      getNodeConfig(PLAN_SHAPING_NODES.FINALIZE).transitions?.[
        PLAN_SHAPING_ACTIONS.DONE
      ],
    ).toBeUndefined();
  });

  it('sets terminalPromptType to plan_shaping_finalize', () => {
    expect(planFromDesignDocFlow.terminalPromptType).toBe(
      LocalPromptType.plan_shaping_finalize,
    );
  });

  it('declares the ten plan work-item generation nodes', () => {
    expect(Object.keys(planFromDesignDocFlow.nodes).sort()).toEqual(
      [
        PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
        PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW,
        PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        PLAN_SHAPING_NODES.PROPOSED_STAGES,
        PLAN_SHAPING_NODES.PROPOSED_STAGES_FEEDBACK,
        PLAN_SHAPING_NODES.VISUAL_PREVIEW,
        PLAN_SHAPING_NODES.VISUAL_PREVIEW_FEEDBACK,
        PLAN_SHAPING_NODES.PHASE_BREAKDOWN,
        PLAN_SHAPING_NODES.STEP_REVIEW,
        PLAN_SHAPING_NODES.FINALIZE,
      ].sort(),
    );
  });

  // Graph-level closure for the feature-sync chain. The single-edge pins above
  // ('DISCREPANCY to FEATURE_SYNC_REVIEW', 'request_revisions to ITERATE',
  // 'REVISED back onto itself', 'Done to PROPOSED_STAGES') each assert one
  // edge; these tests compose them into the chain the task promises — analyze →
  // review → iterate → iterate — and prove iterate is sealed against advancing
  // to stage proposal from the agent side: only the user's Done moves it
  // forward, and iterate is never entered before a user reply.
  describe('feature-sync analyze → review → iterate chain (graph-level closure)', () => {
    it('forms the chain ANALYZE --DISCREPANCY--> REVIEW --request_revisions--> ITERATE, and every agent/default edge out of ITERATE returns to ITERATE', () => {
      const toReview = getTransition(
        PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE,
        FEATURE_SYNC_ACTIONS.DISCREPANCY,
      ).nextNodeId;
      expect(toReview).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW);

      const toIterate = getTransition(
        PLAN_SHAPING_NODES.FEATURE_SYNC_REVIEW,
        WorkflowReviewAction.Refine,
      ).nextNodeId;
      expect(toIterate).toBe(PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE);

      const iterateConfig = getNodeConfig(
        PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
      );
      // Every edge out of iterate other than the user's Done — the REVISED
      // action edge and the default fallback alike — lands back on iterate. The
      // self-loop has no agent-keyed third exit.
      const nonDoneDestinations = Object.entries(
        iterateConfig.transitions ?? {},
      )
        .filter(([key]) => key !== WorkflowReviewAction.Dismissed)
        .map(([, t]) => t.nextNodeId);
      expect(nonDoneDestinations.length).toBeGreaterThan(0);
      expect(
        nonDoneDestinations.every(
          (dest) => dest === PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
        ),
      ).toBe(true);
    });

    it('RESOLVED cannot move the loop forward: it is undeclared on ITERATE, so the only edge reaching PROPOSED_STAGES is the user`s Done — never an agent-emitted action', () => {
      const iterateConfig = getNodeConfig(
        PLAN_SHAPING_NODES.FEATURE_SYNC_ITERATE,
      );
      // RESOLVED is not a transition key on iterate — a claimed-resolved
      // completion has no edge to ride out of the loop.
      expect(
        iterateConfig.transitions?.[FEATURE_SYNC_ACTIONS.RESOLVED],
      ).toBeUndefined();

      // Enumerate every edge out of iterate that reaches stage proposal and
      // assert the single one is keyed by the user's Done — never by anything
      // the agent emits.
      const edgesToStages = Object.entries(iterateConfig.transitions ?? {})
        .filter(([, t]) => t.nextNodeId === PLAN_SHAPING_NODES.PROPOSED_STAGES)
        .map(([key]) => key);
      expect(edgesToStages).toEqual([WorkflowReviewAction.Dismissed]);
    });
  });
});
