import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListMachineServicePlacesRequestDto } from '../service-places-requests.dto';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const errorsFor = (overrides: Record<string, unknown>) =>
  validate(
    plainToInstance(ListMachineServicePlacesRequestDto, {
      operation: 'workspace.service_places.list',
      authorization: { kind: 'bounded_grant', grantId: 'grant' },
      serviceIds: [uuid(1)],
      ...overrides,
    }),
  );

describe('ListMachineServicePlacesRequestDto', () => {
  it('accepts a request that meets the published constraints', async () => {
    const serviceIds = Array.from({ length: 20 }, (_, i) => uuid(i + 1));

    expect(await errorsFor({ serviceIds, branchQuery: 'a'.repeat(100) })).toEqual([]);
  });

  it.each([
    ['another operation', { operation: 'runtime.model_catalog.get' }],
    ['no Services', { serviceIds: [] }],
    ['more than 20 Services', { serviceIds: Array.from({ length: 21 }, (_, i) => uuid(i + 1)) }],
    ['a repeated Service', { serviceIds: [uuid(1), uuid(1)] }],
    ['a non-UUID Service', { serviceIds: ['not-a-uuid'] }],
    ['a branch query over 100 characters', { branchQuery: 'a'.repeat(101) }],
  ])('rejects %s', async (_name, overrides) => {
    expect(await errorsFor(overrides)).not.toHaveLength(0);
  });
});
