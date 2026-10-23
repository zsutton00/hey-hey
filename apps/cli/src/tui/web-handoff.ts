/**
 * Open-in-web for a local session. The web app's agent-session resolver route
 * takes the canonical conversation identity and redirects to the live
 * conversation page, so no other identifier is needed or invented here.
 */

import type { LocalSessionSnapshot } from '../server/local-session-read-source';

export type WebHandoff =
  | { readonly available: true; readonly url: string }
  | { readonly available: false; readonly reason: string };

export const conversationWebHandoff = (
  webOrigin: string,
  session: Pick<LocalSessionSnapshot, 'projectId' | 'conversationId'>,
): WebHandoff => {
  if (session.projectId.length === 0 || session.conversationId.length === 0) {
    return { available: false, reason: 'This session has no web conversation yet.' };
  }
  const path =
    `/projects/${encodeURIComponent(session.projectId)}` +
    `/resolve-agent-session/${encodeURIComponent(session.conversationId)}`;
  return { available: true, url: new URL(path, webOrigin).toString() };
};
