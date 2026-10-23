import type {
  WorkItemHtmlCssSizeBreakpoint,
  WorkItemTypeSectionDefinition,
} from "../api";
export type HtmlCssRenderingContext = "inline" | "page";
export interface ResolvedHtmlCssSize {
  profileKey: string;
  width: number;
  height: number;
}
interface SizeProfileSelection {
  sizeKey?: string;
}
export const resolveHtmlCssSize = (input: {
  definition: WorkItemTypeSectionDefinition;
  content: SizeProfileSelection;
  context: HtmlCssRenderingContext;
  containerWidth: number;
}): ResolvedHtmlCssSize | null => {
  const key = input.content.sizeKey ?? input.definition.defaultSizeKey;
  const profile = input.definition.sizeProfiles?.find(
    (candidate) => candidate.key === key
  );
  const breakpoint = profile?.breakpoints.reduce<
    WorkItemHtmlCssSizeBreakpoint | undefined
  >(
    (selected, candidate) =>
      candidate.minContainerWidth <= input.containerWidth &&
      (selected === undefined ||
        candidate.minContainerWidth > selected.minContainerWidth)
        ? candidate
        : selected,
    undefined
  );
  return profile && breakpoint
    ? { profileKey: profile.key, ...breakpoint[input.context] }
    : null;
};
