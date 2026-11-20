import { BadRequestException } from '@nestjs/common';
import {
  AgentSessionServicePlaceKind,
  type ServicePlaceChoice,
} from '@hey-hey/contracts/api/models';
import {
  assertDecisionServicePlaceChoices,
  assertLaunchServicePlaceChoices,
  INVALID_SERVICE_PLACE_CHOICES,
} from '../service-place-choices.validator';

const api = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cli = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const outsider = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const main = (serviceId: string): ServicePlaceChoice => ({
  serviceId,
  kind: AgentSessionServicePlaceKind.MainFolder,
});
const worktree = (
  serviceId: string,
  branch: string,
  newBranch?: boolean,
): ServicePlaceChoice => ({
  serviceId,
  kind: AgentSessionServicePlaceKind.Worktree,
  branch,
  ...(newBranch === undefined ? {} : { newBranch }),
});

const launch = { serviceIds: [api, cli] };

function rejection(run: () => void): BadRequestException {
  try {
    run();
  } catch (error) {
    return error as BadRequestException;
  }
  throw new Error('expected a rejection');
}

function expectRejectedNaming(run: () => void, serviceId: string) {
  const error = rejection(run);
  const body = error.getResponse() as { code: string; message: string };

  expect(error).toBeInstanceOf(BadRequestException);
  expect(body.code).toBe(INVALID_SERVICE_PLACE_CHOICES);
  expect(body.message).toContain(serviceId);
}

describe('launch service place choices', () => {
  it('accepts main folder, existing worktree and new worktree choices', () => {
    expect(() =>
      assertLaunchServicePlaceChoices(
        [main(api), worktree(cli, 'feature/x', true)],
        launch,
      ),
    ).not.toThrow();
    expect(() =>
      assertLaunchServicePlaceChoices([worktree(api, 'feature/x', false)], {
        serviceIds: [api],
      }),
    ).not.toThrow();
  });

  it('behaves as before when no choices are sent', () => {
    expect(() =>
      assertLaunchServicePlaceChoices(undefined, {
        ...launch,
        worktreeBranch: 'feature/x',
        planLockedBranch: 'plan/y',
      }),
    ).not.toThrow();
  });

  it.each([
    [
      'a worktree without a branch',
      [{ serviceId: api, kind: AgentSessionServicePlaceKind.Worktree }],
      api,
    ],
    ['newBranch on the main folder', [{ ...main(api), newBranch: true }], api],
    ['a branch on the main folder', [{ ...main(api), branch: 'x' }], api],
    ['a Service outside the launch', [main(cli), main(outsider)], outsider],
    ['a Service chosen twice', [main(api), worktree(api, 'x')], api],
  ])('rejects %s and names the Service', (_name, choices, serviceId) => {
    expectRejectedNaming(
      () =>
        assertLaunchServicePlaceChoices(choices as ServicePlaceChoice[], {
          serviceIds: [api, cli],
        }),
      serviceId,
    );
  });

  it('requires choices to agree with the session-wide worktree', () => {
    const context = { ...launch, worktreeBranch: 'feature/x' };

    expect(() =>
      assertLaunchServicePlaceChoices(
        [worktree(api, 'feature/x'), worktree(cli, 'feature/x', false)],
        context,
      ),
    ).not.toThrow();
    expectRejectedNaming(
      () =>
        assertLaunchServicePlaceChoices(
          [worktree(api, 'feature/x'), worktree(cli, 'other')],
          context,
        ),
      cli,
    );
    expectRejectedNaming(
      () =>
        assertLaunchServicePlaceChoices(
          [worktree(api, 'feature/x'), main(cli)],
          context,
        ),
      cli,
    );
  });

  it('requires choices to use the Plan-locked branch', () => {
    const context = { ...launch, planLockedBranch: 'plan/y' };

    expect(() =>
      assertLaunchServicePlaceChoices(
        [worktree(api, 'plan/y'), worktree(cli, 'plan/y')],
        context,
      ),
    ).not.toThrow();
    expectRejectedNaming(
      () =>
        assertLaunchServicePlaceChoices(
          [worktree(api, 'plan/y'), worktree(cli, 'different')],
          context,
        ),
      cli,
    );
  });
});

describe('decision service place choices', () => {
  it('accepts choices on an approve and decisions without choices', () => {
    expect(() =>
      assertDecisionServicePlaceChoices(
        [main(api), worktree(cli, 'feature/x', true)],
        'approve',
      ),
    ).not.toThrow();
    expect(() =>
      assertDecisionServicePlaceChoices(undefined, 'deny'),
    ).not.toThrow();
  });

  it('rejects choices on a deny, duplicates and malformed choices', () => {
    expectRejectedNaming(
      () => assertDecisionServicePlaceChoices([main(api)], 'deny'),
      api,
    );
    expectRejectedNaming(
      () =>
        assertDecisionServicePlaceChoices([main(api), main(api)], 'approve'),
      api,
    );
    expectRejectedNaming(
      () =>
        assertDecisionServicePlaceChoices(
          [{ serviceId: cli, kind: AgentSessionServicePlaceKind.Worktree }],
          'approve',
        ),
      cli,
    );
  });
});
