/**
 * Stable callback type support for ui
 *
 * Imports the Stable<T> brand from ui-common and re-applies the React module
 * augmentation so that ui's type checker enforces stable callbacks in dependency arrays.
 */

import type { Stable } from "@hey-hey/ui-common";

// Re-export Stable type for local use
export type { Stable };

/**
 * Module augmentation: override React's useCallback to return Stable<T>
 *
 * Same augmentation as ui-common - ensures useCallback always returns Stable<T>
 * and enforces that callbacks in dependency arrays must be memoized.
 */
declare module "react" {
  function useCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    deps: DependencyList
  ): Stable<T>;
}
