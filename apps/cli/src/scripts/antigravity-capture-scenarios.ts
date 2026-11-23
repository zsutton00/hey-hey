/** ACP capture scenarios; each produces `<scenario>.ndjson` + `<scenario>.meta.json`. */
export const SCENARIOS = [
  'quick',
  'follow-up',
  'resume',
  'cancel',
  'permission-allow-once',
  'permission-allow-always',
  'permission-reject',
  'plan',
  'mcp-tools',
  'mcp-subset',
  'write-outside',
  'hook-relay',
] as const;
