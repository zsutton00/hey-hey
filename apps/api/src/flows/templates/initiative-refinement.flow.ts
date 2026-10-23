import { LocalPromptType } from 'src/generated/local';
import { InitiativeRefinementFlowContext } from '../../types/flow-internal.types';
import { INITIATIVE_REFINEMENT_NODES } from '../constants';
import { createFlow } from './utils';

export const initiativeRefinementFlow = createFlow({
  id: 'initiative-refinement',
  name: 'Initiative Refinement',
  description:
    'Level-aware conversational refinement of initiatives with intelligent message classification',
  version: 2,
  startNode: INITIATIVE_REFINEMENT_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    // Welcome node - starts the refinement process and initializes level context
    [INITIATIVE_REFINEMENT_NODES.WELCOME]: {
      nextNode: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
    },
    [INITIATIVE_REFINEMENT_NODES.RECOVERY]: {
      nextNode: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
    },

    [INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR]: {
      transitions: {
        ready_to_finalize: {
          description: 'Ready to finalize initiative',
          nextNodeId: INITIATIVE_REFINEMENT_NODES.FINALIZE_ACTION,
        },
        default: {
          description: 'Present agent feedback to user',
          nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
        },
      },
    },

    [INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL]: {
      transitions: {
        ready_to_finalize: {
          description: 'Ready to finalize initiative',
          nextNodeId: INITIATIVE_REFINEMENT_NODES.FINALIZE_ACTION,
        },
        default: {
          description: 'Present generated content to user for review',
          nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
        },
      },
      skipToNode: {
        allowed: true,
        validPreviousNodes: '*',
      },
    },

    [INITIATIVE_REFINEMENT_NODES.FINALIZE_ACTION]: {
      transitions: {
        default: {
          description: 'Complete refinement and end flow',
          nextNodeId: INITIATIVE_REFINEMENT_NODES.END,
        },
      },
    },

    [INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT]: {
      nextNode: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
      skipToNode: {
        allowed: true,
        validPreviousNodes: '*',
      },
    },
    [INITIATIVE_REFINEMENT_NODES.END]: {},
  },

  contextTransforms: {
    finalize_action: async (prev: InitiativeRefinementFlowContext) => {
      // Final processing will be handled by the action node
      return prev;
    },

    agent_feedback: async (prev: InitiativeRefinementFlowContext) => {
      // Agent feedback context will be populated by the agent response processing
      return prev;
    },

    finalize: async (prev: InitiativeRefinementFlowContext) => {
      return prev;
    },

    // Transform triggered when ending the flow
    end: async (prev: InitiativeRefinementFlowContext) => {
      // All refinement data has been processed and stored by action nodes
      // Database storage follows new architecture: generated data in proper tables
      return prev;
    },
  },
});
