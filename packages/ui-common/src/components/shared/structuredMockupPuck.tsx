import type { Config, Data, Slot } from "@puckeditor/core";
import { Render } from "@puckeditor/core";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { Box, Button, Paper, TextField, Typography } from "@mui/material";
import isEqual from "lodash/isEqual.js";
import React from "react";
import { ThemeProvider } from "@mui/material/styles";
import { structuredMockupTheme } from "./structuredMockupTheme";
import { EntityIcon } from "../Entity";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { decodeStructuredMockupSectionContent } from "../../utils/workItemSections";
import type {
  WorkItemStructuredMockupComponent,
  WorkItemStructuredMockupHeight,
  WorkItemStructuredMockupWidth,
  WorkItemStructuredMockupTextProps,
  WorkItemStructuredMockupInputProps,
  WorkItemStructuredMockupContainerProps,
  WorkItemStructuredMockupCaretDirection,
  WorkItemStructuredMockupColor,
  WorkItemStructuredMockupDividerOrientation,
  WorkItemStructuredMockupShapeKind,
  WorkItemStructuredMockupV5AppearanceProps,
} from "../../api";
import type {
  NormalizedWorkItemStructuredMockupDocument,
  WorkItemStructuredMockupComponentV4,
  WorkItemStructuredMockupComponentV5,
} from "../../utils/workItemSections";
import {
  getStructuredMockupIcon,
  isStructuredMockupIconKey,
} from "../../utils/entityIcons";
type WorkItemStructuredMockupSlotProps = Extract<
  WorkItemStructuredMockupComponentV4,
  { type: "slot" }
>["props"];

interface ReferencedMockupContextValue {
  organizationId?: string;
  projectId?: string;
  ancestors: ReadonlySet<string>;
}
export const ReferencedMockupContext =
  React.createContext<ReferencedMockupContextValue>({ ancestors: new Set() });

const ReferencedMockupOccurrence: React.FC<
  OccurrenceEditorProps & { id: string }
> = ({ sourceMockupId, slotAssignmentsJson, ...layout }) => {
  const context = React.useContext(ReferencedMockupContext);
  const cyclic = context.ancestors.has(sourceMockupId);
  const source = useWorkItem(
    context.organizationId ?? "",
    "task",
    sourceMockupId,
    {
      projectId: context.projectId,
      enabled: !cyclic && Boolean(context.organizationId && context.projectId),
    }
  );
  const registry = useWorkItemTypeByKey(
    context.organizationId,
    context.projectId,
    source.workItem?.type
  );
  const definition = registry.workItemTypeDefinition;
  const sectionDefinition = definition?.sections.find(
    (section) => section.kind === "structured-mockup"
  );
  const section = sectionDefinition
    ? source.workItem?.sections?.find(
        (candidate) => candidate.key === sectionDefinition.key
      )
    : undefined;
  const document = section
    ? decodeStructuredMockupSectionContent(section.materializedMarkdown)
    : null;
  if (
    cyclic ||
    source.error ||
    (source.isFetched &&
      (!source.workItem ||
        source.workItem.type !== "mockups_v3" ||
        !registry.isReady ||
        !sectionDefinition ||
        !document))
  ) {
    return (
      <Paper
        role="alert"
        {...structuredMockupMetadataAttributes(layout)}
        variant="outlined"
        sx={{ ...layoutStyle(layout), p: 1.5, borderStyle: "dashed" }}
      >
        Referenced mockup unavailable
      </Paper>
    );
  }
  if (!document)
    return (
      <Paper
        aria-busy="true"
        {...structuredMockupMetadataAttributes(layout)}
        variant="outlined"
        sx={{ ...layoutStyle(layout), p: 1.5 }}
      >
        Loading reusable mockup…
      </Paper>
    );
  const slotAssignments = JSON.parse(slotAssignmentsJson) as Array<{
    slotName: string;
    children: StructuredMockupPuckComponent[];
  }>;
  const assigned = new Map(
    slotAssignments.map((assignment) => [
      assignment.slotName,
      assignment.children,
    ])
  );
  const applyAssignments = (
    components: StructuredMockupPuckComponent[]
  ): StructuredMockupPuckComponent[] =>
    components.flatMap((component) =>
      component.type === "slot"
        ? assigned.get(component.props.name) ?? []
        : component.type === "row" || component.type === "column"
        ? [
            {
              ...component,
              props: {
                ...component.props,
                children: applyAssignments(component.props.children),
              },
            },
          ]
        : [component]
    );
  return (
    <ReferencedMockupContext.Provider
      value={{
        ...context,
        ancestors: new Set([...context.ancestors, sourceMockupId]),
      }}
    >
      <Box
        data-structured-mockup-component-id={layout.id}
        data-structured-mockup-source-id={sourceMockupId}
        {...structuredMockupMetadataAttributes(layout)}
        role={layout.role}
        sx={layoutStyle(layout)}
      >
        <Render
          config={structuredMockupPuckConfig}
          data={{
            content: applyAssignments(
              structuredMockupDocumentToPuckData(document).content
            ),
            root: {},
          }}
        />
      </Box>
    </ReferencedMockupContext.Provider>
  );
};

