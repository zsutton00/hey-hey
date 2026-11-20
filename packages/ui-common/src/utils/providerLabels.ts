import type { Provider } from "../api";

export const PROVIDER_LABELS = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity",
} satisfies Record<Provider, string>;
