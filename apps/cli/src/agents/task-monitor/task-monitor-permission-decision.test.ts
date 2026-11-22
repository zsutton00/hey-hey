import { describe, expect, it } from 'vitest';

import { decisionActionAllowedForCause } from './task-monitor-permission-decision';

describe('Task Monitor decision actions by trigger', () => {
  it.each(['APPROVE_PERMISSION', 'DENY_PERMISSION', 'ESCALATE_PERMISSION'] as const)(
    'accepts %s only for a permission request',
    (action) => {
      expect(decisionActionAllowedForCause('PERMISSION_REQUEST', action)).toBe(true);
      expect(decisionActionAllowedForCause('CONTINUE', action)).toBe(false);
      expect(decisionActionAllowedForCause('RESUME', action)).toBe(false);
    },
  );

  it.each(['ACCEPT_TASK', 'WAIT', 'HALT', 'REQUEST_REVIEW'] as const)(
    'never accepts %s for a permission request',
    (action) => {
      expect(decisionActionAllowedForCause('PERMISSION_REQUEST', action)).toBe(false);
      expect(decisionActionAllowedForCause('CONTINUE', action)).toBe(true);
    },
  );
});