export type StructuredMockupWidthMode = "fit" | "fill" | "fixed";
export type StructuredMockupHeightMode = "content" | "fixed";
export type StructuredMockupJustification =
  | "start"
  | "center"
  | "end"
  | "spread";
export type StructuredMockupAlignment = "start" | "center" | "end" | "stretch";
export type StructuredMockupDirection = "row" | "column";

export type StructuredMockupAppearanceProps =
  WorkItemStructuredMockupV5AppearanceProps;

export interface StructuredMockupLayoutProps
  extends StructuredMockupAppearanceProps {
  widthMode: StructuredMockupWidthMode;
  widthValue: number;
  heightMode: StructuredMockupHeightMode;
  heightValue: number;
}

export interface EffectiveStructuredMockupLayout {
  width: { mode: StructuredMockupWidthMode; value?: number };
  height: { mode: StructuredMockupHeightMode; value?: number };
  style: React.CSSProperties;
}

export interface EffectiveStructuredMockupContainerLayout {
  direction: StructuredMockupDirection;
  justification: StructuredMockupJustification;
  alignment: StructuredMockupAlignment;
  padding: number;
  gap: number;
  justifyContent: React.CSSProperties["justifyContent"];
  alignItems: React.CSSProperties["alignItems"];
}

export const normalizeStructuredMockupDimension = (value: number): number =>
  Math.max(1, Math.round(value));

export const resolveStructuredMockupLayout = (
  props: StructuredMockupLayoutProps
): EffectiveStructuredMockupLayout => {
  const widthValue = normalizeStructuredMockupDimension(props.widthValue);
  const heightValue = normalizeStructuredMockupDimension(props.heightValue);
  return {
    width:
      props.widthMode === "fixed"
        ? { mode: "fixed", value: widthValue }
        : { mode: props.widthMode },
    height:
      props.heightMode === "fixed"
        ? { mode: "fixed", value: heightValue }
        : { mode: "content" },
    style: {
      width:
        props.widthMode === "fill"
          ? "100%"
          : props.widthMode === "fixed"
          ? widthValue
          : "fit-content",
      height: props.heightMode === "fixed" ? heightValue : "auto",
      maxWidth: props.widthMode === "fixed" ? "none" : "100%",
      minWidth: 0,
      flexGrow: props.widthMode === "fill" ? 1 : 0,
      flexShrink: props.widthMode === "fixed" ? 0 : 1,
      alignSelf: props.widthMode === "fill" ? "stretch" : undefined,
      boxSizing: "border-box",
      color: resolveStructuredMockupColor(props.color),
      opacity: props.opacity,
      overflow: props.overflow,
      position:
        props.role !== undefined || props.description !== undefined
          ? "relative"
          : undefined,
    },
  };
};

const STRUCTURED_MOCKUP_COLORS: Readonly<
  Record<WorkItemStructuredMockupColor, string>
> = {
  primary: structuredMockupTheme.palette.primary.main,
  secondary: structuredMockupTheme.palette.secondary.main,
  success: structuredMockupTheme.palette.success.main,
  warning: structuredMockupTheme.palette.warning.main,
  error: structuredMockupTheme.palette.error.main,
  info: structuredMockupTheme.palette.info.main,
  neutral: structuredMockupTheme.palette.grey[600],
  muted: structuredMockupTheme.palette.text.secondary,
  surface: structuredMockupTheme.palette.background.paper,
  transparent: "transparent",
};

export const resolveStructuredMockupColor = (
  color: WorkItemStructuredMockupColor | undefined
): string | undefined => (color ? STRUCTURED_MOCKUP_COLORS[color] : undefined);

const structuredMockupMetadataAttributes = (
  props: Pick<StructuredMockupLayoutProps, "role" | "description">
): Record<string, string> =>
  props.role !== undefined || props.description !== undefined
    ? {
        "data-testid": "structured-mockup-semantic-metadata-indicator",
        "data-structured-mockup-semantic-metadata": "present",
      }
    : {};

interface TextEditorProps extends StructuredMockupLayoutProps {
  text: string;
  variant?: WorkItemStructuredMockupTextProps["variant"];
}

interface ButtonEditorProps extends StructuredMockupLayoutProps {
  label: string;
}

interface InputEditorProps extends StructuredMockupLayoutProps {
  label: string;
  placeholder: string;
  value: string;
  multiline?: WorkItemStructuredMockupInputProps["multiline"];
}

interface SurfaceEditorProps extends StructuredMockupLayoutProps {
  label: string;
}

interface ImagePlaceholderEditorProps extends StructuredMockupLayoutProps {
  altText: string;
}
interface IconEditorProps extends StructuredMockupLayoutProps {
  iconKey: string;
  accessibleLabel: string;
}
interface CaretEditorProps extends StructuredMockupLayoutProps {
  direction: WorkItemStructuredMockupCaretDirection;
}
interface ShapeEditorProps extends StructuredMockupLayoutProps {
  kind: WorkItemStructuredMockupShapeKind;
}
interface DividerEditorProps extends StructuredMockupLayoutProps {
  orientation?: WorkItemStructuredMockupDividerOrientation;
}
interface SlotEditorProps extends StructuredMockupLayoutProps {
  name: string;
  surface?: WorkItemStructuredMockupSlotProps["surface"];
  children: Slot<StructuredMockupPuckProps>;
}
interface OccurrenceEditorProps extends StructuredMockupLayoutProps {
  sourceMockupId: string;
  slotAssignmentsJson: string;
}

