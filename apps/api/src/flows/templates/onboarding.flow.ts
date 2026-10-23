import { LocalPromptType } from 'src/generated/local';
import { ONBOARDING_NODES, SHARED_NODES } from '../constants';
import { createFlow } from './utils';

// Schemas have been moved to individual node files

export const onboardingFlow = createFlow({
  id: 'onboarding',
  name: 'Project Onboarding',
  description: 'Conversational project onboarding with progressive disclosure',
  version: 3,
  startNode: ONBOARDING_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    [ONBOARDING_NODES.WELCOME]: {
      nextNode: ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT,
    },
    [ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT]: {
      transitions: {
        yes: {
          description:
            'The user wants to create the project now and start existing-work setup later from Project Setup.',
          nextNodeId: ONBOARDING_NODES.END,
        },
        no: {
          description:
            'The user wants the existing concept-discovery route without repository grounding.',
          nextNodeId: ONBOARDING_NODES.CLARIFY_CONCEPT,
        },
        default: {
          description:
            'Keep the intent gate active until a valid answer is supplied.',
          nextNodeId: ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT,
        },
      },
    },
    [ONBOARDING_NODES.RECOVERY]: {
      nextNode: ONBOARDING_NODES.CLARIFY_CONCEPT,
    },
    [ONBOARDING_NODES.CLARIFY_CONCEPT]: {
      nextNode: ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT,
    },

    [ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT]: {
      transitions: {
        implementation_assessment: {
          description: 'User has existing implementation that needs assessment',
          nextNodeId: SHARED_NODES.ASSESS_IMPLEMENTATION,
        },
        technical_project: {
          description:
            'Project requires technical architecture and integration planning',
          nextNodeId: SHARED_NODES.GENERATE_ARTIFACTS,
        },
        not_applicable: {
          description:
            'Project is outside platform capabilities or inappropriate',
          nextNodeId: SHARED_NODES.POLITE_REDIRECT,
        },
        default: {
          description:
            'No specific condition met, proceed with standard onboarding',
          nextNodeId: SHARED_NODES.GENERATE_ARTIFACTS,
        },
      },
    },

    [SHARED_NODES.TECHNICAL_DISCOVERY]: {
      transitions: {
        ready_to_proceed: {
          description: 'Sufficient technical context gathered to proceed',
          nextNodeId: SHARED_NODES.GENERATE_FEATURES,
        },
        ready_for_analysis: {
          description: 'Enough information to analyze project requirements',
          nextNodeId: SHARED_NODES.ANALYZE_PROJECT,
        },
        actually_different_focus: {
          description: 'User wants to restart with different project focus',
          nextNodeId: ONBOARDING_NODES.WELCOME,
        },
        more_technical_detail: {
          description: 'Need additional technical discovery information',
          nextNodeId: SHARED_NODES.TECHNICAL_DISCOVERY,
        },
        default: {
          description: 'Standard path to feature generation',
          nextNodeId: SHARED_NODES.GENERATE_FEATURES,
        },
      },
    },

    [SHARED_NODES.TECHNICAL_DISCOVERY_MATURE]: {
      nextNode: SHARED_NODES.GENERATE_ARTIFACTS,
    },

    [SHARED_NODES.ASSESS_IMPLEMENTATION]: {
      nextNode: SHARED_NODES.GENERATE_ARTIFACTS,
    },

    [SHARED_NODES.INTEGRATION_DISCOVERY]: {
      transitions: {
        ready_for_analysis: {
          description:
            'Integration details collected, ready to analyze project',
          nextNodeId: SHARED_NODES.ANALYZE_PROJECT,
        },
        need_more_technical: {
          description: 'Need technical context before discussing integrations',
          nextNodeId: SHARED_NODES.TECHNICAL_DISCOVERY,
        },
        default: {
          description: 'Proceed to business discovery',
          nextNodeId: SHARED_NODES.BUSINESS_DISCOVERY,
        },
      },
    },

    [SHARED_NODES.BUSINESS_DISCOVERY]: {
      transitions: {
        ready_for_analysis: {
          description: 'Business context gathered, ready for project analysis',
          nextNodeId: SHARED_NODES.ANALYZE_PROJECT,
        },
        need_technical_context: {
          description: 'Business goals unclear without technical understanding',
          nextNodeId: SHARED_NODES.TECHNICAL_DISCOVERY,
        },
        default: {
          description: 'Standard path to project analysis',
          nextNodeId: SHARED_NODES.ANALYZE_PROJECT,
        },
      },
    },

    [SHARED_NODES.ANALYZE_PROJECT]: {
      transitions: {
        need_more_info: {
          description: 'Insufficient information for complete analysis',
          nextNodeId: SHARED_NODES.TECHNICAL_DISCOVERY,
        },
        user_has_concerns: {
          description: 'User expressed concerns about analysis or approach',
          nextNodeId: SHARED_NODES.ADDRESS_CONCERNS,
        },
        ready_to_proceed: {
          description: 'Analysis complete, ready to generate artifacts',
          nextNodeId: SHARED_NODES.GENERATE_ARTIFACTS,
        },
        default: {
          description: 'Standard path to artifact generation',
          nextNodeId: SHARED_NODES.GENERATE_ARTIFACTS,
        },
      },
    },

    [SHARED_NODES.ADDRESS_CONCERNS]: {
      transitions: {
        concerns_addressed: {
          description: 'User concerns resolved, ready to proceed',
          nextNodeId: SHARED_NODES.GENERATE_ARTIFACTS,
        },
        need_more_analysis: {
          description: 'Concerns require deeper project analysis',
          nextNodeId: SHARED_NODES.ANALYZE_PROJECT,
        },
        default: {
          description: 'Proceed with artifact generation',
          nextNodeId: SHARED_NODES.GENERATE_ARTIFACTS,
        },
      },
    },

    [SHARED_NODES.SETUP_INTEGRATIONS]: {
      nextNode: SHARED_NODES.PROJECT_MEMBERS,
    },

    [SHARED_NODES.PROJECT_MEMBERS]: {
      nextNode: SHARED_NODES.GENERATE_ARTIFACTS,
    },

    [SHARED_NODES.GENERATE_ARTIFACTS]: {
      nextNode: SHARED_NODES.GENERATE_FEATURES,
    },

    [SHARED_NODES.GENERATE_FEATURES]: {
      nextNode: ONBOARDING_NODES.FINALIZE,
    },

    [ONBOARDING_NODES.FINALIZE]: {
      nextNode: ONBOARDING_NODES.END,
    },

    [ONBOARDING_NODES.END]: {},

    [SHARED_NODES.POLITE_REDIRECT]: {
      transitions: {
        back_to_onboarding: {
          description: 'User wants to try onboarding with different project',
          nextNodeId: ONBOARDING_NODES.WELCOME,
        },
        still_not_applicable: {
          description: 'Project remains unsuitable after clarification',
          nextNodeId: SHARED_NODES.POLITE_REDIRECT,
        },
        ready_to_proceed: {
          description: 'User clarified project fits platform capabilities',
          nextNodeId: SHARED_NODES.TECHNICAL_DISCOVERY,
        },
        default: {
          description: 'Return to welcome for re-evaluation',
          nextNodeId: ONBOARDING_NODES.WELCOME,
        },
      },
    },
  },

  contextTransforms: {},
});
