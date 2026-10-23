import type { BreadcrumbItem } from "../../utils/breadcrumbs";

export type DesktopBreadcrumbEntry =
  | { kind: "item"; item: BreadcrumbItem; index: number }
  | { kind: "collapsed"; items: BreadcrumbItem[]; index: number };

export function collapseFeatureAncestors(
  items: BreadcrumbItem[]
): DesktopBreadcrumbEntry[] {
  const entries: DesktopBreadcrumbEntry[] = [];
  let index = 0;
  while (index < items.length) {
    const start = index;
    while (
      index < items.length - 1 &&
      items[index].kind === "feature" &&
      !items[index].isCurrent
    ) {
      index += 1;
    }
    const count = index - start;
    if (count > 2) {
      entries.push(
        { kind: "item", item: items[start], index: start },
        {
          kind: "collapsed",
          items: items.slice(start + 1, index - 1),
          index: start + 1,
        },
        { kind: "item", item: items[index - 1], index: index - 1 }
      );
    } else {
      for (let position = start; position < index; position += 1) {
        entries.push({ kind: "item", item: items[position], index: position });
      }
    }
    if (count === 0) {
      entries.push({ kind: "item", item: items[index], index });
      index += 1;
    }
  }
  return entries;
}
