import { useCallback, useRef } from "react";
import type { DependencyList } from "react";
import type { Stable } from "../../types";

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) {
      return false;
    }
    for (const [key, value] of a.entries()) {
      if (!b.has(key)) {
        return false;
      }
      if (!deepEqual(value, b.get(key))) {
        return false;
      }
    }
    return true;
  }

  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) {
      return false;
    }
    for (const value of a.values()) {
      if (!b.has(value)) {
        return false;
      }
    }
    return true;
  }

  if (a && b && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);

    if (aKeys.length !== bKeys.length) {
      return false;
    }

    return aKeys.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }

  return false;
};

/**
 * A version of useCallback that performs deep equality comparison on dependencies
 * instead of referential equality. Useful when dependencies are objects or arrays
 * that might be recreated but have the same content.
 *
 * Returns a stable (memoized) callback, so it can be safely used in dependency arrays.
 */
export function useDeepCompareCallback<T extends (...args: never[]) => unknown>(
  callback: T,
  dependencies: DependencyList
): Stable<T> {
  const dependencyRef = useRef<DependencyList>(dependencies);
  const callbackRef = useRef(callback);

  if (!deepEqual(dependencies, dependencyRef.current)) {
    dependencyRef.current = dependencies;
  }

  if (callbackRef.current !== callback) {
    callbackRef.current = callback;
  }

  return useCallback(
    callbackRef.current as T,
    // Dependency array is managed via deep comparison above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    dependencyRef.current
  );
}