export interface StructuredMockupContainerEditorProps
  extends StructuredMockupLayoutProps {
  surface?: WorkItemStructuredMockupContainerProps["surface"];
  direction: StructuredMockupDirection;
  gap: number;
  padding: number;
  justify: StructuredMockupJustification;
  align: StructuredMockupAlignment;
  children: Slot<StructuredMockupPuckProps>;
}

export type StructuredMockupPuckProps = {
  text: TextEditorProps;
  button: ButtonEditorProps;
  input: InputEditorProps;
  card: SurfaceEditorProps;
  rectangle: SurfaceEditorProps;
  "image-placeholder": ImagePlaceholderEditorProps;
  divider: DividerEditorProps;
  row: StructuredMockupContainerEditorProps;
  column: StructuredMockupContainerEditorProps;
  icon: IconEditorProps;
  caret: CaretEditorProps;
  shape: ShapeEditorProps;
  slot: SlotEditorProps;
  "mockup-occurrence": OccurrenceEditorProps;
};

export interface StructuredMockupPuckRoot {
  sizeKey?: string;
}

export type StructuredMockupPuckData = Data<
  StructuredMockupPuckProps,
  StructuredMockupPuckRoot
>;
export type StructuredMockupPuckComponent =
  StructuredMockupPuckData["content"][number];

export interface StructuredMockupPuckMetadata {
  sourceMockupId?: string;
}

const WIDTH_OPTIONS = [
  { label: "Fit content", value: "fit" },
  { label: "Fill container", value: "fill" },
  { label: "Fixed", value: "fixed" },
] as const;
const HEIGHT_OPTIONS = [
  { label: "Fit content", value: "content" },
  { label: "Fixed", value: "fixed" },
] as const;
const JUSTIFY_OPTIONS = [
  { label: "Start", value: "start" },
  { label: "Center", value: "center" },
  { label: "End", value: "end" },
  { label: "Spread", value: "spread" },
] as const;
const ALIGN_OPTIONS = [
  { label: "Start", value: "start" },
  { label: "Center", value: "center" },
  { label: "End", value: "end" },
  { label: "Stretch", value: "stretch" },
] as const;
const DIRECTION_OPTIONS = [
  { label: "Vertical", value: "column" },
  { label: "Horizontal", value: "row" },
] as const;

const layoutFields = {
  widthMode: { type: "select", label: "Width mode", options: WIDTH_OPTIONS },
  widthValue: { type: "number", label: "Width", min: 1 },
  heightMode: { type: "select", label: "Height mode", options: HEIGHT_OPTIONS },
  heightValue: { type: "number", label: "Height", min: 1 },
  description: { type: "textarea", label: "Agent description" },
  color: {
    type: "select",
    label: "Color",
    options: Object.keys(STRUCTURED_MOCKUP_COLORS).map((value) => ({
      label: value,
      value,
    })),
  },
  opacity: { type: "number", label: "Opacity", min: 0, max: 1 },
  overflow: {
    type: "select",
    label: "Overflow",
    options: ["visible", "hidden"].map((value) => ({
      label: value,
      value,
    })),
  },
} as const;

const layoutStyle = (props: StructuredMockupLayoutProps): React.CSSProperties =>
  resolveStructuredMockupLayout(props).style;

const defaultLayoutProps: StructuredMockupLayoutProps = {
  widthMode: "fit",
  widthValue: 240,
  heightMode: "content",
  heightValue: 80,
};

const hasStructuredMockupAppearanceProps = (props: object): boolean =>
  ["role", "description", "color", "opacity", "overflow"].some(
    (key) => key in props
  );

const appearanceFromPuckProps = (
  props: object
): StructuredMockupAppearanceProps => {
  if (!hasStructuredMockupAppearanceProps(props)) return {};
  const appearanceProps = props as StructuredMockupAppearanceProps;
  return {
    ...(appearanceProps.role !== undefined
      ? { role: appearanceProps.role }
      : {}),
    ...(appearanceProps.description !== undefined &&
    appearanceProps.description.length > 0
      ? { description: appearanceProps.description }
      : {}),
    ...(appearanceProps.color !== undefined
      ? { color: appearanceProps.color }
      : {}),
    ...(appearanceProps.opacity !== undefined
      ? { opacity: appearanceProps.opacity }
      : {}),
    ...(appearanceProps.overflow !== undefined
      ? { overflow: appearanceProps.overflow }
      : {}),
  };
};

const justifyContent = (
  justify: StructuredMockupJustification
): React.CSSProperties["justifyContent"] =>
  justify === "spread"
    ? "space-between"
    : justify === "start"
    ? "flex-start"
    : justify === "end"
    ? "flex-end"
    : "center";

const alignItems = (
  align: StructuredMockupAlignment
): React.CSSProperties["alignItems"] =>
  align === "start" ? "flex-start" : align === "end" ? "flex-end" : align;

