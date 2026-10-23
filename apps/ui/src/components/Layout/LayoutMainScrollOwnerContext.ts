import type { ResponsiveStyleValue } from "@mui/system";
import { createContext, useContext, type RefObject } from "react";

export interface LayoutMainScrollOwner {
  mainContentRef: RefObject<HTMLElement | null>;
  taskContextStickyTop: ResponsiveStyleValue<number | string>;
}

export const LayoutMainScrollOwnerContext =
  createContext<LayoutMainScrollOwner | null>(null);

export const useLayoutMainScrollOwner = (): LayoutMainScrollOwner | null =>
  useContext(LayoutMainScrollOwnerContext);
