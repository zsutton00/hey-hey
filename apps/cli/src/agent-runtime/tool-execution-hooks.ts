/** Launch-only hook transport; it never grants permissions or modifies a tool call. */
export interface ToolExecutionHookLaunch {
  readonly command: string;
  readonly environment: {
    readonly HEY_HEY_CAPTURE_URL: string;
    readonly HEY_HEY_CAPTURE_TOKEN: string;
  };
}

export interface ToolExecutionCommandHook {
  readonly matcher: string;
  readonly hooks: readonly {
    readonly type: 'command';
    readonly command: string;
    readonly timeout: number;
  }[];
}

export type ToolExecutionHookSettings = Partial<
  Record<'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure', readonly ToolExecutionCommandHook[]>
>;

export const toolExecutionHookSettings = (
  provider: 'codex' | 'claude',
  command: string,
): ToolExecutionHookSettings => {
  const group = {
    matcher:
      provider === 'codex'
        ? '^(Bash|apply_patch|Edit|Write)$'
        : '^(Bash|Write|Edit|MultiEdit|NotebookEdit)$',
    hooks: [{ type: 'command' as const, command, timeout: 120 }],
  };
  return {
    PreToolUse: [group],
    PostToolUse: [group],
    ...(provider === 'claude' ? { PostToolUseFailure: [group] } : {}),
  };
};
