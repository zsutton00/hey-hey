import { BadRequestException } from '@nestjs/common';
import { ServicePlacesController } from '../service-places.controller';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('ServicePlacesController recent branches', () => {
  const sessions = { listRecentServicePlaces: jest.fn() };
  const controller = new ServicePlacesController({} as never, sessions as never);
  const call = (serviceIds?: string | string[]) =>
    controller.listRecent('project' as never, 'org' as never, serviceIds);

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.listRecentServicePlaces.mockResolvedValue({ services: [] });
  });

  it('passes 1 to 20 unique Service IDs through unchanged', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => uuid(i + 1));

    await call(ids);

    expect(sessions.listRecentServicePlaces).toHaveBeenCalledWith({
      organizationId: 'org',
      projectId: 'project',
      serviceIds: ids,
    });
  });

  it.each([
    ['no Services', undefined],
    ['a repeated Service', [uuid(1), uuid(1)]],
    ['21 Services', Array.from({ length: 21 }, (_, i) => uuid(i + 1))],
    ['21 IDs that collapse to 20 distinct', [...Array.from({ length: 20 }, (_, i) => uuid(i + 1)), uuid(1)]],
    ['a non-UUID', 'nope'],
  ])('rejects %s before reading', (_name, ids) => {
    expect(() => call(ids)).toThrow(BadRequestException);
    expect(sessions.listRecentServicePlaces).not.toHaveBeenCalled();
  });
});
