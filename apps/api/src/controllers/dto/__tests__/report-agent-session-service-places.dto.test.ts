import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportAgentSessionServicePlacesRequestDto } from '../report-agent-session-service-places.dto';

const machineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const serviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherServiceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const errorsFor = (places: unknown[]) =>
  validate(
    plainToInstance(ReportAgentSessionServicePlacesRequestDto, {
      machineId,
      places,
    }),
  );

describe('ReportAgentSessionServicePlacesRequestDto', () => {
  it('accepts a worktree, a branch main folder and a detached main folder', async () => {
    const errors = await errorsFor([
      {
        serviceId,
        kind: 'WORKTREE',
        branch: 'feature/x',
        worktreePath: '/repo/.worktrees/x',
      },
      { serviceId: otherServiceId, kind: 'MAIN_FOLDER', branch: null },
    ]);

    expect(errors).toEqual([]);
  });

  it.each([
    ['without a branch', { kind: 'WORKTREE', worktreePath: '/w' }],
    [
      'with a null branch',
      { kind: 'WORKTREE', branch: null, worktreePath: '/w' },
    ],
    ['without a folder', { kind: 'WORKTREE', branch: 'b' }],
  ])('rejects a WORKTREE %s', async (_name, place) => {
    const errors = await errorsFor([{ serviceId, ...place }]);

    expect(errors).not.toHaveLength(0);
  });

  it('rejects an empty report and a Service reported twice', async () => {
    const place = { serviceId, kind: 'MAIN_FOLDER', branch: 'main' };

    expect(await errorsFor([])).not.toHaveLength(0);
    expect(await errorsFor([place, place])).not.toHaveLength(0);
  });
});