export const resolveStructuredMockupContainerLayout = (
  props: Pick<
    StructuredMockupContainerEditorProps,
    "direction" | "justify" | "align" | "padding" | "gap"
  >
): EffectiveStructuredMockupContainerLayout => ({
  direction: props.direction,
  justification: props.justify,
  alignment: props.align,
  padding: Math.max(0, Math.round(props.padding)),
  gap: Math.max(0, Math.round(props.gap)),
  justifyContent: justifyContent(props.justify),
  alignItems: alignItems(props.align),
});

export const structuredMockupComponentToPuck = (
  component:
    | WorkItemStructuredMockupComponentV4
    | WorkItemStructuredMockupComponentV5
): StructuredMockupPuckComponent => {
  const layout = {
    id: component.props.id,
    widthMode: component.props.width.mode,
    widthValue:
      component.props.width.mode === "fixed"
        ? component.props.width.value
        : 240,
    heightMode: component.props.height.mode,
    heightValue:
      component.props.height.mode === "fixed"
        ? component.props.height.value
        : 80,
    ...appearanceFromPuckProps(component.props),
  };
  switch (component.type) {
    case "text":
      return {
        type: "text",
        props: {
          ...layout,
          text: component.props.text,
          ...(component.props.variant
            ? { variant: component.props.variant }
            : {}),
        },
      };
    case "button":
      return {
        type: "button",
        props: { ...layout, label: component.props.label },
      };
    case "input":
      return {
        type: "input",
        props: {
          ...layout,
          label: component.props.label,
          placeholder: component.props.placeholder,
          value: component.props.value ?? "",
          ...(component.props.multiline !== undefined
            ? { multiline: component.props.multiline }
            : {}),
        },
      };
    case "card":
    case "rectangle":
      return {
        type: component.type,
        props: { ...layout, label: component.props.label ?? "" },
      };
    case "image-placeholder":
      return {
        type: "image-placeholder",
        props: { ...layout, altText: component.props.altText },
      };
    case "divider":
      return {
        type: "divider",
        props: {
          ...layout,
          ...("orientation" in component.props &&
          component.props.orientation !== undefined
            ? { orientation: component.props.orientation }
            : {}),
        },
      };
    case "icon":
      return {
        type: "icon",
        props: {
          ...layout,
          iconKey: component.props.iconKey,
          accessibleLabel: component.props.accessibleLabel,
        },
      };
    case "caret":
      return {
        type: "caret",
        props: { ...layout, direction: component.props.direction },
      };
    case "shape":
      return {
        type: "shape",
        props: { ...layout, kind: component.props.kind },
      };
    case "slot":
      return {
        type: "slot",
        props: {
          ...layout,
          name: component.props.name,
          ...(component.props.surface
            ? { surface: component.props.surface }
            : {}),
          children: [],
        },
      };
    case "mockup-occurrence":
      return {
        type: "mockup-occurrence",
        props: {
          ...layout,
          sourceMockupId: component.props.sourceMockupId,
          slotAssignmentsJson: JSON.stringify(
            component.props.slotAssignments.map((assignment) => ({
              slotName: assignment.slotName,
              children: assignment.children.map(
                structuredMockupComponentToPuck
              ),
            }))
          ),
        },
      };
    case "row":
    case "column":
      return {
        type: component.type,
        props: {
          ...layout,
          gap: component.props.gap,
          padding: component.props.padding,
          justify: component.props.justify,
          align: component.props.align,
          ...(component.props.surface
            ? { surface: component.props.surface }
            : {}),
          direction: component.type,
          children: component.children.map(structuredMockupComponentToPuck),
        },
      };
  }
};

const widthFromPuck = (
  props: StructuredMockupLayoutProps
): WorkItemStructuredMockupWidth =>
  props.widthMode === "fixed"
    ? {
        mode: "fixed",
        value: normalizeStructuredMockupDimension(props.widthValue),
      }
    : { mode: props.widthMode };

const heightFromPuck = (
  props: StructuredMockupLayoutProps
): WorkItemStructuredMockupHeight =>
  props.heightMode === "fixed"
    ? {
        mode: "fixed",
        value: normalizeStructuredMockupDimension(props.heightValue),
      }
    : { mode: "content" };

const puckComponentNeedsV5 = (
  component: StructuredMockupPuckComponent
): boolean => {
  if (
    component.type === "caret" ||
    component.type === "shape" ||
    (component.type === "divider" &&
      component.props.orientation !== undefined) ||
    hasStructuredMockupAppearanceProps(component.props)
  ) {
    return true;
  }
  if (component.type === "row" || component.type === "column") {
    return component.props.children.some(puckComponentNeedsV5);
  }
  if (component.type === "mockup-occurrence") {
    try {
      const assignments = JSON.parse(
        component.props.slotAssignmentsJson
      ) as Array<{
        children?: StructuredMockupPuckComponent[];
      }>;
      return assignments.some((assignment) =>
        assignment.children?.some(puckComponentNeedsV5)
      );
    } catch {
      return false;
    }
  }
  return false;
};

