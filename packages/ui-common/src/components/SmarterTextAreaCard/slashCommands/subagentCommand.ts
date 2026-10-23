type SubagentDeliveryMode = "foreground" | "background";
export interface SubagentCommandChoices {
  mode: SubagentDeliveryMode;
  capability: "research";
  /** Child Service set; absent until edited, meaning the source session's set. */
  serviceIds?: string[];
}
export interface SubagentCommandIntent extends SubagentCommandChoices {
  kind: "subagent";
  objective: string;
}
export interface SubagentCommandPrefix extends SubagentCommandChoices {
  length: number;
}
export function startsWithSubagentCommand(text: string): boolean {
  return /^\s*\/subagent(?=\s|$)/.test(text);
}
/** Recognition for editor conversion only; submission reads structured choices. */
export function parseSubagentCommandPrefix(
  text: string,
): SubagentCommandPrefix | null {
  const trigger = /^\s*\/subagent\s+/.exec(text);
  if (!trigger) return null;
  const filled = /^(foreground|background)\s+research(?:\s+|$)/.exec(
    text.slice(trigger[0].length),
  );
  return {
    mode: filled?.[1] === "background" ? "background" : "foreground",
    capability: "research",
    length: trigger[0].length + (filled?.[0].length ?? 0),
  };
}
