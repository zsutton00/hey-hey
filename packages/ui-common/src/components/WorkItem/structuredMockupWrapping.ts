import type {
  StructuredMockupPuckComponent,
  StructuredMockupPuckData,
} from "../shared/structuredMockupPuck";

export type StructuredMockupWrapperDirection = "vertical" | "horizontal";

export interface StructuredMockupItemSelector {
  index: number;
  zone?: string;
}

type StructuredMockupWrapFailure =
  | "empty-selection"
  | "cross-parent-selection"
  | "missing-selection"
  | "non-contiguous-selection";

export type StructuredMockupWrapResult =
  | {
      ok: true;
      data: StructuredMockupPuckData;
      wrapperSelector: Required<StructuredMockupItemSelector>;
    }
  | { ok: false; reason: StructuredMockupWrapFailure };

const ROOT_ZONE = "root:default-zone";

const selectorZone = (selector: StructuredMockupItemSelector): string =>
  selector.zone ?? ROOT_ZONE;

const hasChildren = (
  component: StructuredMockupPuckComponent,
): component is Extract<
  StructuredMockupPuckComponent,
  { type: "row" | "column" | "slot" }
> =>
  component.type === "row" ||
  component.type === "column" ||
  component.type === "slot";

const findChildren = (
  components: StructuredMockupPuckComponent[],
  parentId: string,
  slotName: string,
): StructuredMockupPuckComponent[] | null => {
  for (const component of components) {
    if (
      component.props.id === parentId &&
      hasChildren(component) &&
      slotName === "children"
    ) {
      return component.props.children;
    }
    if (hasChildren(component)) {
      const nested = findChildren(component.props.children, parentId, slotName);
      if (nested) return nested;
    }
  }
  return null;
};

const replaceChildren = (
  components: StructuredMockupPuckComponent[],
  parentId: string,
  slotName: string,
  replacement: StructuredMockupPuckComponent[],
): StructuredMockupPuckComponent[] | null => {
  let replaced = false;
  const next = components.map((component): StructuredMockupPuckComponent => {
    if (component.type === "row") {
      if (component.props.id === parentId && slotName === "children") {
        replaced = true;
        return {
          ...component,
          props: { ...component.props, children: replacement },
        };
      }
      const nested = replaceChildren(
        component.props.children,
        parentId,
        slotName,
        replacement,
      );
      if (!nested) return component;
      replaced = true;
      return {
        ...component,
        props: { ...component.props, children: nested },
      };
    }
    if (component.type === "column") {
      if (component.props.id === parentId && slotName === "children") {
        replaced = true;
        return {
          ...component,
          props: { ...component.props, children: replacement },
        };
      }
      const nested = replaceChildren(
        component.props.children,
        parentId,
        slotName,
        replacement,
      );
      if (!nested) return component;
      replaced = true;
      return {
        ...component,
        props: { ...component.props, children: nested },
      };
    }
    if (component.type === "slot") {
      if (component.props.id === parentId && slotName === "children") {
        replaced = true;
        return {
          ...component,
          props: { ...component.props, children: replacement },
        };
      }
      const nested = replaceChildren(
        component.props.children,
        parentId,
        slotName,
        replacement,
      );
      if (!nested) return component;
      replaced = true;
      return {
        ...component,
        props: { ...component.props, children: nested },
      };
    }
    return component;
  });
  return replaced ? next : null;
};

const getSiblingList = (
  data: StructuredMockupPuckData,
  zone: string,
): StructuredMockupPuckComponent[] | null => {
  if (zone === ROOT_ZONE || zone.startsWith("root:")) return data.content;
  const separatorIndex = zone.indexOf(":");
  if (separatorIndex < 1) return null;
  const parentId = zone.slice(0, separatorIndex);
  const slotName = zone.slice(separatorIndex + 1);
  return findChildren(data.content, parentId, slotName);
};

const replaceSiblingList = (
  data: StructuredMockupPuckData,
  zone: string,
  replacement: StructuredMockupPuckComponent[],
): StructuredMockupPuckData | null => {
  if (zone === ROOT_ZONE || zone.startsWith("root:")) {
    return { ...data, content: replacement };
  }
  const separatorIndex = zone.indexOf(":");
  if (separatorIndex < 1) return null;
  const parentId = zone.slice(0, separatorIndex);
  const slotName = zone.slice(separatorIndex + 1);
  const content = replaceChildren(
    data.content,
    parentId,
    slotName,
    replacement,
  );
  return content ? { ...data, content } : null;
};

const createWrapper = (
  id: string,
  direction: StructuredMockupWrapperDirection,
  children: StructuredMockupPuckComponent[],
): StructuredMockupPuckComponent => {
  const componentType = direction === "vertical" ? "column" : "row";
  return {
    type: componentType,
    props: {
      id,
      widthMode: "fit",
      widthValue: 240,
      heightMode: "content",
      heightValue: 80,
      direction: componentType,
      gap: 8,
      padding: 8,
      justify: "start",
      align: "stretch",
      surface: "plain",
      children,
    },
  };
};

export const wrapStructuredMockupSiblings = ({
  data,
  selectors,
  wrapperId,
  direction,
}: {
  data: StructuredMockupPuckData;
  selectors: readonly StructuredMockupItemSelector[];
  wrapperId: string;
  direction: StructuredMockupWrapperDirection;
}): StructuredMockupWrapResult => {
  if (selectors.length === 0) return { ok: false, reason: "empty-selection" };
  const zone = selectorZone(selectors[0]);
  if (selectors.some((selector) => selectorZone(selector) !== zone)) {
    return { ok: false, reason: "cross-parent-selection" };
  }
  const siblings = getSiblingList(data, zone);
  const indexes = [
    ...new Set(selectors.map((selector) => selector.index)),
  ].sort((left, right) => left - right);
  if (
    !siblings ||
    indexes.length !== selectors.length ||
    indexes.some((index) => index < 0 || index >= siblings.length)
  ) {
    return { ok: false, reason: "missing-selection" };
  }
  const firstIndex = indexes[0];
  const lastIndex = indexes[indexes.length - 1];
  if (lastIndex - firstIndex + 1 !== indexes.length) {
    return { ok: false, reason: "non-contiguous-selection" };
  }
  const children = siblings.slice(firstIndex, lastIndex + 1);
  const wrapper = createWrapper(wrapperId, direction, children);
  const replacement = [
    ...siblings.slice(0, firstIndex),
    wrapper,
    ...siblings.slice(lastIndex + 1),
  ];
  const nextData = replaceSiblingList(data, zone, replacement);
  if (!nextData) return { ok: false, reason: "missing-selection" };
  return {
    ok: true,
    data: nextData,
    wrapperSelector: { index: firstIndex, zone },
  };
};
