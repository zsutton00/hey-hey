import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  SystemMessageData,
  SystemMessageResponseType,
} from 'src/generated';
import { NodeResult, NodeType } from 'src/types/flow-internal.types';

function getResponseTypeForNode(nodeType: string): SystemMessageResponseType {
  switch (nodeType) {
    case 'llm_questions':
      return 'QUESTIONS';
    case 'questions':
      return 'QUESTIONS';
    case 'analyze':
      return SystemMessageResponseType.Analysis;
    case 'generate':
      return SystemMessageResponseType.Initiatives;
    case 'agent':
      return SystemMessageResponseType.Agent;
    case 'finalize':
      return SystemMessageResponseType.Noop;
    default:
      return SystemMessageResponseType.Analysis;
  }
}

export function convertNodeResultToSystemMessage(
  nodeResult: NodeResult,
  nodeType: string,
  nodeId: string,
): SystemMessageData {
  let responseType: SystemMessageResponseType;
  if ('type' in nodeResult && nodeResult.type) {
    responseType = getResponseTypeForNode(nodeResult.type);
  } else {
    responseType = getResponseTypeForNode(nodeType);
  }

  const baseData = {
    type: responseType as SystemMessageData['type'],
    nodeId,
    response: nodeResult.message || `Starting...`,
    triggersAgent: nodeResult.triggersAgent,
    ...nodeResult.data,
  } as SystemMessageData;

  const uiElementsFromData = (nodeResult.data as Record<string, unknown>)
    ?.uiElements;
  let uiElements = Array.isArray(uiElementsFromData)
    ? uiElementsFromData
    : Array.isArray(nodeResult.uiElements)
      ? nodeResult.uiElements
      : undefined;

  if (
    !nodeResult.message &&
    !uiElements?.length &&
    nodeResult.type === NodeType.EXTERNAL_AGENT
  ) {
    // these messages get created as a side effect of some nodes
    // in and of it self that needs to be fixed but in the meantime
    // this will hide them
    baseData.response = '';
    uiElements = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Starting message',
        required: false,
        influences: [],
      },
    ];
  }

  const uiElementTypes: Array<SystemMessageData['type']> = [
    'QUESTIONS',
    'ANALYSIS',
    'INITIATIVES',
    'ARTIFACTS_GENERATION',
    'INTEGRATIONS',
    'TASKS',
    'TASK_STUBS',
    'TASK_PRIORITY',
    'CODING_PROMPTS',
    'AGENT',
    'ROUTING',
  ];

  if (uiElements && uiElementTypes.includes(baseData.type)) {
    return {
      ...baseData,
      uiElements,
    } as SystemMessageData;
  }

  return baseData;
}