const componentFromPuck = (
  component: StructuredMockupPuckComponent,
  forceV5 = false
):
  | WorkItemStructuredMockupComponentV4
  | WorkItemStructuredMockupComponentV5 => {
  const layout = {
    id: component.props.id,
    width: widthFromPuck(component.props),
    height: heightFromPuck(component.props),
  };
  const appearance = appearanceFromPuckProps(component.props);
  const useV5 = forceV5 || puckComponentNeedsV5(component);
  switch (component.type) {
    case "text":
      return {
        type: "text",
        props: {
          ...layout,
          ...appearance,
          text: component.props.text,
          ...(component.props.variant
            ? { variant: component.props.variant }
            : {}),
        },
      };
    case "button":
      return {
        type: "button",
        props: { ...layout, ...appearance, label: component.props.label },
      };
    case "input":
      return {
        type: "input",
        props: {
          ...layout,
          ...appearance,
          label: component.props.label,
          placeholder: component.props.placeholder,
          ...(component.props.value ? { value: component.props.value } : {}),
          ...(component.props.multiline !== undefined
            ? { multiline: component.props.multiline }
            : {}),
        },
      };
    case "card":
    case "rectangle":
      return {
        type: component.type,
        props: {
          ...layout,
          ...appearance,
          ...(component.props.label ? { label: component.props.label } : {}),
        },
      };
    case "image-placeholder":
      return {
        type: "image-placeholder",
        props: { ...layout, ...appearance, altText: component.props.altText },
      };
    case "divider":
      return {
        type: "divider",
        props: {
          ...layout,
          ...appearance,
          ...(useV5
            ? { orientation: component.props.orientation ?? "horizontal" }
            : {}),
        },
      };
    case "icon":
      return {
        type: "icon",
        props: {
          ...layout,
          ...appearance,
          iconKey:
            useV5 && !isStructuredMockupIconKey(component.props.iconKey)
              ? "star"
              : component.props.iconKey,
          accessibleLabel: component.props.accessibleLabel,
        },
      };
    case "slot":
      return {
        type: "slot",
        props: {
          ...layout,
          ...appearance,
          name: component.props.name,
          ...(component.props.surface
            ? { surface: component.props.surface }
            : {}),
        },
      };
    case "mockup-occurrence": {
      const assignments = JSON.parse(
        component.props.slotAssignmentsJson
      ) as Array<{
        slotName: string;
        children: StructuredMockupPuckComponent[];
      }>;
      const slotAssignments = assignments.map((assignment) => ({
        slotName: assignment.slotName,
        children: assignment.children.map((child) =>
          componentFromPuck(child, useV5)
        ),
      }));
      if (!useV5) {
        return {
          type: "mockup-occurrence",
          props: {
            ...layout,
            sourceMockupId: component.props.sourceMockupId,
            slotAssignments: slotAssignments as unknown as Extract<
              WorkItemStructuredMockupComponentV4,
              { type: "mockup-occurrence" }
            >["props"]["slotAssignments"],
          },
        };
      }
      return {
        type: "mockup-occurrence",
        props: {
          ...layout,
          ...appearance,
          sourceMockupId: component.props.sourceMockupId,
          slotAssignments: slotAssignments as unknown as Extract<
            WorkItemStructuredMockupComponentV5,
            { type: "mockup-occurrence" }
          >["props"]["slotAssignments"],
        },
      };
    }
    case "caret":
      return {
        type: "caret",
        props: {
          ...layout,
          ...appearance,
          direction: component.props.direction,
        },
      };
    case "shape":
      return {
        type: "shape",
        props: {
          ...layout,
          ...appearance,
          kind: component.props.kind,
        },
      };
    case "row":
    case "column": {
      const children = component.props.children.map((child) =>
        componentFromPuck(child, useV5)
      );
      return {
        type: component.props.direction,
        props: {
          ...layout,
          ...appearance,
          gap: Math.max(0, Math.round(component.props.gap)),
          padding: Math.max(0, Math.round(component.props.padding)),
          justify: component.props.justify,
          align: component.props.align,
          ...(component.props.surface
            ? { surface: component.props.surface }
            : {}),
        },
        children: children as unknown as WorkItemStructuredMockupComponentV4[],
      };
    }
  }
};

export const structuredMockupDocumentToPuckData = (
  document: NormalizedWorkItemStructuredMockupDocument
): StructuredMockupPuckData => ({
  content: document.content.map((component) =>
    structuredMockupComponentToPuck(component)
  ),
  root: document.sizeKey ? { props: { sizeKey: document.sizeKey } } : {},
});

