import { useCallback, useEffect, useRef } from "react";

interface UseActionGuardOptions {
  /** Cooldown in ms after action completes before allowing re-trigger. Default: 0 */
  cooldownMs?: number;
}

export function useActionGuard(options?: UseActionGuardOptions) {
  const cooldownMs = options?.cooldownMs ?? 0;
  const lockedKeysRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const releaseLock = useCallback(
    (key: string) => {
      if (!mountedRef.current) return;
      if (cooldownMs > 0) {
        const timer = setTimeout(() => {
          lockedKeysRef.current.delete(key);
          timersRef.current.delete(key);
        }, cooldownMs);
        timersRef.current.set(key, timer);
      } else {
        lockedKeysRef.current.delete(key);
      }
    },
    [cooldownMs]
  );

  const guard = useCallback(
    <TArgs extends unknown[]>(
      key: string,
      handler: (...args: TArgs) => void | Promise<void>
    ): ((...args: TArgs) => void) => {
      return (...args: TArgs) => {
        if (lockedKeysRef.current.has(key)) {
          return;
        }
        lockedKeysRef.current.add(key);

        try {
          const result = handler(...args);
          if (result instanceof Promise) {
            result.finally(() => releaseLock(key));
          } else {
            releaseLock(key);
          }
        } catch {
          releaseLock(key);
        }
      };
    },
    [releaseLock]
  );

  const isLocked = useCallback((key?: string): boolean => {
    if (key === undefined) {
      return lockedKeysRef.current.size > 0;
    }
    return lockedKeysRef.current.has(key);
  }, []);

  const release = useCallback((key?: string) => {
    if (key === undefined) {
      lockedKeysRef.current.clear();
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    } else {
      lockedKeysRef.current.delete(key);
      const timer = timersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(key);
      }
    }
  }, []);

  return { guard, isLocked, release };
}
