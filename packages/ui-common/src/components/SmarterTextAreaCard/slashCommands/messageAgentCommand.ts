export interface MessageAgentCommandIntent {
  kind: "message-agent";
  targetSessionId: string;
  commandText: string;
}

export type MessageAgentCommandResolution =
  | { kind: "literal" }
  | { kind: "incomplete"; reason: string }
  | { kind: "executable"; intent: MessageAgentCommandIntent };

const SESSION_MENTION = /@\[agent_session:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|([^\]]+)\]/g;

/** A canonical Agent Session mention is inert until this leading command is submitted. */
export function resolveMessageAgentCommand(message: string): MessageAgentCommandResolution {
  const token = /^\s*\/message-agent(?=\s|$)/.exec(message);
  if (!token) return { kind: "literal" };
  const match = /^\s*\/message-agent\s+(@\[agent_session:[^\]]+\])\s+([\s\S]+)$/.exec(message);
  const mentions = [...message.matchAll(SESSION_MENTION)];
  if (!match || mentions.length !== 1 || match[1] !== mentions[0][0] || !match[2].trim()) {
    return { kind: "incomplete", reason: "Select one Agent Session mention and enter an objective or answer reference." };
  }
  return {
    kind: "executable",
    intent: { kind: "message-agent", targetSessionId: mentions[0][1], commandText: message },
  };
}
