import type {
  ImplementationReadinessFinding,
  ImplementationReadinessLegacyFinding,
} from '@hey-hey/contracts/api/models';

const HOME_PAGE_TASK = {
  entityType: 'TASK',
  entityId: 'c9a7158b-4817-4a78-a2f7-671de909ec78',
  title:
    'Take a local user from the home page straight to their workspace instead of the hosted sign-up landing page',
} as const;

const LOGIN_TASK = {
  entityType: 'TASK',
  entityId: '0f5e6126-08ca-4b16-af4e-0e6044cba183',
  title:
    'Let a local user reach the app from the login page without signing in, using a deployment flag that leaves hosted login unchanged',
} as const;

/**
 * A realistic populated finding: the home-page task is blocked by the login task, which has
 * not yet decided how the browser proves it is on the same machine. Shared across suites so
 * the full six-part explanation is exercised through every handoff.
 */
export const homePageBlockedFinding = {
  requestedOutcome:
    'You asked for a local user who opens the home page to land in their workspace instead of the hosted sign-up page.',
  reasoningTrail: [
    {
      source: HOME_PAGE_TASK,
      explanation: 'It says the home page should reuse the way the login page recognizes a local user.',
    },
    {
      source: LOGIN_TASK,
      explanation:
        'It lists how the browser proves it is on this machine as an open question and requires a reviewed design first.',
    },
  ],
  problem:
    'The home page depends on a way of recognizing a local browser that the login task has not decided yet.',
  failureScenario: [
    'A local user opens the home page.',
    'The home page needs to know this browser is on the same machine as the app.',
    'No recognition method has been chosen, so the home page would have to pick one itself.',
    'A different method than the login page uses could let an unrelated website obtain a session.',
  ],
  fixSteps: [
    {
      owner: LOGIN_TASK,
      action: 'Decide and record how the browser proves it is on this machine.',
      state: 'USER_DECISION',
    },
    {
      owner: HOME_PAGE_TASK,
      action: 'Reuse the recorded login mechanism for the home page redirect.',
      state: 'REMAINING',
    },
  ],
  userRequest: 'Please decide the browser-recognition method on the login task, then rerun this task.',
  boundedEvidence: [
    {
      category: 'security',
      statement: 'The login task lists browser recognition as an unresolved question.',
      sourceRef: 'login task description',
    },
  ],
} as const satisfies ImplementationReadinessFinding;

/** A finding saved before the explained layout existed; must stay readable unchanged. */
export const legacyReadinessFinding = {
  affectedSourceContext: 'The task description and API design doc',
  unresolvedDecision: 'Which service owns the durable state?',
  consequentialInventionRisk: 'Implementation could lose or duplicate durable state.',
  boundedEvidence: [{ category: 'ownership', statement: 'Two services are named without a choice.' }],
  answerKind: 'Name the owning service.',
} as const satisfies ImplementationReadinessLegacyFinding;
