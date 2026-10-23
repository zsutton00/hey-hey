import {
  MutableContext,
  applyContextPatch,
  ContextPatch,
} from '../mutable-context';

describe('MutableContext', () => {
  it('tracks top-level set operations', () => {
    const base = { foo: 'bar', count: 1 };
    const tracker = new MutableContext(base);

    tracker.mutate((ctx) => {
      ctx.foo = 'baz';
      ctx.count = 2;
    });

    const patch = tracker.getPatch();
    expect(patch).toEqual([
      { op: 'set', path: ['foo'], value: 'baz' },
      { op: 'set', path: ['count'], value: 2 },
    ]);
  });

  it('tracks nested set operations and cloning of values', () => {
    const base = { nested: { a: 1 } };
    const tracker = new MutableContext(base);

    tracker.mutate((ctx) => {
      ctx.nested.a = 2;
      (ctx as any).nested.b = { c: 3 };
    });
    const ctx = tracker.getContext();

    const patch = tracker.getPatch();
    expect(patch).toEqual([
      { op: 'set', path: ['nested', 'a'], value: 2 },
      { op: 'set', path: ['nested', 'b'], value: { c: 3 } },
    ]);

    // Mutating original should not mutate patch values
    (ctx as any).nested.b.c = 99;
    expect(patch[1]).toEqual({
      op: 'set',
      path: ['nested', 'b'],
      value: { c: 3 },
    });
  });

  it('tracks delete operations', () => {
    const base = { a: 1, b: { c: 2 } };
    const tracker = new MutableContext(base);

    tracker.mutate((ctx) => {
      delete (ctx as any).a;
      delete (ctx as any).b.c;
    });

    expect(tracker.getPatch()).toEqual([
      { op: 'delete', path: ['a'] },
      { op: 'delete', path: ['b', 'c'] },
    ]);
  });

  it('applyContextPatch applies sets and deletes', () => {
    const target = { a: 1, b: { c: 2 } };
    const patch: ContextPatch = [
      { op: 'set', path: ['a'], value: 10 },
      { op: 'set', path: ['b', 'd'], value: 4 },
      { op: 'delete', path: ['b', 'c'] },
    ];

    applyContextPatch(target, patch);

    expect(target).toEqual({
      a: 10,
      b: {
        d: 4,
      },
    });
  });

  it('creates intermediate objects/arrays when setting', () => {
    const target: any = {};
    applyContextPatch(target, [
      { op: 'set', path: ['arr', '0', 'x'], value: 1 },
      { op: 'set', path: ['obj', 'y'], value: 2 },
    ]);

    expect(target).toEqual({ arr: [{ x: 1 }], obj: { y: 2 } });
  });

  it('builds from an existing patch and continues tracking new changes', () => {
    const base = { a: 1, nested: { b: 2 } };
    const initialPatch: ContextPatch = [
      { op: 'set', path: ['a'], value: 3 },
      { op: 'delete', path: ['nested', 'b'] },
      { op: 'set', path: ['nested', 'c'], value: { d: 4 } },
    ];

    const tracker = MutableContext.fromPatch(base, initialPatch);
    const ctx = tracker.getContext();

    expect(base).toEqual({ a: 3, nested: { c: { d: 4 } } });

    tracker.mutate((draft) => {
      (draft as any).extra = true;
      (draft as any).nested.c.d = 5;
    });

    expect(tracker.getPatch()).toEqual([
      { op: 'set', path: ['a'], value: 3 },
      { op: 'delete', path: ['nested', 'b'] },
      { op: 'set', path: ['nested', 'c'], value: { d: 4 } },
      { op: 'set', path: ['extra'], value: true },
      { op: 'set', path: ['nested', 'c', 'd'], value: 5 },
    ]);

    // Mutating context should not mutate stored patch values
    (ctx as any).nested.c.d = 42;
    expect(tracker.getPatch()[2]).toEqual({
      op: 'set',
      path: ['nested', 'c'],
      value: { d: 4 },
    });
  });

  it('handles mutate setting a field to undefined and preserves patch replay', () => {
    const base = { a: 1, nested: { b: 2 } };
    const tracker = MutableContext.fromPatch(base, []);

    tracker.mutate((draft: any) => {
      draft.a = undefined;
      draft.nested.b = undefined;
    });

    expect(tracker.getPatch()).toEqual([
      { op: 'set', path: ['a'], value: undefined },
      { op: 'set', path: ['nested', 'b'], value: undefined },
    ]);

    const replayTarget = { a: 1, nested: { b: 2 } };
    MutableContext.fromPatch(replayTarget, tracker.getPatch());
    expect(replayTarget).toEqual({ a: undefined, nested: { b: undefined } });
  });
});
