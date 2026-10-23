import { LocalPromptType } from 'src/generated/local';
import {
  AdrRefinementFlowContext,
  FlowContext,
} from '../../types/flow-internal.types';
import { AgentSessionService } from '../../services/agent-session.service';
import { deriveAgentSessionTitle } from '../../services/agent-session-title';
import { DesignDocService } from '../../services/design-doc/design-doc.service';
import { DesignDocId } from '../../types/design-doc.types';
import { INestApplicationContext } from '@nestjs/common';
import { AgentSessionType } from 'src/generated';

import { ADR_REFINEMENT_NODES } from '../constants';
import { createFlow } from './utils';

/**
 * ADR Refinement Flow
 *
 * This flow implements a unified ADR (Architecture Decision Record) refinement system
 * that mirrors the task refinement workflow with 90%+ code reuse. The flow guides users
 * through progressive refinement of ADRs across three levels: context → decision → consequences
 *
 * Architecture:
 * - Uses status enum for consistent status progression
 * - Leverages agent-based content generation with specialized AI agents per level
 * - Implements level-aware message classification for intelligent routing
 * - Supports both manual and automated content generation workflows
 *
 * Key Features:
 * - Progressive refinement with quality gates at each level
 * - Auto-approval after manual edits to streamline UX
 * - Comprehensive error handling with user-friendly messages
 * - Real-time status updates using status state machine
 *
 * Flow Progression:
 * ADR_CONTEXT → ADR_DECISION → ADR_CONSEQUENCES → ADR_REVIEW → APPROVED
 */
export const adrRefinementFlow = createFlow({
  id: 'adr',
  name: 'ADR Refinement',
  description:
    'Level-aware conversational refinement of ADRs with intelligent message classification',
  version: 1,
  startNode: ADR_REFINEMENT_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    // Welcome node - starts the refinement process and initializes level context
    // Uses determineRouting to check if content exists and route accordingly
    [ADR_REFINEMENT_NODES.WELCOME]: {
      transitions: {
        noContent: {
          nextNodeId: ADR_REFINEMENT_NODES.PROMPT_NEXT_INPUT,
          description: 'For zero context new ADR skip agentic data gathering',
        },
        default: {
          nextNodeId: ADR_REFINEMENT_NODES.STARTING_AGENT,
          description: 'Default agent loop',
        },
      },
      // nextNode: ADR_REFINEMENT_NODES.STARTING_AGENT,
    },

    [ADR_REFINEMENT_NODES.RECOVERY]: {
      nextNode: ADR_REFINEMENT_NODES.PROMPT_NEXT_INPUT,
    },

    [ADR_REFINEMENT_NODES.STARTING_AGENT]: {
      nextNode: ADR_REFINEMENT_NODES.AGENT_ANALYSIS,
    },

    [ADR_REFINEMENT_NODES.AGENT_ANALYSIS]: {
      nextNode: ADR_REFINEMENT_NODES.AGENT_ANALYSIS,
    },

    [ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL]: {
      nextNode: ADR_REFINEMENT_NODES.AGENT_ANALYSIS,
    },

    [ADR_REFINEMENT_NODES.END]: {},
  },

  // Initial context transformation to populate ADR-specific fields
  initialContextTransform: async (
    baseContext: FlowContext,
    workflowAboutId: string | undefined,
    workflowAboutType: string | undefined,
    appContext: INestApplicationContext,
  ): Promise<AdrRefinementFlowContext> => {
    // Validate that this is an ADR refinement workflow
    if (workflowAboutType !== 'design-doc') {
      throw new Error(
        `ADR refinement flow requires workflowAboutType="design-doc", got "${workflowAboutType}"`,
      );
    }

    if (!workflowAboutId) {
      throw new Error(
        'ADR refinement flow requires workflowAboutId (design doc ID)',
      );
    }

    // Get design doc service to fetch the document
    const designDocService = appContext.get(DesignDocService, {
      strict: false,
    });

    // Find the design document
    const designDoc = await designDocService.findOneForAdapter(
      workflowAboutId as DesignDocId,
      baseContext.core.organizationId,
    );

    if (!designDoc) {
      throw new Error(
        `Design document ${workflowAboutId} not found for ADR refinement workflow`,
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

    // Return properly typed AdrRefinementFlowContext
    return {
      ...baseContext,
      designDocId: workflowAboutId as DesignDocId,
      // Optional: initiativeIds and taskIds can be populated later if relationships exist
    };
  },
});