export const puckDataToStructuredMockupDocument = (
  data: StructuredMockupPuckData,
  document?: NormalizedWorkItemStructuredMockupDocument
): NormalizedWorkItemStructuredMockupDocument => {
  const content = data.content.map((component) => componentFromPuck(component));
  const compositionChanged = document
    ? !isEqual(content, document.content)
    : false;
  const hasCompositionComponents = (
    components: Array<
      WorkItemStructuredMockupComponentV4 | WorkItemStructuredMockupComponentV5
    >
  ): boolean =>
    components.some(
      (component) =>
        component.type === "slot" ||
        component.type === "icon" ||
        component.type === "mockup-occurrence" ||
        ((component.type === "row" || component.type === "column") &&
          hasCompositionComponents(component.children))
    );
  const hasV5Components = (
    components: Array<
      WorkItemStructuredMockupComponentV4 | WorkItemStructuredMockupComponentV5
    >
  ): boolean =>
    components.some((component) => {
      if (component.type === "caret" || component.type === "shape") {
        return true;
      }
      if (component.type === "divider" && "orientation" in component.props) {
        return true;
      }
      if (hasStructuredMockupAppearanceProps(component.props)) {
        return true;
      }
      if (component.type === "mockup-occurrence") {
        return component.props.slotAssignments.some((assignment) =>
          hasV5Components(assignment.children)
        );
      }
      return (
        (component.type === "row" || component.type === "column") &&
        hasV5Components(component.children)
      );
    });
  const schemaVersion =
    document?.schemaVersion === "work-item-structured-mockup.v5" ||
    hasV5Components(content)
      ? ("work-item-structured-mockup.v5" as const)
      : document?.schemaVersion === "work-item-structured-mockup.v4" ||
        hasCompositionComponents(content)
      ? ("work-item-structured-mockup.v4" as const)
      : ("work-item-structured-mockup.v3" as const);
  const sizeKey =
    data.root.props?.sizeKey ?? data.root.sizeKey ?? document?.sizeKey;
  const base = {
    revision: document ? document.revision + (compositionChanged ? 1 : 0) : 1,
    content,
    annotations: document?.annotations ?? [],
    ...(sizeKey ? { sizeKey } : {}),
  };
  return schemaVersion === "work-item-structured-mockup.v5"
    ? {
        ...base,
        schemaVersion,
        content: content as WorkItemStructuredMockupComponentV5[],
      }
    : schemaVersion === "work-item-structured-mockup.v4"
    ? {
        ...base,
        schemaVersion,
        content: content as WorkItemStructuredMockupComponentV4[],
      }
    : {
        ...base,
        schemaVersion,
        content: content as WorkItemStructuredMockupComponent[],
      };
};

const containerConfig = (
  label: string
): Config<StructuredMockupPuckProps>["components"]["row"] => ({
  label,
  fields: {
    ...layoutFields,
    direction: {
      type: "select",
      label: "Direction",
      options: DIRECTION_OPTIONS,
    },
    justify: {
      type: "select",
      label: "Justify",
      options: JUSTIFY_OPTIONS,
    },
    align: {
      type: "select",
      label: "Align",
      options: ALIGN_OPTIONS,
    },
    gap: { type: "number", label: "Spacing", min: 0 },
    padding: { type: "number", label: "Padding", min: 0 },
    surface: {
      type: "select",
      label: "Surface",
      options: ["plain", "panel", "muted", "dashed"].map((value) => ({
        label: value,
        value,
      })),
    },
    children: { type: "slot" },
  } as const,
  render: ({
    children: Children,
    direction,
    gap,
    padding,
    justify,
    align,
    surface = "plain",
    ...layout
  }) => {
    const containerLayout = resolveStructuredMockupContainerLayout({
      direction,
      justify,
      align,
      padding,
      gap,
    });
    return (
      <Children
        className={
          layout.widthMode === "fill" ? "structured-mockup-fill" : undefined
        }
        data-structured-mockup-component-id={layout.id}
        data-structured-mockup-width-mode={layout.widthMode}
        {...structuredMockupMetadataAttributes(layout)}
        collisionAxis={direction === "row" ? "x" : "y"}
        style={{
          ...layoutStyle(layout),
          display: "flex",
          flexDirection: containerLayout.direction,
          gap: containerLayout.gap,
          padding: containerLayout.padding,
          justifyContent: containerLayout.justifyContent,
          alignItems: containerLayout.alignItems,
          minHeight: 44,
          border:
            surface === "plain"
              ? undefined
              : surface === "dashed"
              ? "1px dashed #8c8272"
              : "1px solid #c7c0b2",
          backgroundColor: layout.color
            ? resolveStructuredMockupColor(layout.color)
            : surface === "panel" || surface === "dashed"
            ? "#fffdf8"
            : surface === "muted"
            ? "#eee9dd"
            : undefined,
          borderRadius: surface === "plain" ? 0 : 12,
        }}
      />
    );
  },
});

const textStyles = {
  body: { fontSize: 16 },
  heading: { fontSize: 25, fontWeight: 700, lineHeight: 1.25 },
  caption: { fontSize: 12, color: "text.secondary" },
  label: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  badge: {
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: 700,
    color: "primary.main",
    backgroundColor: "#e8e4f4",
    borderRadius: 20,
    px: 1.5,
    py: 0.75,
  },
} as const;

