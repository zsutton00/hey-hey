import { createContext, useContext, useLayoutEffect } from "react";

export interface SuppressLayoutMainBottomSpacingOptions {
  /** Keep main as a scroll owner while suppressing the shell's bottom padding. */
  suppressMainScroll?: boolean;
}

export type SuppressLayoutMainBottomSpacing = (
  options?: SuppressLayoutMainBottomSpacingOptions,
) => () => void;

export const LayoutMainBottomSpacingContext =
  createContext<SuppressLayoutMainBottomSpacing | null>(null);

export const useSuppressLayoutMainBottomSpacing = (
  shouldSuppress: boolean,
  options?: SuppressLayoutMainBottomSpacingOptions,
): void => {
  const suppressBottomSpacing = useContext(LayoutMainBottomSpacingContext);
  const suppressMainScroll = options?.suppressMainScroll ?? true;

  useLayoutEffect(() => {
    if (!shouldSuppress || !suppressBottomSpacing) {
      return;
    }

    return suppressBottomSpacing({ suppressMainScroll });
  }, [shouldSuppress, suppressBottomSpacing, suppressMainScroll]);
};
