import type { TaskMonitorConversationPromptPayload } from '../../shared/agent-bridge-contract/contract';

export const buildTaskMonitorConversationPrompt = (
  input: TaskMonitorConversationPromptPayload,
): string => `Respond normally to the user's canonical Task Monitor conversation message below.

Keep the existing coordinator identity and provider transcript. This message is durable conversation evidence only. Do not classify it as a coordinating-guidance change, a human judgment, a released implementation or Review result, or a supervision decision.

User message:
${input.userMessage}`;
