import { cloneDeep } from 'lodash';

type Primitive = string | number | boolean | null | undefined;
type PathSegment = string;

type Change =
  | { op: 'set'; path: PathSegment[]; value?: unknown }
  | { op: 'delete'; path: PathSegment[] };

export type ContextPatch = Change[];
export type MutableContextHandle<T extends object> = MutableContext<T>;
type MutableDraft<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
    ? Array<MutableDraft<U>>
    : { -readonly [K in keyof T]: MutableDraft<T[K]> };

/**
 * Track mutations against a base object and emit a patch of changed paths.
 * Uses a Proxy to capture set/delete operations while allowing normal reads.
 */
export class MutableContext<T extends object> {
  private readonly changes: ContextPatch = [];
  private readonly proxy: T;

  constructor(
    private readonly target: T,
    initialPatch: ContextPatch = [],
  ) {
    this.proxy = this.createProxy(target, []);
    this.seedInitialPatch(initialPatch);
    return new Proxy(this as unknown as T, {
      get: (_obj, prop) => {
        if (prop === 'getContext') return this.getContext.bind(this);
        if (prop === 'mutate') return this.mutate.bind(this);
        if (prop === 'getPatch') return this.getPatch.bind(this);
        return (this.proxy as any)[prop];
      },
      set: (_obj, prop, value) => {
        (this.proxy as any)[prop] = value;
        return true;
      },
      deleteProperty: (_obj, prop) => {
        delete (this.proxy as any)[prop];
        return true;
      },
    }) as unknown as MutableContext<T>;
  }

  static fromPatch<T extends object>(
    target: T,
    patch: ContextPatch = [],
  ): MutableContext<T> {
    const safePatch = patch ?? [];
    applyContextPatch(target, safePatch);
    return new MutableContext(target, safePatch);
  }

  /**
   * Return the proxied context. Mutations on this object are recorded.
   */
  getContext(): Readonly<T> {
    return this.proxy;
  }

  /**
   * Allow controlled mutations while keeping the handle type distinct from the context type.
   */
  mutate(updater: (draft: MutableDraft<T>) => void): void {
    updater(this.proxy as MutableDraft<T>);
  }

  getPatch(): ContextPatch {
    return this.changes.slice();
  }

  private createProxy(target: any, path: PathSegment[]): any {
    const handler: ProxyHandler<any> = {
      get: (obj, prop) => {
        const value = obj[prop as keyof typeof obj];
        if (this.isTrackable(value)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return this.createProxy(value, path.concat(prop as PathSegment));
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return value;
      },
      set: (obj, prop, value) => {
        obj[prop as keyof typeof obj] = value;
        this.recordSet(path.concat(prop as PathSegment), value);
        return true;
      },
      deleteProperty: (obj, prop) => {
        if (prop in obj) {
          delete obj[prop as keyof typeof obj];
          this.recordDelete(path.concat(prop as PathSegment));
        }
        return true;
      },
    };

    return new Proxy(target, handler);
  }

  private isTrackable(value: unknown): value is object {
    if (value === null) return false;
    if (value instanceof Date) return false;
    if (Array.isArray(value)) return true;
    if (typeof value === 'object') return true;
    return false;
  }

  private recordSet(path: PathSegment[], value: unknown) {
    this.changes.push({ op: 'set', path, value: cloneDeep(value) });
  }

  private recordDelete(path: PathSegment[]) {
    this.changes.push({ op: 'delete', path });
  }

  private seedInitialPatch(patch: ContextPatch): void {
    for (const change of patch) {
      if (change.op === 'set') {
        this.changes.push({
          op: 'set',
          path: [...change.path],
          value: cloneDeep(change.value),
        });
      } else {
        this.changes.push({ op: 'delete', path: [...change.path] });
      }
    }
  }
}

export function applyContextPatch<T extends object>(
  target: T,
  patch?: ContextPatch,
): T {
  if (!patch || patch.length === 0) {
    return target;
  }
  for (const change of patch) {
    if (change.op === 'set') {
      setPath(target, change.path, cloneDeep(change.value));
    } else if (change.op === 'delete') {
      deletePath(target, change.path);
    }
  }
  return target;
}

function setPath(obj: any, path: PathSegment[], value: unknown): void {
  let cursor = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (segment === undefined) {
      return;
    }
    if (cursor[segment] === undefined) {
      cursor[segment] = isNumericPathSegment(path[i + 1]) ? [] : {};
    }
    cursor = cursor[segment];
  }
  const lastSegment = path[path.length - 1];
  if (lastSegment === undefined) {
    return;
  }
  cursor[lastSegment] = value;
}

function deletePath(obj: any, path: PathSegment[]): void {
  if (path.length === 0) return;
  let cursor = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (segment === undefined) return;
    if (cursor[segment] === undefined) return;
    cursor = cursor[segment];
  }
  const lastSegment = path[path.length - 1];
  if (lastSegment === undefined) return;
  delete cursor[lastSegment];
}

function isNumericPathSegment(segment: PathSegment | undefined): boolean {
  if (segment === undefined) return false;
  return segment !== '' && String(Number(segment)) === segment;
}

export function createMutableContextHandle<T extends object>(
  context: T,
): MutableContextHandle<T> {
  return new MutableContext(context) as MutableContextHandle<T>;
}
