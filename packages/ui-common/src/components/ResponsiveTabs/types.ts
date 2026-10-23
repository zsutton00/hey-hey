import type { Options } from "nuqs";

export type ResponsiveTabOverflow = "scroll" | "menu";

export interface ResponsiveTab {
  value: string;
  label: string;
}

export interface ResponsiveTabsProps<T extends string = string> {
  value: T;
  onChange: (
    value: T | ((old: T) => T | null) | null,
    options?: Options
  ) => void | Promise<URLSearchParams>;
  tabs: ResponsiveTab[];
  overflow?: ResponsiveTabOverflow;
}
