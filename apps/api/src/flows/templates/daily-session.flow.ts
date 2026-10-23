import { LocalPromptType } from 'src/generated/local';
import { AgentSessionType, WorkflowName } from 'src/generated';
import { AgentSessionService } from 'src/services/agent-session.service';
import { deriveAgentSessionTitle } from 'src/services/agent-session-title';
import { DailySessionFlowContext } from 'src/types/flow-internal.types';
import { DAILY_SESSION_NODES } from '../constants';
import { createFlow } from './utils';

export const dailySessionFlow = createFlow<DailySessionFlowContext>({
  id: WorkflowName.DailySession,
  name: 'Daily Session',
  description:
    'Conversational agent for assisting with daily goals and progress',
  version: 1,
  startNode: DAILY_SESSION_NODES.WELCOME,
  terminalPromptType: LocalPromptType.free_form,

  nodes: {
    [DAILY_SESSION_NODES.WELCOME]: {
      nextNode: DAILY_SESSION_NODES.AGENT,
    },

    [DAILY_SESSION_NODES.RECOVERY]: {
      nextNode: DAILY_SESSION_NODES.AGENT,
    },

    [DAILY_SESSION_NODES.AGENT]: {
      transitions: {
        default: {
          nextNodeId: DAILY_SESSION_NODES.AGENT,
          description: 'Continue daily session conversation',
        },
        end: {
          nextNodeId: DAILY_SESSION_NODES.END,
          description: 'Session complete',
        },
      },
    },

    [DAILY_SESSION_NODES.END]: {},
  },

  async initialContextTransform(
    baseContext,
    _workflowAboutId,
    _workflowAboutType,
    appContext,
  ): Promise<DailySessionFlowContext> {
    const derivedTitle = deriveAgentSessionTitle(
      AgentSessionType.DailySession,
      {
        sessionDate: new Date(),
      },
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
    return baseContext;
  },
});
