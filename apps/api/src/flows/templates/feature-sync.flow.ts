import { LocalPromptType } from 'src/generated/local';
import { WorkflowName } from 'src/generated';
import { AgentSessionService } from 'src/services/agent-session.service';
import { TaskId } from 'src/types';
import { FeatureSyncFlowContext } from 'src/types/flow-internal.types';
import { FEATURE_SYNC_NODES } from '../constants';
import { FEATURE_SYNC_ACTIONS } from '../nodes/feature-sync/schemas';
import { createFlow } from './utils';
import { WorkflowReviewAction } from 'src/generated';

/**
 * Initial feature-sync flow.
 *
 * Five-stage graph that runs at the start of a coding session.
 *
 * `opener` is a hidden QUESTIONS gate. The agent setup page renders
 * its own prompt input before the conversation UI is mounted, so the
 * workflow must pause before dispatching the analyze trigger. The
 * opener captures the user's initial prompt onto flow context as
 * `featureSyncInitialPrompt` and advances to `analyze`. Its SYSTEM
 * message is filtered out of the rendered timeline on the UI side.
 *
 * `analyze`, `iterate`, `coding_plan`, and `implement` are
 * EXTERNAL_AGENT — their completion messages are produced by the CLI-side
 * agent via typed submission tools. Transitions are keyed on the `action`
 * field of the agent-authored completion message (the engine resolves
 * them in src/workflows/activities.ts:resolveExternalAgentRouting).
 *
 * On user-authored `REFINE`, the `coding_plan` node self-loops without
 * parking so it emits another `startup_session` trigger. It routes to the
 * terminal `implement` node on `APPROVED` (plan accepted, CLI takes over
 * execution). `implement` self-loops on `DONE`; it has no routing
 * consequences and exists so the conversation never lands on a
 * `currentNodeId: null` state — every CLI dispatch stays bound to a trigger
 * as the dispatch contract requires.
 *
 * The existing end-of-session feature sync is deliberately untouched;
 * this flow only handles the initial (pre-startup) sync.
 */
export const featureSyncFlow = createFlow<FeatureSyncFlowContext>({
  id: WorkflowName.FeatureSync,
  name: 'Feature Sync',
  description:
    'Initial feature-sync stage run at the start of a coding session. The external CLI agent walks the feature tree for drift and surfaces proposals before session startup.',
  version: 1,
  startNode: FEATURE_SYNC_NODES.OPENER,
  terminalPromptType: LocalPromptType.coding_freeform,

  nodes: {
    [FEATURE_SYNC_NODES.OPENER]: {
      nextNode: FEATURE_SYNC_NODES.ANALYZE,
    },

    [FEATURE_SYNC_NODES.ANALYZE]: {
      transitions: {
        default: {
          nextNodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          description:
            'Fallback when the agent fast-paths without surfacing drift.',
        },
        [FEATURE_SYNC_ACTIONS.NO_DISCREPANCY]: {
          nextNodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          description: 'No drift detected — park on session startup.',
        },
        [FEATURE_SYNC_ACTIONS.DISCREPANCY]: {
          nextNodeId: FEATURE_SYNC_NODES.ITERATE,
          description:
            'Drift detected — hand to iterate for agent-driven resolution.',
        },
        [FEATURE_SYNC_ACTIONS.READINESS_CLEAR]: {
          nextNodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          description: 'No consequential implementation decision remains unresolved.',
        },
        [FEATURE_SYNC_ACTIONS.READINESS_REVIEW_REQUIRED]: {
          nextNodeId: FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW,
          description:
            'A consequential implementation decision needs a bounded user disposition before planning.',
        },
      },
    },

    [FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW]: {
      transitions: {
        default: {
          nextNodeId: FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW,
          description: 'Keep the readiness finding visible for an unrecognized action.',
        },
        implementation_readiness_reply: {
          nextNodeId: FEATURE_SYNC_NODES.ANALYZE,
          description: 'Return clarification through the standard composer for a fresh check.',
        },
        implementation_readiness_dismiss: {
          nextNodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          description: 'Dismiss the finding for this unchanged run and source snapshot.',
        },
      },
    },

    [FEATURE_SYNC_NODES.ITERATE]: {
      transitions: {
        default: {
          nextNodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          description:
            'Fallback for iterate when no specific action branch matches.',
        },
        [FEATURE_SYNC_ACTIONS.RESOLVED]: {
          nextNodeId: FEATURE_SYNC_NODES.ANALYZE,
          description:
            'Structural iteration resolved — re-run the typed implementation-readiness check before planning.',
        },
        [FEATURE_SYNC_ACTIONS.REVISED]: {
          nextNodeId: FEATURE_SYNC_NODES.ITERATE,
          description:
            'Agent produced a revised discrepancy set — re-run iterate.',
        },
      },
    },

    [FEATURE_SYNC_NODES.CODING_PLAN]: {
      transitions: {
        default: {
          nextNodeId: FEATURE_SYNC_NODES.IMPLEMENT,
          description:
            'Fallback for session startup when no specific action branch matches.',
        },
        [WorkflowReviewAction.Approved]: {
          nextNodeId: FEATURE_SYNC_NODES.IMPLEMENT,
          description:
            'Plan accepted — park on the terminal implement node so the CLI keeps a non-null currentNodeId while it takes over execution.',
        },
        [WorkflowReviewAction.Refine]: {
          nextNodeId: FEATURE_SYNC_NODES.CODING_PLAN,
          description:
            'User requested another planning turn — re-enter coding_plan without parking so the startup-session trigger re-fires with the canonical review answer visible in conversation history.',
        },
      },
    },

    [FEATURE_SYNC_NODES.IMPLEMENT]: {
      transitions: {
        default: {
          nextNodeId: FEATURE_SYNC_NODES.END,
          description: 'The end is inevitable.',
        },
        [FEATURE_SYNC_ACTIONS.DONE]: {
          nextNodeId: FEATURE_SYNC_NODES.IMPLEMENT,
          description:
            'Implement turn complete — self-loop so the conversation parks on this node and the next user/agent message re-fires the trigger.',
        },
      },
    },

    [FEATURE_SYNC_NODES.END]: {},
  },

  async initialContextTransform(
    baseContext,
    workflowAboutId,
    workflowAboutType,
    appContext,
  ): Promise<FeatureSyncFlowContext> {
    if (!workflowAboutId) {
      throw new Error('Feature sync flow requires workflowAboutId');
    }

    if (workflowAboutType !== 'agent-session') {
      throw new Error(
        `Feature sync flow requires workflowAboutType="agent-session", got "${workflowAboutType}"`,
      );
    }

    const agentSessionService = appContext.get(AgentSessionService, {
      strict: false,
    });

    const session = await agentSessionService.findOne(
      baseContext.core.organizationId,
      workflowAboutId,
    );

    if (session.entityType !== 'TASK' || !session.entityId) {
      throw new Error(
        `Feature sync flow requires agent session ${workflowAboutId} to be about a TASK entity`,
      );
    }

    return {
      ...baseContext,
      taskId: session.entityId as TaskId,
    };
  },
});
