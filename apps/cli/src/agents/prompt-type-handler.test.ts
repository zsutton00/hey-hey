import { describe, expect, it } from 'vitest';
import { resolveHandlerSessionRole } from './prompt-type-handler';
import { freeFormHandler } from './coding-conversation';
import { SessionRole } from '../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../session/types';

// Static/default handlers do not read selected mode settings.
const session = {} as AgenticSession;

describe('resolveHandlerSessionRole', () => {
  it('uses the shared implementation default for an undeclared handler', () => {
    expect(resolveHandlerSessionRole(freeFormHandler, session)).toBe(SessionRole.Implementation);
  });
  it.each(Object.values(SessionRole))('honors an explicit %s declaration', (sessionRole) => {
    expect(resolveHandlerSessionRole({ ...freeFormHandler, sessionRole }, session)).toBe(
      sessionRole,
    );
  });
  it('gives the handler resolver the current session and precedence over a declaration', () => {
    expect(
      resolveHandlerSessionRole(
        {
          ...freeFormHandler,
          sessionRole: SessionRole.Implementation,
          resolveSessionRole: (current) => {
            expect(current).toBe(session);
            return SessionRole.Planning;
          },
        },
        session,
      ),
    ).toBe(SessionRole.Planning);
  });
});
