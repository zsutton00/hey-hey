import { LocalPromptType } from 'src/generated/local';
import {
  BrainstormRefinementFlowContext,
  FlowContext,
} from '../../types/flow-internal.types';
import { AgentSessionService } from '../../services/agent-session.service';
import { deriveAgentSessionTitle } from '../../services/agent-session-title';
import { DesignDocService } from '../../services/design-doc/design-doc.service';
import { DesignDocId } from '../../types/design-doc.types';
import { INestApplicationContext } from '@nestjs/common';
import { AgentSessionType, WorkflowName } from 'src/generated';

import { BRAINSTORM_REFINEMENT_NODES } from '../constants';
import { createFlow } from './utils';

export const brainstormRefinementFlow = createFlow({
  id: WorkflowName.BrainstormRefinement,
  name: 'Brainstorm Refinement',
  description:
    'Conversational refinement of Brainstorm design docs with focused feedback',
  version: 1,
  startNode: BRAINSTORM_REFINEMENT_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    [BRAINSTORM_REFINEMENT_NODES.WELCOME]: {
      transitions: {
        default: {
          nextNodeId: BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS,
          description: 'Default agent loop',
        },
      },
    },

    [BRAINSTORM_REFINEMENT_NODES.RECOVERY]: {
      nextNode: BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS,
    },

    [BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS]: {
      nextNode: BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS,
    },

    [BRAINSTORM_REFINEMENT_NODES.FINALIZE_ACTION]: {
      nextNode: BRAINSTORM_REFINEMENT_NODES.END,
    },

    [BRAINSTORM_REFINEMENT_NODES.END]: {},
  },

  initialContextTransform: async (
    baseContext: FlowContext,
    workflowAboutId: string | undefined,
    workflowAboutType: string | undefined,
    appContext: INestApplicationContext,
  ): Promise<BrainstormRefinementFlowContext> => {
    if (workflowAboutType !== 'design-doc') {
      throw new Error(
        `Brainstorm refinement flow requires workflowAboutType="design-doc", got "${workflowAboutType}"`,
      );
    }

    if (!workflowAboutId) {
      throw new Error(
        'Brainstorm refinement flow requires workflowAboutId (design doc ID)',
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
        `Design document ${workflowAboutId} not found for brainstorm refinement workflow`,
      );
    }

    if (designDoc.template !== 'BRAINSTORM') {
      throw new Error(
        `Brainstorm refinement flow requires BRAINSTORM template, got "${designDoc.template}"`,
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
