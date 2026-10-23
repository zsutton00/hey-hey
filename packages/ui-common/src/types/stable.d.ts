/**
 * Branded type for memoized (stable) callbacks
 *
 * This module enforces that functions used in dependency arrays must be memoized.
 * Any function used in a dependency array should be wrapped with useCallback() to
 * receive the Stable<T> brand, preventing infinite re-renders from unstable references.
 *
 * If you need an escape hatch, use asStable() - but this makes the bypass explicit in code.
 */

/**
 * Nominal type brand for stable (memoized) callbacks
 *
 * A function is considered "Stable" if it's been memoized with useCallback or similar.
 * This prevents accidental use of unstable function references in dependency arrays.
 *
 * @example
 * // ✅ Good - function is memoized so it gets Stable brand from useCallback
 * const handleClick = useCallback(() => { ... }, [deps]);
 * // Type: Stable<() => void>
 *
 * @example
 * // ❌ Bad - inline function without memoization
 * <Component onChange={(val) => setVal(val)} />
 * // Type error: Type '(val: string) => void' not assignable to 'Stable<(val: string) => void>'
 */
export type Stable<T extends (...args: never[]) => unknown> = T & {
  readonly __stable: true;
};

/**
 * Module augmentation: override React's useCallback to return Stable<T>
 *
 * This ensures that useCallback always returns a function branded as Stable.
 * Anywhere you pass a callback to a dependency array, it must be Stable<T>.
 */
declare module "react" {
  // Overload for useCallback with explicit return type
  function useCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    deps: DependencyList
  ): Stable<T>;
}
