/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationsApi,
  EntityContextApi,
  ImplementationHintsApi,
  ReadRestriction,
  SearchApi,
} from '../../shared/api/generated';
import { createLiveReader } from '../traversal';
import { createLiveSearchExecutor } from '.';

const restrictionOf = (client: unknown): unknown =>
  Reflect.get(
    Reflect.get(Reflect.get(client ?? {}, 'configuration') ?? {}, 'baseOptions') ?? {},
    'headers',
  )?.['X-Read-Restriction'];

const deps = (readRestriction?: ReadRestriction) => ({
  auth: { getAccessToken: () => Promise.resolve('token') },
  apiBaseUrl: 'https://api.test',
  organizationId: 'org-1',
  projectId: 'project-1',
  ...(readRestriction ? { readRestriction } : {}),
});

const TASK = '00000000-0000-0000-0000-000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('experimental context gathering under a read restriction', () => {
  it.each([
    {
      name: 'an evaluated attempt',
      restriction: ReadRestriction.EvalTarget,
      expected: 'EVAL_TARGET',
    },
    { name: 'an ordinary session', restriction: undefined, expected: undefined },
  ])('searches the project as $name', async ({ restriction, expected }) => {
    const seen: unknown[] = [];
    vi.spyOn(SearchApi.prototype, 'unifiedSearch').mockImplementation(function (this: SearchApi) {
      seen.push(restrictionOf(this));
      return Promise.resolve({ data: { data: { results: [] } } } as never);
    });

    await createLiveSearchExecutor(deps(restriction)).search({ query: 'retrying failed attempts' });

    expect(seen).toEqual([expected]);
  });

  it.each([
    {
      name: 'an evaluated attempt',
      restriction: ReadRestriction.EvalTarget,
      expected: 'EVAL_TARGET',
    },
    { name: 'an ordinary session', restriction: undefined, expected: undefined },
  ])('reads every kind of entity as $name', async ({ restriction, expected }) => {
    const seen: unknown[] = [];
    const record = function (this: unknown) {
      seen.push(restrictionOf(this));
      return Promise.reject(new Error('stop after the request is built'));
    };
    vi.spyOn(EntityContextApi.prototype, 'getEntityContext').mockImplementation(record);
    vi.spyOn(ConversationsApi.prototype, 'getMessage').mockImplementation(record);
    vi.spyOn(ImplementationHintsApi.prototype, 'getImplementationHint').mockImplementation(record);

    const message = '00000000-0000-0000-0000-000000000002';
    const hint = '00000000-0000-0000-0000-000000000003';
    const reader = createLiveReader({ id: TASK, kind: 'task' }, deps(restriction), [
      { id: message, kind: 'message' },
      { id: hint, kind: 'implementation_hint' },
    ]);
    for (const id of [TASK, message, hint]) {
      await reader.read(id).catch(() => undefined);
    }

    expect(seen).toEqual([expected, expected, expected]);
  });
});
