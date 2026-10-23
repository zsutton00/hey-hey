import { Injectable } from '@nestjs/common';
import {
  SecondaryActionConfig,
  SecondaryActionHandler,
  SuggestedAgentActionMethod,
  SuggestedAgentActionPayload,
} from 'src/generated';
import {
  SecondaryActionContext,
  SecondaryActionDefinition,
} from './secondary-actions.types';

const FINAL_ASSESSMENT_FIELD = 'coding_prompt_merged_final_assessment';

/**
 * Hardcoded secondary action definitions.
 *
 * Each entry pairs a {@link SecondaryActionConfig} with the UI elements
 * and agent event types it is relevant for.  When filtering is active,
 * an empty array excludes the action from that dimension's results.
 *
 * IDs are deterministic constants so they remain stable across restarts.
 */
const TASK_COMPLETE = 'task_complete';

const ACTION_DEFINITIONS: SecondaryActionDefinition[] = [
  {
    action: {
      id: 'sa-system-diagram',
      type: SecondaryActionConfig.TypeEnum.FormAction,
      presentation: SecondaryActionConfig.PresentationEnum.Button,
      label: 'Request system diagram',
      fieldId: FINAL_ASSESSMENT_FIELD,
      handler: SecondaryActionHandler.SuggestedAgentAction,
      payload: {
        handlerType: 'suggested_agent_action',
        promptTemplate:
          'Generate a system architecture diagram for this codebase. ' +
          'Include the major components, their relationships, data flow, ' +
          'and external service integrations.',
      } as SuggestedAgentActionPayload,
    },
    uiElements: [FINAL_ASSESSMENT_FIELD],
    actionTypes: [],
  },
  {
    action: {
      id: 'sa-review',
      type: SecondaryActionConfig.TypeEnum.FormAction,
      presentation: SecondaryActionConfig.PresentationEnum.Button,
      label: 'Review',
      fieldId: FINAL_ASSESSMENT_FIELD,
      handler: SecondaryActionHandler.SuggestedAgentAction,
      payload: {
        handlerType: 'suggested_agent_action',
        promptTemplate:
          'Review the code changes made in this session. ' +
          'Identify potential bugs, security issues, performance ' +
          'concerns, and suggest improvements.',
      } as SuggestedAgentActionPayload,
    },
    uiElements: [],
    actionTypes: [TASK_COMPLETE],
  },
  {
    action: {
      id: 'sa-sync-hey-hey',
      type: SecondaryActionConfig.TypeEnum.FormAction,
      presentation: SecondaryActionConfig.PresentationEnum.Button,
      label: 'Sync',
      fieldId: FINAL_ASSESSMENT_FIELD,
      handler: SecondaryActionHandler.SuggestedAgentAction,
      payload: {
        handlerType: 'suggested_agent_action',
        method: SuggestedAgentActionMethod.FinalAssessment,
      } as SuggestedAgentActionPayload,
    },
    uiElements: [],
    actionTypes: [TASK_COMPLETE],
  },
];

@Injectable()
export class SecondaryActionsService {
  /**
   * Retrieves available secondary actions, optionally filtered
   * by UI element and/or agent event type.
   */
  async getActions(
    context?: SecondaryActionContext,
  ): Promise<SecondaryActionConfig[]> {
    const hasFilter = context?.uiElement != null || context?.actionType != null;

    const definitions = ACTION_DEFINITIONS.filter((def) => {
      if (!hasFilter) return true;

      if (context?.uiElement) {
        if (
          def.uiElements.length > 0 &&
          !def.uiElements.includes(context.uiElement)
        ) {
          return false;
        }
        if (def.uiElements.length === 0) return false;
      }

      if (context?.actionType) {
        if (
          def.actionTypes.length > 0 &&
          !def.actionTypes.includes(context.actionType)
        ) {
          return false;
        }
        if (def.actionTypes.length === 0) return false;
      }

      return true;
    });

    return definitions.map((def) => def.action);
  }
}