export const structuredMockupPuckConfig: Config<StructuredMockupPuckProps> = {
  root: {
    render: ({ children }) => (
      <ThemeProvider theme={structuredMockupTheme}>
        <Box
          sx={{
            width: "100%",
            minWidth: 0,
            boxSizing: "border-box",
            "& [data-puck-component]:has(> .structured-mockup-fill), & [data-puck-component]:has(> [data-structured-mockup-width-mode='fill'])":
              {
                width: "100%",
                minWidth: 0,
                flexGrow: 1,
                alignSelf: "stretch",
              },
            color: "text.primary",
            bgcolor: "background.default",
            fontFamily: structuredMockupTheme.typography.fontFamily,
            "& [data-structured-mockup-semantic-metadata='present']::after": {
              content: '"ⓘ"',
              position: "absolute",
              top: 2,
              right: 4,
              zIndex: 1,
              fontSize: "0.75rem",
              lineHeight: 1,
              color: "text.secondary",
              pointerEvents: "none",
            },
          }}
        >
          {children}
        </Box>
      </ThemeProvider>
    ),
  },
  components: {
    text: {
      label: "Text",
      defaultProps: { ...defaultLayoutProps, text: "Text" },
      fields: {
        ...layoutFields,
        text: { type: "textarea", label: "Text" },
        variant: {
          type: "select",
          label: "Text role",
          options: ["body", "heading", "caption", "label", "badge"].map(
            (value) => ({ label: value, value })
          ),
        },
      },
      render: ({ text, variant = "body", ...layout }) => (
        <Typography
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role={layout.role}
          component={variant === "heading" ? "h2" : "p"}
          sx={{
            ...layoutStyle(layout),
            whiteSpace: "pre-wrap",
            ...textStyles[variant],
          }}
        >
          {text}
        </Typography>
      ),
    },
    button: {
      label: "Button",
      defaultProps: { ...defaultLayoutProps, label: "Button" },
      fields: { ...layoutFields, label: { type: "text", label: "Label" } },
      render: ({ label, ...layout }) => (
        <Button
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role={layout.role}
          variant="outlined"
          tabIndex={-1}
          sx={layoutStyle(layout)}
        >
          {label}
        </Button>
      ),
    },
    input: {
      label: "Input",
      fields: {
        ...layoutFields,
        label: { type: "text", label: "Label" },
        placeholder: { type: "text", label: "Placeholder" },
        value: { type: "textarea", label: "Value" },
        multiline: {
          type: "radio",
          label: "Multiline",
          options: [
            { label: "Yes", value: true },
            { label: "No", value: false },
          ],
        },
      },
      render: ({ label, placeholder, value, multiline, ...layout }) => (
        <TextField
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role={layout.role}
          label={label}
          placeholder={placeholder}
          value={value}
          multiline={multiline ?? value.includes("\n")}
          slotProps={{ htmlInput: { readOnly: true, tabIndex: -1 } }}
          sx={{
            ...layoutStyle(layout),
            "& .MuiInputBase-root": {
              height: layout.heightMode === "fixed" ? "100%" : undefined,
              alignItems: "flex-start",
            },
            "& textarea": {
              height:
                layout.heightMode === "fixed" ? "100% !important" : undefined,
              overflow: "auto !important",
              boxSizing: "border-box",
            },
          }}
        />
      ),
    },
    card: {
      label: "Card",
      fields: { ...layoutFields, label: { type: "text", label: "Label" } },
      render: ({ label, ...layout }) => (
        <Paper
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role={layout.role}
          variant="outlined"
          sx={{ ...layoutStyle(layout), p: 2 }}
        >
          {label}
        </Paper>
      ),
    },
    rectangle: {
      label: "Rectangle",
      defaultProps: { ...defaultLayoutProps, label: "" },
      fields: { ...layoutFields, label: { type: "text", label: "Label" } },
      render: ({ label, ...layout }) => (
        <Box
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role={layout.role}
          sx={{ ...layoutStyle(layout), border: "2px solid", p: 1 }}
        >
          {label}
        </Box>
      ),
    },
    "image-placeholder": {
      label: "Image placeholder",
      fields: {
        ...layoutFields,
        altText: { type: "text", label: "Description" },
      },
      render: ({ altText, ...layout }) => (
        <Box
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role={layout.role ?? "img"}
          aria-label={altText}
          sx={{
            ...layoutStyle(layout),
            display: "grid",
            placeItems: "center",
            border: "2px dashed",
            bgcolor: "action.hover",
            p: 1,
          }}
        >
          {altText}
        </Box>
      ),
    },
    divider: {
      label: "Divider",
      fields: {
        ...layoutFields,
        orientation: {
          type: "select",
          label: "Orientation",
          options: ["horizontal", "vertical"].map((value) => ({
            label: value,
            value,
          })),
        },
      },
      defaultProps: { ...defaultLayoutProps, orientation: "horizontal" },
      render: ({ orientation = "horizontal", ...layout }) => (
        <Box
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role="separator"
          sx={{
            ...layoutStyle(layout),
            minWidth: orientation === "vertical" ? 2 : 24,
            minHeight: orientation === "vertical" ? 24 : 2,
            borderTop: orientation === "vertical" ? undefined : "2px solid",
            borderLeft: orientation === "vertical" ? "2px solid" : undefined,
            borderColor: resolveStructuredMockupColor(layout.color),
          }}
        />
      ),
    },
    icon: {
      label: "Icon",
      defaultProps: {
        ...defaultLayoutProps,
        iconKey: "star",
        accessibleLabel: "Icon",
      },
      fields: {
        ...layoutFields,
        iconKey: {
          type: "select",
          label: "Icon",
          options: [
            "task",
            "bug",
            "feature",
            "goal",
            "contract",
            "workflow",
            "plan",
            "plan-stage",
            "add",
            "arrow-down",
            "arrow-left",
            "arrow-right",
            "arrow-up",
            "check",
            "close",
            "edit",
            "info",
            "menu",
            "search",
            "settings",
            "star",
            "warning",
          ].map((value) => ({ label: value, value })),
        },
        accessibleLabel: { type: "text", label: "Accessible label" },
      },
      render: ({ iconKey, accessibleLabel, ...layout }) => {
        const icon = isStructuredMockupIconKey(iconKey)
          ? React.createElement(getStructuredMockupIcon(iconKey))
          : React.createElement(EntityIcon, { entityType: iconKey });
        return (
          <Box
            data-structured-mockup-component-id={layout.id}
            data-structured-mockup-width-mode={layout.widthMode}
            {...structuredMockupMetadataAttributes(layout)}
            role={layout.role}
            aria-label={accessibleLabel}
            sx={{
              ...layoutStyle(layout),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </Box>
        );
      },
    },
    caret: {
      label: "Caret",
      defaultProps: { ...defaultLayoutProps, direction: "down" },
      fields: {
        ...layoutFields,
        direction: {
          type: "select",
          label: "Direction",
          options: ["up", "right", "down", "left"].map((value) => ({
            label: value,
            value,
          })),
        },
      },
      render: ({ direction, ...layout }) => {
        const Caret = {
          up: KeyboardArrowUpIcon,
          right: KeyboardArrowRightIcon,
          down: KeyboardArrowDownIcon,
          left: KeyboardArrowLeftIcon,
        }[direction];
        return (
          <Box
            data-structured-mockup-component-id={layout.id}
            data-structured-mockup-width-mode={layout.widthMode}
            {...structuredMockupMetadataAttributes(layout)}
            role={layout.role}
            aria-label={`Caret ${direction}`}
            sx={{
              ...layoutStyle(layout),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Caret />
          </Box>
        );
      },
    },
    shape: {
      label: "Shape",
      defaultProps: { ...defaultLayoutProps, kind: "rounded" },
      fields: {
        ...layoutFields,
        kind: {
          type: "select",
          label: "Shape",
          options: [
            "circle",
            "square",
            "rounded",
            "pill",
            "diamond",
            "triangle",
          ].map((value) => ({ label: value, value })),
        },
      },
      render: ({ kind, ...layout }) => (
        <Box
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-width-mode={layout.widthMode}
          {...structuredMockupMetadataAttributes(layout)}
          role={layout.role}
          sx={{
            ...layoutStyle(layout),
            minWidth: layout.widthMode === "fit" ? 48 : undefined,
            minHeight: layout.heightMode === "content" ? 48 : undefined,
            backgroundColor:
              resolveStructuredMockupColor(layout.color) ?? "#c7c0b2",
            clipPath:
              kind === "diamond"
                ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
                : kind === "triangle"
                ? "polygon(50% 0%, 100% 100%, 0% 100%)"
                : undefined,
            borderRadius:
              kind === "circle"
                ? "50%"
                : kind === "pill"
                ? 999
                : kind === "rounded"
                ? 12
                : 0,
          }}
        />
      ),
    },
    slot: {
      label: "Slot",
      defaultProps: {
        ...defaultLayoutProps,
        name: "slot",
        surface: "dashed",
        children: [],
      },
      fields: {
        ...layoutFields,
        name: { type: "text", label: "Slot name" },
        surface: {
          type: "select",
          label: "Surface",
          options: ["plain", "panel", "muted", "dashed"].map((value) => ({
            label: value,
            value,
          })),
        },
        children: { type: "slot" },
      },
      resolveData: (data, { trigger }) =>
        trigger === "insert"
          ? {
              props: {
                name: `slot-${data.props.id.slice(0, 8)}`,
              },
            }
          : { props: {} },
      render: ({ children: Children, name, surface = "dashed", ...layout }) => (
        <Children
          data-structured-mockup-component-id={layout.id}
          data-structured-mockup-slot={name}
          {...structuredMockupMetadataAttributes(layout)}
          style={{
            ...layoutStyle(layout),
            minHeight: 48,
            padding: 8,
            border:
              surface === "plain"
                ? undefined
                : surface === "dashed"
                ? "1px dashed #8c8272"
                : "1px solid #c7c0b2",
          }}
        />
      ),
    },
    "mockup-occurrence": {
      label: "Component",
      defaultProps: {
        ...defaultLayoutProps,
        sourceMockupId: "00000000-0000-4000-8000-000000000000",
        slotAssignmentsJson: "[]",
      },
      fields: {
        ...layoutFields,
        sourceMockupId: { type: "text", label: "Source mockup" },
        slotAssignmentsJson: { type: "custom", render: () => <></> },
      },
      resolveData: (_data, { metadata, trigger }) =>
        trigger === "insert" && typeof metadata.sourceMockupId === "string"
          ? {
              props: {
                sourceMockupId: metadata.sourceMockupId,
                slotAssignmentsJson: "[]",
              },
            }
          : { props: {} },
      render: (props) => <ReferencedMockupOccurrence {...props} />,
    },
    row: containerConfig("Row"),
    column: containerConfig("Column"),
  },
};
