import { BadRequestException } from '@nestjs/common';
import {
  AgentSessionServicePlaceKind,
  type ServicePlaceChoice,
} from '@hey-hey/contracts/api/models';

export const INVALID_SERVICE_PLACE_CHOICES = 'INVALID_SERVICE_PLACE_CHOICES';

export interface LaunchPlaceContext {
  /** Services the launch runs against. */
  serviceIds: readonly string[];
  /** The session-wide worktree sent with the launch, if any. */
  worktree?: { enabled: boolean; branch?: string };
  /** The Plan's locked branch, when the launch belongs to a Plan. */
  planLockedBranch?: string;
}

function reject(serviceId: string, message: string): never {
  throw new BadRequestException({
    code: INVALID_SERVICE_PLACE_CHOICES,
    message: `Service ${serviceId}: ${message}`,
    serviceId,
  });
}

/** Checks one choice per Service, and that each choice names what its kind needs. */
export function assertUniqueAndWellFormed(
  choices: readonly ServicePlaceChoice[],
) {
  const seen = new Set<string>();

  for (const choice of choices) {
    if (seen.has(choice.serviceId)) {
      reject(
        choice.serviceId,
        'has more than one place choice. Send one choice per Service.',
      );
    }
    seen.add(choice.serviceId);

    if (choice.kind === AgentSessionServicePlaceKind.MainFolder) {
      if ('branch' in choice || 'newBranch' in choice) {
        reject(
          choice.serviceId,
          'works in its main folder, so it cannot name a branch or a new branch. Remove them or choose a worktree.',
        );
      }
      continue;
    }

    if (!choice.branch) {
      reject(
        choice.serviceId,
        'works in a worktree but names no branch. Name the branch to work on.',
      );
    }
  }
}

function assertBranchMatches(
  choices: readonly ServicePlaceChoice[],
  branch: string,
  source: string,
) {
  for (const choice of choices) {
    if (
      choice.kind !== AgentSessionServicePlaceKind.Worktree ||
      choice.branch !== branch
    ) {
      reject(
        choice.serviceId,
        `must work in a worktree on branch "${branch}" because ${source}. Choose that worktree or change the ${source === 'the Plan locks its branch' ? 'Plan' : 'session-wide worktree'}.`,
      );
    }
  }
}

function assertSessionWorktreeMatches(
  choices: readonly ServicePlaceChoice[],
  branch: string | undefined,
) {
  if (branch === undefined) {
    reject(
      choices[0]?.serviceId ?? 'unknown',
      'cannot take a place choice while the launch sets a session-wide worktree without a branch. Name the worktree branch or remove the session-wide worktree.',
    );
  }

  assertBranchMatches(
    choices,
    branch,
    'the launch sets a session-wide worktree',
  );
}

/** Checks a launch's per-Service places before they reach the CLI. */
export function assertLaunchServicePlaceChoices(
  choices: readonly ServicePlaceChoice[] | undefined,
  context: LaunchPlaceContext,
): void {
  if (!choices?.length) {
    return;
  }

  assertUniqueAndWellFormed(choices);

  for (const choice of choices) {
    if (!context.serviceIds.includes(choice.serviceId)) {
      reject(
        choice.serviceId,
        'is not part of this launch. Choose places only for the launch Services.',
      );
    }
  }

  if (context.worktree?.enabled) {
    assertSessionWorktreeMatches(choices, context.worktree.branch);
  }

  if (context.planLockedBranch !== undefined) {
    assertBranchMatches(
      choices,
      context.planLockedBranch,
      'the Plan locks its branch',
    );
  }
}

/** Checks the places on an access-request decision. */
export function assertDecisionServicePlaceChoices(
  choices: readonly ServicePlaceChoice[] | undefined,
  decision: string,
): void {
  if (!choices?.length) {
    return;
  }

  if (decision !== 'approve') {
    reject(
      choices[0]?.serviceId ?? 'unknown',
      `has a place choice on a "${decision}" decision. Places are accepted only when approving.`,
    );
  }

  assertUniqueAndWellFormed(choices);
}
