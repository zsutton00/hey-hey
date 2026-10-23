export interface CodexEventRoute {
  threadId: string | null;
  turnId: string | null;
}

export type CodexCompletionDisposition = 'root' | 'descendant' | 'unresolved';

export const classifyCodexEventRoute = (
  root: CodexEventRoute | null,
  route: CodexEventRoute,
): CodexCompletionDisposition => {
  if (route.threadId && root?.threadId && route.threadId !== root.threadId) {
    return 'descendant';
  }
  if (!route.threadId || !route.turnId || !root?.threadId || !root.turnId) {
    return 'unresolved';
  }
  return route.threadId === root.threadId && route.turnId === root.turnId ? 'root' : 'descendant';
};
