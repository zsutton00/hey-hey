import { LocalPromptType } from 'src/generated/local';
import {
  DecisionRefinementFlowContext,
  FlowContext,
} from '../../types/flow-internal.types';
import { AgentSessionService } from '../../services/agent-session.service';
import { deriveAgentSessionTitle } from '../../services/agent-session-title';
import { DesignDocService } from '../../services/design-doc/design-doc.service';
import { DesignDocId } from '../../types/design-doc.types';
import { INestApplicationContext } from '@nestjs/common';
import { AgentSessionType, WorkflowName } from 'src/generated';

import { DECISION_REFINEMENT_NODES } from '../constants';
import { createFlow } from './utils';

export const decisionRefinementFlow = createFlow({
  id: WorkflowName.DecisionRefinement,
  name: 'Decision Refinement',
  description:
    'Conversational refinement of Decision design docs with focused feedback',
  version: 1,
  startNode: DECISION_REFINEMENT_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    [DECISION_REFINEMENT_NODES.WELCOME]: {
      transitions: {
        default: {
          nextNodeId: DECISION_REFINEMENT_NODES.AGENT_ANALYSIS,
          description: 'Default agent loop',
        },
      },
    },

    [DECISION_REFINEMENT_NODES.RECOVERY]: {
      nextNode: DECISION_REFINEMENT_NODES.AGENT_ANALYSIS,
    },

    [DECISION_REFINEMENT_NODES.AGENT_ANALYSIS]: {
      nextNode: DECISION_REFINEMENT_NODES.AGENT_ANALYSIS,
    },

    [DECISION_REFINEMENT_NODES.FINALIZE_ACTION]: {
      nextNode: DECISION_REFINEMENT_NODES.END,
    },

    [DECISION_REFINEMENT_NODES.END]: {},
  },

  initialContextTransform: async (
    baseContext: FlowContext,
    workflowAboutId: string | undefined,
    workflowAboutType: string | undefined,
    appContext: INestApplicationContext,
  ): Promise<DecisionRefinementFlowContext> => {
    if (workflowAboutType !== 'design-doc') {
      throw new Error(
        `Decision refinement flow requires workflowAboutType="design-doc", got "${workflowAboutType}"`,
      );
    }

    if (!workflowAboutId) {
      throw new Error(
        'Decision refinement flow requires workflowAboutId (design doc ID)',
      );
    }

    const designDocService = appContext.get(DesignDocService, {
      strict: false,
    });

    const designDoc = await designDocService.findOneForAdapter(
      workflowAboutId as DesignDocId,
      baseContext.core.organizationId,
    );

    if (!designDoc) {
      throw new Error(
        `Design document ${workflowAboutId} not found for decision refinement workflow`,
      );
    }

    if (designDoc.template !== 'DECISION') {
      throw new Error(
        `Decision refinement flow requires DECISION template, got "${designDoc.template}"`,
      );
    }

    const derivedTitle = deriveAgentSessionTitle(
      AgentSessionType.DesignDocRefining,
      { designDocName: designDoc.name },
    );
    if (derivedTitle) {
      const agentSessionService = appContext.get(AgentSessionService, {
        strict: false,
      });
      await agentSessionService.applyDerivedTitleByConversation(
        baseContext.core.organizationId,
        baseContext.core.conversationId,
        derivedTitle,
      );
    }

    return {
      ...baseContext,
      designDocId: workflowAboutId as DesignDocId,
    };
  },
});
