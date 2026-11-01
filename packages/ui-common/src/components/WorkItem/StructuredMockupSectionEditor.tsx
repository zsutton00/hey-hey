import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import AlignHorizontalCenterIcon from "@mui/icons-material/AlignHorizontalCenter";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditNoteIcon from "@mui/icons-material/EditNote";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import PaletteIcon from "@mui/icons-material/Palette";
import SpaceBarIcon from "@mui/icons-material/SpaceBar";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import SmartButtonOutlinedIcon from "@mui/icons-material/SmartButtonOutlined";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import InsertEmoticonOutlinedIcon from "@mui/icons-material/InsertEmoticonOutlined";
import ViewModuleOutlinedIcon from "@mui/icons-material/ViewModuleOutlined";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import ViewQuiltOutlinedIcon from "@mui/icons-material/ViewQuiltOutlined";
import ViewStreamIcon from "@mui/icons-material/ViewStream";
import {
  Alert,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import { ActionBar, createUsePuck, Drawer, Puck } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  WorkItemStructuredMockupAnnotationCategory,
  WorkItemStructuredMockupAnnotationTarget,
  WorkItemTypeSectionDefinition,
} from "../../api";
import { getCurrentUser } from "../../services/authService";
import { resolveHtmlCssSize } from "../../utils/htmlCssSizeProfiles";
import { decodeStructuredMockupSectionContent } from "../../utils/workItemSections";
import {
  puckDataToStructuredMockupDocument,
  structuredMockupDocumentToPuckData,
  structuredMockupPuckConfig,
  ReferencedMockupContext,
  type StructuredMockupPuckMetadata,
  type StructuredMockupPuckProps,
} from "../shared/structuredMockupPuck";
import { StructuredMockupAnnotationLayer } from "../shared/StructuredMockupAnnotationLayer";
import { StructuredMockupLayoutDiagnostics } from "../shared/StructuredMockupLayoutDiagnostics";
import { EntityIcon } from "../Entity";
import { useMentionEntitySearch } from "../../data/hooks/useMentionEntitySearch";
import type { SearchEntity } from "../SmarterTextAreaCard/types";
import {
  wrapStructuredMockupSiblings,
  type StructuredMockupWrapperDirection,
} from "./structuredMockupWrapping";

const useStructuredMockupPuck =
  createUsePuck<typeof structuredMockupPuckConfig>();

interface CompactPuckFieldsProps {
  children: React.ReactNode;
  isLoading: boolean;
}

type StructuredMockupComponentType = keyof StructuredMockupPuckProps;

type PropertyGroupKey =
  | "sizing"
  | "layout"
  | "spacing"
  | "appearance"
  | "metadata"
  | "text"
  | "content";

interface PropertyGroup {
  key: PropertyGroupKey;
  label: string;
  fieldNames: readonly string[];
  icon: React.ReactElement;
}

interface PropertyTarget {
  componentId: string;
  componentType: StructuredMockupComponentType;
  itemSelector: { index: number; zone?: string };
}

interface SubmenuAnchorPosition {
  left: number;
  top: number;
}

const getSubmenuAnchorPosition = (
  anchorEl: HTMLElement,
): SubmenuAnchorPosition => {
  const rect = anchorEl.getBoundingClientRect();
  return { left: rect.left + rect.width / 2, top: rect.bottom + 4 };
};

type StructuredMockupSubmenu =
  | {
      kind: "property";
      group: PropertyGroupKey;
      target: PropertyTarget;
      anchorPosition: SubmenuAnchorPosition;
    }
  | {
      kind: "wrapper";
      target: PropertyTarget;
      anchorPosition: SubmenuAnchorPosition;
    };

interface StructuredMockupChromePalette {
  background: string;
  text: string;
  textSecondary: string;
  primary: string;
}

interface ActionBarViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ActionBarViewportCorrection {
  x: number;
  y: number;
}

const STRUCTURED_MOCKUP_ACTION_BAR_GUTTER = 8;

const getActionBarViewportCorrection = (
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">,
  viewport: ActionBarViewportBounds,
  gutter = STRUCTURED_MOCKUP_ACTION_BAR_GUTTER,
): ActionBarViewportCorrection => {
  const minX = viewport.left + gutter;
  const maxX = viewport.right - gutter;
  const minY = viewport.top + gutter;
  const maxY = viewport.bottom - gutter;
  const x =
    rect.width > maxX - minX
      ? minX - rect.left
      : rect.left < minX
        ? minX - rect.left
        : rect.right > maxX
          ? maxX - rect.right
          : 0;
  const y =
    rect.height > maxY - minY
      ? minY - rect.top
      : rect.top < minY
        ? minY - rect.top
        : rect.bottom > maxY
          ? maxY - rect.bottom
          : 0;

  return { x, y };
};

const getActionBarViewportBounds = (view: Window): ActionBarViewportBounds => {
  const visualViewport = view.visualViewport;
  if (visualViewport) {
    return {
      left: visualViewport.offsetLeft,
      top: visualViewport.offsetTop,
      right: visualViewport.offsetLeft + visualViewport.width,
      bottom: visualViewport.offsetTop + visualViewport.height,
    };
  }

  return {
    left: 0,
    top: 0,
    right: view.innerWidth,
    bottom: view.innerHeight,
  };
};

const intersectViewportBounds = (
  viewport: ActionBarViewportBounds,
  clipRect: Pick<
    DOMRect,
    "left" | "top" | "right" | "bottom" | "width" | "height"
  >,
): ActionBarViewportBounds => {
  if (clipRect.width <= 0 || clipRect.height <= 0) return viewport;

  return {
    left: Math.max(viewport.left, clipRect.left),
    top: Math.max(viewport.top, clipRect.top),
    right: Math.min(viewport.right, clipRect.right),
    bottom: Math.min(viewport.bottom, clipRect.bottom),
  };
};

const useKeepActionBarInViewport = (
  actionBarRef: React.RefObject<HTMLElement | null>,
  viewportRef: React.RefObject<HTMLElement | null>,
): void => {
  const actionWrapperRef = useRef<HTMLElement | null>(null);
  const baseTransformRef = useRef("");
  const appliedTransformRef = useRef("");
  const frameRef = useRef<number | null>(null);

  const syncPosition = useCallback(() => {
    const paper = actionBarRef.current;
    const actionWrapper = paper?.parentElement;
    const view = actionWrapper?.ownerDocument.defaultView;
    if (!actionWrapper || !view) return;

    if (actionWrapper !== actionWrapperRef.current) {
      actionWrapperRef.current = actionWrapper;
      baseTransformRef.current = actionWrapper.style.transform;
      appliedTransformRef.current = "";
    } else if (actionWrapper.style.transform !== appliedTransformRef.current) {
      baseTransformRef.current = actionWrapper.style.transform;
    }

    actionWrapper.style.transform = baseTransformRef.current;
    const correction = getActionBarViewportCorrection(
      actionWrapper.getBoundingClientRect(),
      intersectViewportBounds(
        getActionBarViewportBounds(view),
        viewportRef.current?.getBoundingClientRect() ?? {
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
        },
      ),
    );
    const hasCorrection = correction.x !== 0 || correction.y !== 0;
    const transform = hasCorrection
      ? `translate(${correction.x}px, ${correction.y}px) ${baseTransformRef.current}`
      : baseTransformRef.current;
    actionWrapper.style.transform = transform;
    appliedTransformRef.current = transform;
  }, [actionBarRef, viewportRef]);

  const schedulePositionSync = useCallback(() => {
    const view = actionBarRef.current?.ownerDocument.defaultView;
    if (!view || frameRef.current !== null) return;
    frameRef.current = view.requestAnimationFrame(() => {
      frameRef.current = null;
      syncPosition();
    });
  }, [actionBarRef, syncPosition]);

  useLayoutEffect(() => {
    const paper = actionBarRef.current;
    const document = paper?.ownerDocument;
    const view = document?.defaultView;
    if (!paper || !document || !view) return;

    schedulePositionSync();
    document.addEventListener("scroll", schedulePositionSync, true);
    view.addEventListener("resize", schedulePositionSync);
    view.visualViewport?.addEventListener("resize", schedulePositionSync);
    view.visualViewport?.addEventListener("scroll", schedulePositionSync);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedulePositionSync);
    resizeObserver?.observe(paper);

    return () => {
      document.removeEventListener("scroll", schedulePositionSync, true);
      view.removeEventListener("resize", schedulePositionSync);
      view.visualViewport?.removeEventListener("resize", schedulePositionSync);
      view.visualViewport?.removeEventListener("scroll", schedulePositionSync);
      resizeObserver?.disconnect();
      if (frameRef.current !== null) {
        view.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [actionBarRef, schedulePositionSync]);
};

interface StructuredMockupEditorContextValue {
  disabled: boolean;
  chromePalette: StructuredMockupChromePalette;
  canvasScrollportRef: React.RefObject<HTMLElement | null>;
  activePropertyGroup: PropertyGroupKey | null;
  activePropertyTarget: PropertyTarget | null;
  activeSubmenu: StructuredMockupSubmenu | null;
  openPropertyGroup: (
    group: PropertyGroupKey,
    target: PropertyTarget,
    anchorEl: HTMLElement,
  ) => void;
  openWrapperMenu: (target: PropertyTarget, anchorEl: HTMLElement) => void;
  closeSubmenu: () => void;
}

const StructuredMockupEditorContext = React.createContext<
  StructuredMockupEditorContextValue | undefined
>(undefined);

const useStructuredMockupEditorContext =
  (): StructuredMockupEditorContextValue => {
    const context = React.useContext(StructuredMockupEditorContext);
    if (!context) {
      throw new Error(
        "Structured mockup editor context is required for property controls",
      );
    }
    return context;
  };

interface FieldGroupProps {
  children: React.ReactNode;
  label: string;
  testId: string;
}

const FieldGroup = ({
  children,
  label,
  testId,
}: FieldGroupProps): React.ReactElement => (
  <Box
    component="fieldset"
    data-testid={testId}
    data-field-section
    sx={{
      border: 0,
      m: 0,
      p: 0,
      minWidth: 0,
    }}
  >
    <Typography
      component="legend"
      variant="caption"
      sx={{ color: "text.secondary", fontWeight: 600, mb: 1 }}
    >
      {label}
    </Typography>
    {children}
  </Box>
);

const DimensionValueField: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Box
    component="fieldset"
    sx={{ border: 0, p: 0, m: 0, minWidth: 0, width: 96 }}
  >
    {children}
  </Box>
);

type DimensionMode = "content" | "fill" | "fit" | "fixed";

interface SizingFieldsProps {
  fields: React.ReactNode[];
  heightMode?: DimensionMode;
  widthMode?: DimensionMode;
}

const SizingFields = ({
  fields,
  heightMode,
  widthMode,
}: SizingFieldsProps): React.ReactElement => (
  <FieldGroup label="Sizing" testId="structured-mockup-sizing-fields">
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(180px, 1fr))" },
        gap: 1,
      }}
    >
      <Box
        data-testid="structured-mockup-width-fields"
        sx={{
          display: "grid",
          gridTemplateColumns:
            widthMode === "fixed" ? "minmax(132px, 1fr) 96px" : "1fr",
          gap: 1,
        }}
      >
        {fields[0]}
        {widthMode === "fixed" ? (
          <DimensionValueField>{fields[1]}</DimensionValueField>
        ) : null}
      </Box>
      <Box
        data-testid="structured-mockup-height-fields"
        sx={{
          display: "grid",
          gridTemplateColumns:
            heightMode === "fixed" ? "minmax(132px, 1fr) 96px" : "1fr",
          gap: 1,
        }}
      >
        {fields[2]}
        {heightMode === "fixed" ? (
          <DimensionValueField>{fields[3]}</DimensionValueField>
        ) : null}
      </Box>
    </Box>
  </FieldGroup>
);

const ContainerLayoutFields = ({
  fields,
}: {
  fields: React.ReactNode[];
}): React.ReactElement => (
  <FieldGroup label="Layout" testId="structured-mockup-layout-fields">
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          sm: "repeat(auto-fit, minmax(140px, 1fr))",
        },
        gap: 1,
      }}
    >
      {fields.map((field, index) => (
        <Box key={index} sx={{ minWidth: 0 }}>
          {field}
        </Box>
      ))}
    </Box>
  </FieldGroup>
);

const propertyGroup = (
  key: PropertyGroupKey,
  label: string,
  fieldNames: readonly string[],
  icon: React.ReactElement,
): PropertyGroup => ({ key, label, fieldNames, icon });

const sizingPropertyGroup = propertyGroup(
  "sizing",
  "Sizing",
  ["widthMode", "widthValue", "heightMode", "heightValue"],
  <AspectRatioIcon />,
);
const metadataPropertyGroup = propertyGroup(
  "metadata",
  "Description",
  ["description"],
  <DescriptionOutlinedIcon />,
);
const appearanceFieldNames = ["color", "opacity", "overflow"] as const;

const containerPropertyGroups = [
  sizingPropertyGroup,
  propertyGroup(
    "layout",
    "Layout",
    ["direction", "justify", "align"],
    <AlignHorizontalCenterIcon />,
  ),
  propertyGroup("spacing", "Spacing", ["gap", "padding"], <SpaceBarIcon />),
  metadataPropertyGroup,
  propertyGroup(
    "appearance",
    "Appearance",
    ["surface", ...appearanceFieldNames],
    <PaletteIcon />,
  ),
] as const;

const textPropertyGroups = [
  sizingPropertyGroup,
  metadataPropertyGroup,
  propertyGroup("text", "Text", ["text"], <EditNoteIcon />),
  propertyGroup(
    "appearance",
    "Appearance",
    ["variant", ...appearanceFieldNames],
    <PaletteIcon />,
  ),
] as const;

const contentPropertyGroups = [
  sizingPropertyGroup,
  metadataPropertyGroup,
  propertyGroup(
    "content",
    "Content",
    ["label", "placeholder", "value", "multiline", "altText"],
    <EditNoteIcon />,
  ),
  propertyGroup(
    "appearance",
    "Appearance",
    appearanceFieldNames,
    <PaletteIcon />,
  ),
] as const;

const iconPropertyGroups = [
  sizingPropertyGroup,
  metadataPropertyGroup,
  propertyGroup(
    "content",
    "Content",
    ["iconKey", "accessibleLabel"],
    <EditNoteIcon />,
  ),
  propertyGroup(
    "appearance",
    "Appearance",
    appearanceFieldNames,
    <PaletteIcon />,
  ),
] as const;

const propertyGroupsByComponent: Record<
  StructuredMockupComponentType,
  readonly PropertyGroup[]
> = {
  text: textPropertyGroups,
  button: contentPropertyGroups,
  input: contentPropertyGroups,
  card: contentPropertyGroups,
  rectangle: contentPropertyGroups,
  "image-placeholder": contentPropertyGroups,
  divider: [
    sizingPropertyGroup,
    metadataPropertyGroup,
    propertyGroup(
      "appearance",
      "Appearance",
      ["orientation", ...appearanceFieldNames],
      <PaletteIcon />,
    ),
  ],
  row: containerPropertyGroups,
  column: containerPropertyGroups,
  slot: [
    sizingPropertyGroup,
    metadataPropertyGroup,
    propertyGroup(
      "appearance",
      "Appearance",
      ["surface", ...appearanceFieldNames],
      <PaletteIcon />,
    ),
  ],
  icon: iconPropertyGroups,
  caret: [
    sizingPropertyGroup,
    metadataPropertyGroup,
    propertyGroup(
      "appearance",
      "Appearance",
      appearanceFieldNames,
      <PaletteIcon />,
    ),
  ],
  shape: [
    sizingPropertyGroup,
    metadataPropertyGroup,
    propertyGroup(
      "appearance",
      "Appearance",
      appearanceFieldNames,
      <PaletteIcon />,
    ),
  ],
  "mockup-occurrence": [
    sizingPropertyGroup,
    metadataPropertyGroup,
    propertyGroup(
      "appearance",
      "Appearance",
      appearanceFieldNames,
      <PaletteIcon />,
    ),
  ],
};

const getPropertyGroups = (
  componentType: StructuredMockupComponentType,
): readonly PropertyGroup[] => propertyGroupsByComponent[componentType];

interface PuckFieldChildProps {
  fieldName: string;
}

const isPuckFieldChild = (
  field: React.ReactNode,
): field is React.ReactElement<PuckFieldChildProps> =>
  React.isValidElement<PuckFieldChildProps>(field) &&
  typeof field.props.fieldName === "string";

const CompactPuckFields = ({
  children,
  isLoading,
}: CompactPuckFieldsProps): React.ReactElement => {
  const selectedItem = useStructuredMockupPuck((state) => state.selectedItem);
  const { activePropertyGroup } = useStructuredMockupEditorContext();
  const fieldsByName = new Map(
    React.Children.toArray(children)
      .filter(isPuckFieldChild)
      .map((field) => [field.props.fieldName, field] as const),
  );
  const isContainer =
    selectedItem?.type === "row" || selectedItem?.type === "column";
  const activeGroup = selectedItem
    ? getPropertyGroups(selectedItem.type).find(
        (group) => group.key === activePropertyGroup,
      )
    : undefined;
  const selectedFields = activeGroup
    ? activeGroup.fieldNames.flatMap((fieldName) => {
        const field = fieldsByName.get(fieldName);
        return field === undefined ? [] : [field];
      })
    : [];

  return (
    <Box
      data-testid="structured-mockup-fields-grid"
      aria-busy={isLoading}
      sx={(theme) => ({
        "--puck-field-label-color-text": alpha(
          theme.palette.text.primary,
          0.78,
        ),
        "--puck-field-label-color-icon": alpha(
          theme.palette.text.primary,
          0.68,
        ),
        display: "flex",
        flexWrap: "wrap",
        gap: 1.5,
        alignItems: "stretch",
        "& > [data-field-section]": {
          flex: "1 1 320px",
          minWidth: 0,
          pr: { xs: 0, sm: 1.5 },
          borderRight: { xs: 0, sm: 1 },
          borderColor: alpha(theme.palette.text.primary, 0.1),
        },
        "& > [data-field-section]:last-child": {
          pr: 0,
          borderRight: 0,
        },
      })}
    >
      {activeGroup?.key === "sizing" ? (
        <SizingFields
          fields={selectedFields}
          widthMode={selectedItem?.props.widthMode}
          heightMode={selectedItem?.props.heightMode}
        />
      ) : activeGroup?.key === "layout" && isContainer ? (
        <ContainerLayoutFields fields={selectedFields} />
      ) : activeGroup ? (
        <FieldGroup
          label={activeGroup.label}
          testId={`structured-mockup-${activeGroup.key}-fields`}
        >
          {selectedFields.map((field, index) => (
            <Box
              key={index}
              data-field-section
              sx={{ mb: index === selectedFields.length - 1 ? 0 : 1.5 }}
            >
              {field}
            </Box>
          ))}
        </FieldGroup>
      ) : null}
    </Box>
  );
};

const PropertyActionToolbar: React.FC = () => {
  const selectedItem = useStructuredMockupPuck((state) => state.selectedItem);
  const itemSelector = useStructuredMockupPuck(
    (state) => state.appState.ui.itemSelector,
  );
  const {
    activePropertyGroup,
    activePropertyTarget,
    activeSubmenu,
    disabled,
    openPropertyGroup,
    openWrapperMenu,
  } = useStructuredMockupEditorContext();
  if (!selectedItem || !itemSelector) return null;

  const isActiveTarget =
    activePropertyTarget?.componentId === selectedItem.props.id &&
    activePropertyTarget.componentType === selectedItem.type;
  const selectedItemLabel =
    structuredMockupPuckConfig.components[selectedItem.type].label;

  return (
    <>
      <ActionBar.Group>
        <Typography
          component="span"
          data-testid="structured-mockup-selected-type-label"
          sx={{
            alignSelf: "center",
            px: 1,
            color: "inherit",
            fontSize: "0.75rem",
            fontWeight: 700,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          {selectedItemLabel}
        </Typography>
      </ActionBar.Group>
      <ActionBar.Group>
        <Tooltip title="Wrap in container">
          <span>
            <IconButton
              aria-label="Wrap in container"
              aria-haspopup="menu"
              aria-pressed={
                activeSubmenu?.kind === "wrapper" &&
                activeSubmenu.target.componentId === selectedItem.props.id
              }
              data-testid="structured-mockup-wrapper-action"
              disabled={disabled}
              onClick={(event) =>
                openWrapperMenu(
                  {
                    componentId: selectedItem.props.id,
                    componentType: selectedItem.type,
                    itemSelector,
                  },
                  event.currentTarget,
                )
              }
              size="small"
              sx={{
                color: "inherit",
                borderRadius: 1,
                "&[aria-pressed='true']": {
                  bgcolor: "action.selected",
                },
              }}
            >
              <ViewQuiltOutlinedIcon />
            </IconButton>
          </span>
        </Tooltip>
        {getPropertyGroups(selectedItem.type).map((group) => (
          <Tooltip key={group.key} title={`${group.label} options`}>
            <span>
              <IconButton
                aria-label={`${group.label} options`}
                aria-haspopup="dialog"
                aria-pressed={
                  isActiveTarget && activePropertyGroup === group.key
                }
                data-testid={`structured-mockup-property-action-${group.key}`}
                disabled={disabled}
                onClick={(event) =>
                  openPropertyGroup(
                    group.key,
                    {
                      componentId: selectedItem.props.id,
                      componentType: selectedItem.type,
                      itemSelector,
                    },
                    event.currentTarget,
                  )
                }
                size="small"
                sx={{
                  color: "inherit",
                  borderRadius: 1,
                  "&[aria-pressed='true']": {
                    bgcolor: "action.selected",
                  },
                }}
              >
                {group.icon}
              </IconButton>
            </span>
          </Tooltip>
        ))}
      </ActionBar.Group>
    </>
  );
};

const AppActionBar = ({
  children,
  parentAction,
}: {
  children: React.ReactNode;
  parentAction: React.ReactNode;
}): React.ReactElement => {
  const { canvasScrollportRef, chromePalette } =
    useStructuredMockupEditorContext();
  const actionBarRef = useRef<HTMLDivElement>(null);

  useKeepActionBarInViewport(actionBarRef, canvasScrollportRef);

  return (
    <Paper
      elevation={8}
      ref={actionBarRef}
      data-testid="structured-mockup-selection-actions"
      style={{
        backgroundColor: chromePalette.background,
        color: chromePalette.text,
      }}
      sx={{
        "--puck-actionbar-color-bg": "transparent",
        "--puck-actionbar-color-text": chromePalette.textSecondary,
        "--puck-color-text-inverse": chromePalette.text,
        "--puck-color-interactive-inverse-hover": chromePalette.primary,
        borderRadius: 1,
        boxSizing: "border-box",
        maxWidth: "calc(100vw - 16px)",
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      <ActionBar>
        <PropertyActionToolbar />
        <ActionBar.Group>{parentAction}</ActionBar.Group>
        <ActionBar.Group>{children}</ActionBar.Group>
      </ActionBar>
    </Paper>
  );
};

interface QuietPuckOverlayStyle extends React.CSSProperties {
  "--puck-slot-component-border-width": string;
  "--puck-slot-component-color-overlay": string;
  "--puck-slot-component-color-overlay-border": string;
  "--puck-slot-component-color-border-selected": string;
}

const QuietPuckComponentOverlay = ({
  children,
}: {
  children: React.ReactNode;
  hover: boolean;
  isSelected: boolean;
  componentId: string;
  componentType: string;
}): React.ReactElement => {
  const theme = useTheme<Theme>();
  const style: QuietPuckOverlayStyle = {
    "--puck-slot-component-border-width": "1px",
    "--puck-slot-component-color-overlay": "transparent",
    "--puck-slot-component-color-overlay-border": alpha(
      theme.palette.primary.main,
      0.42,
    ),
    "--puck-slot-component-color-border-selected": theme.palette.primary.main,
  };

  if (!React.isValidElement<{ style?: React.CSSProperties }>(children)) {
    return <>{children}</>;
  }

  return React.cloneElement(children, {
    style: { ...children.props.style, ...style },
  });
};

const compactPuckOverrides = {
  fields: CompactPuckFields,
  actionBar: AppActionBar,
  componentOverlay: QuietPuckComponentOverlay,
};

const structuredMockupEditorCanvasSx = {
  position: "relative",
  "& .Puck": {
    minHeight: "inherit",
  },
  "& [data-puck-entry]:not([data-puck-dragging]) [data-puck-dropzone]": {
    background: "transparent",
    outline: "none",
  },
} as const;

const PaletteDragItem: React.FC<{
  componentType: StructuredMockupComponentType;
  label: string;
  icon: React.ReactNode;
  testId: string;
  disabled?: boolean;
  onClick?: () => void;
  onClickDisabled?: boolean;
}> = ({
  componentType,
  label,
  icon,
  testId,
  disabled = false,
  onClick,
  onClickDisabled = disabled,
}) => (
  <Tooltip title={label}>
    <Box
      component="span"
      onClick={onClickDisabled ? undefined : onClick}
      aria-label={label}
      data-testid={testId}
      sx={{
        display: "inline-flex",
        "& > div": { display: "contents" },
        "& [data-puck-drawer-item]": {
          width: 40,
          height: 40,
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          cursor: disabled ? "not-allowed" : "grab",
          color: disabled ? "action.disabled" : "text.secondary",
          "&:hover": { bgcolor: disabled ? undefined : "action.hover" },
        },
      }}
    >
      <Drawer.Item name={componentType} label={label} isDragDisabled={disabled}>
        {() => (
          <Box
            aria-hidden="true"
            sx={{ display: "inline-flex", pointerEvents: "none" }}
          >
            {icon}
          </Box>
        )}
      </Drawer.Item>
    </Box>
  </Tooltip>
);

const HistoryControls: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const history = useStructuredMockupPuck((state) => state.history);
  return (
    <Stack direction="row" spacing={0.5}>
      <Tooltip title="Undo">
        <span>
          <IconButton
            aria-label="Undo mockup change"
            data-testid="structured-mockup-undo"
            disabled={disabled || !history.hasPast}
            onClick={() => history.back()}
          >
            <UndoIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Redo">
        <span>
          <IconButton
            aria-label="Redo mockup change"
            data-testid="structured-mockup-redo"
            disabled={disabled || !history.hasFuture}
            onClick={() => history.forward()}
          >
            <RedoIcon />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
};

const SubmenuPopover: React.FC = () => {
  const selectedItem = useStructuredMockupPuck((state) => state.selectedItem);
  const dispatch = useStructuredMockupPuck((state) => state.dispatch);
  const appState = useStructuredMockupPuck((state) => state.appState);
  const {
    activePropertyGroup,
    activePropertyTarget,
    activeSubmenu,
    closeSubmenu,
  } = useStructuredMockupEditorContext();
  const selectedItemId = selectedItem?.props.id;

  useEffect(() => {
    if (
      !activePropertyTarget ||
      (selectedItemId === activePropertyTarget.componentId &&
        selectedItem?.type === activePropertyTarget.componentType)
    ) {
      return;
    }
    closeSubmenu();
  }, [activePropertyTarget, closeSubmenu, selectedItem?.type, selectedItemId]);

  const activeGroup = selectedItem
    ? getPropertyGroups(selectedItem.type).find(
        (group) => group.key === activePropertyGroup,
      )
    : undefined;

  if (!activeSubmenu || !activePropertyTarget) return null;

  const wrapSelection = (direction: StructuredMockupWrapperDirection): void => {
    const result = wrapStructuredMockupSiblings({
      data: appState.data,
      selectors: [activePropertyTarget.itemSelector],
      wrapperId: crypto.randomUUID(),
      direction,
    });
    if (!result.ok) return;
    closeSubmenu();
    dispatch({
      type: "setData",
      data: { content: result.data.content },
      recordHistory: true,
    });
    dispatch({
      type: "setUi",
      ui: { itemSelector: result.wrapperSelector },
    });
  };

  return (
    <Popover
      open
      anchorReference="anchorPosition"
      anchorPosition={activeSubmenu.anchorPosition}
      transformOrigin={{ vertical: "top", horizontal: "center" }}
      onClose={closeSubmenu}
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      disableScrollLock
      hideBackdrop
      slotProps={{
        root: { sx: { pointerEvents: "none" } },
        paper: {
          sx: {
            pointerEvents: "auto",
            p: activeSubmenu.kind === "property" ? 1.5 : 0.5,
            maxWidth: "min(440px, calc(100vw - 16px))",
            maxHeight: "min(520px, calc(100vh - 16px))",
            overflow: "auto",
          },
        },
      }}
      data-testid={
        activeSubmenu.kind === "property" && activeGroup
          ? `structured-mockup-property-dialog-${activeGroup.key}`
          : "structured-mockup-wrapper-menu"
      }
    >
      {activeSubmenu.kind === "wrapper" ? (
        <Stack direction="row" spacing={0.5} role="menu">
          <Tooltip title="Wrap vertically">
            <IconButton
              aria-label="Wrap vertically"
              data-testid="structured-mockup-wrap-vertical"
              onClick={() => wrapSelection("vertical")}
              size="small"
            >
              <ViewStreamIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Wrap horizontally">
            <IconButton
              aria-label="Wrap horizontally"
              data-testid="structured-mockup-wrap-horizontal"
              onClick={() => wrapSelection("horizontal")}
              size="small"
            >
              <ViewColumnOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : activeGroup && selectedItem ? (
        <Puck.Fields wrapFields={false} />
      ) : null}
    </Popover>
  );
};

export const StructuredMockupSectionEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
  definition: WorkItemTypeSectionDefinition;
  disabled?: boolean;
  authorUserId?: string;
  materializedProposalId?: string;
  organizationId?: string;
  projectId?: string;
}> = ({
  value,
  onChange,
  definition,
  disabled = false,
  authorUserId,
  materializedProposalId,
  organizationId,
  projectId,
}) => {
  const hostTheme = useTheme<Theme>();
  const scrollportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scrollportWidth, setScrollportWidth] = useState(0);
  const [pendingTarget, setPendingTarget] =
    useState<WorkItemStructuredMockupAnnotationTarget | null>(null);
  const [activeSubmenu, setActiveSubmenu] =
    useState<StructuredMockupSubmenu | null>(null);
  const [annotationNote, setAnnotationNote] = useState("");
  const [annotationCategory, setAnnotationCategory] =
    useState<WorkItemStructuredMockupAnnotationCategory>("context");
  const [
    componentSearchOpen,
    setComponentSearchOpen,
    componentSearchOpenOwnerKey,
  ] = useModalState(false);
  const [componentQuery, setComponentQuery] = useState("");
  const [componentResults, setComponentResults] = useState<SearchEntity[]>([]);
  const [selectedComponentSource, setSelectedComponentSource] =
    useState<SearchEntity | null>(null);
  const { searchEntities } = useMentionEntitySearch(
    organizationId ?? null,
    projectId ?? null,
    null,
  );
  const document = useMemo(
    () => decodeStructuredMockupSectionContent(value),
    [value],
  );
  const data = useMemo(
    () => (document ? structuredMockupDocumentToPuckData(document) : null),
    [document],
  );
  const handleChange = useCallback(
    (nextData: NonNullable<typeof data>) => {
      onChange(
        JSON.stringify(
          puckDataToStructuredMockupDocument(nextData, document ?? undefined),
        ),
      );
    },
    [document, onChange],
  );
  const searchComponents = useCallback(async () => {
    const results = await searchEntities(componentQuery, {
      kind: "work-item-types",
      taskTypes: ["mockups_v3"],
    });
    setComponentResults(results.filter((result) => result.name !== result.id));
  }, [componentQuery, searchEntities]);

  useEffect(() => {
    const scrollport = scrollportRef.current;
    if (!scrollport) return;
    const updateWidth = () => setScrollportWidth(scrollport.clientWidth);
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(scrollport);
    return () => observer.disconnect();
  }, []);

  const presentationSize = useMemo(
    () =>
      document && scrollportWidth > 0
        ? resolveHtmlCssSize({
            definition,
            content: document,
            context: "page",
            containerWidth: scrollportWidth,
          })
        : null,
    [definition, document, scrollportWidth],
  );
  const handleAnnotationLifecycleChange = useCallback(
    (annotationId: string, lifecycle: "open" | "resolved") => {
      if (!document) return;
      onChange(
        JSON.stringify({
          ...document,
          annotations: document.annotations.map((annotation) =>
            annotation.id === annotationId
              ? { ...annotation, lifecycle }
              : annotation,
          ),
        }),
      );
    },
    [document, onChange],
  );
  const handleCreateAnnotation = useCallback(() => {
    if (!document || !pendingTarget || !materializedProposalId) return;
    const userId = authorUserId ?? getCurrentUser()?.id;
    if (!userId) return;
    onChange(
      JSON.stringify({
        ...document,
        annotations: [
          ...document.annotations,
          {
            id: crypto.randomUUID(),
            note: annotationNote.trim(),
            author: { type: "human", userId },
            category: annotationCategory,
            lifecycle: "open",
            authoredProposalId: materializedProposalId,
            authoredSizeKey:
              document.sizeKey ?? definition.defaultSizeKey ?? "default",
            target: pendingTarget,
          },
        ],
      }),
    );
    setPendingTarget(null);
    setAnnotationNote("");
    setAnnotationCategory("context");
  }, [
    annotationCategory,
    annotationNote,
    authorUserId,
    definition.defaultSizeKey,
    document,
    materializedProposalId,
    onChange,
    pendingTarget,
  ]);

  const editorContextValue = useMemo<StructuredMockupEditorContextValue>(
    () => ({
      disabled,
      canvasScrollportRef: scrollportRef,
      chromePalette: {
        background: hostTheme.palette.background.paper,
        text: hostTheme.palette.text.primary,
        textSecondary: hostTheme.palette.text.secondary,
        primary: hostTheme.palette.primary.main,
      },
      activePropertyGroup:
        activeSubmenu?.kind === "property" ? activeSubmenu.group : null,
      activePropertyTarget: activeSubmenu?.target ?? null,
      activeSubmenu,
      openPropertyGroup: (group, target, anchorEl) =>
        setActiveSubmenu((current) =>
          current?.kind === "property" &&
          current.group === group &&
          current.target.componentId === target.componentId
            ? null
            : {
                kind: "property",
                group,
                target,
                anchorPosition: getSubmenuAnchorPosition(anchorEl),
              },
        ),
      openWrapperMenu: (target, anchorEl) =>
        setActiveSubmenu((current) =>
          current?.kind === "wrapper" &&
          current.target.componentId === target.componentId
            ? null
            : {
                kind: "wrapper",
                target,
                anchorPosition: getSubmenuAnchorPosition(anchorEl),
              },
        ),
      closeSubmenu: () => setActiveSubmenu(null),
    }),
    [
      activeSubmenu,
      disabled,
      hostTheme.palette.background.paper,
      hostTheme.palette.primary.main,
      hostTheme.palette.text.primary,
      hostTheme.palette.text.secondary,
    ],
  );

  if (!document || !data) {
    return (
      <Alert severity="error">
        The structured mockup document is malformed and cannot be edited.
      </Alert>
    );
  }

  return (
    <StructuredMockupEditorContext.Provider value={editorContextValue}>
      <Stack
        spacing={1.5}
        sx={{ px: 1.75, pb: 2 }}
        data-testid="structured-mockup-section-editor"
      >
        {definition.sizeProfiles?.length ? (
          <TextField
            select
            label="Presentation size"
            value={document.sizeKey ?? definition.defaultSizeKey ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                JSON.stringify({ ...document, sizeKey: event.target.value }),
              )
            }
            slotProps={{
              htmlInput: {
                "data-testid": "structured-mockup-size-profile-selector",
              },
            }}
          >
            {definition.sizeProfiles.map((profile) => (
              <MenuItem key={profile.key} value={profile.key}>
                {profile.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <Box
          sx={{
            pointerEvents: disabled ? "none" : "auto",
            opacity: disabled ? 0.65 : 1,
            // Puck's default root clips its action overlay. The mockup
            // scrollport is the host-owned clipping boundary instead.
            "& .Puck, & #puck-canvas-root": {
              overflow: "visible !important",
            },
          }}
        >
          <ReferencedMockupContext.Provider
            value={{ organizationId, projectId, ancestors: new Set() }}
          >
            <Puck
              config={structuredMockupPuckConfig}
              data={data}
              onChange={handleChange}
              permissions={{
                insert: !disabled,
                edit: !disabled,
                drag: !disabled,
                delete: !disabled,
                duplicate: !disabled,
              }}
              iframe={{ enabled: false }}
              dnd={{ behavior: "auto" }}
              metadata={
                selectedComponentSource
                  ? ({
                      sourceMockupId: selectedComponentSource.id,
                    } satisfies StructuredMockupPuckMetadata)
                  : {}
              }
              ui={{ leftSideBarVisible: false, rightSideBarVisible: false }}
              overrides={compactPuckOverrides}
            >
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  alignItems={{ xs: "stretch", sm: "center" }}
                  justifyContent="space-between"
                  spacing={1}
                  data-testid="structured-mockup-controls"
                >
                  <Typography component="h2" variant="subtitle1">
                    Mockup editor
                  </Typography>
                  <HistoryControls disabled={disabled} />
                </Stack>
                <Drawer>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    flexWrap="wrap"
                    data-testid="structured-mockup-insertion-palette"
                  >
                    <PaletteDragItem
                      componentType="rectangle"
                      label="Drag rectangle into mockup"
                      icon={<AddBoxOutlinedIcon />}
                      testId="structured-mockup-insert-rectangle"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="column"
                      label="Drag container into mockup"
                      icon={<ViewStreamIcon />}
                      testId="structured-mockup-insert-container"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="slot"
                      label="Drag slot into mockup"
                      icon={<ViewModuleOutlinedIcon />}
                      testId="structured-mockup-insert-slot"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="button"
                      label="Drag button into mockup"
                      icon={<SmartButtonOutlinedIcon />}
                      testId="structured-mockup-insert-button"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="text"
                      label="Drag text into mockup"
                      icon={<TextFieldsIcon />}
                      testId="structured-mockup-insert-text"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="icon"
                      label="Drag icon into mockup"
                      icon={<InsertEmoticonOutlinedIcon />}
                      testId="structured-mockup-insert-icon"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="shape"
                      label="Drag shape into mockup"
                      icon={<CircleOutlinedIcon />}
                      testId="structured-mockup-insert-shape"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="divider"
                      label="Drag divider into mockup"
                      icon={<HorizontalRuleIcon />}
                      testId="structured-mockup-insert-divider"
                      disabled={disabled}
                    />
                    <PaletteDragItem
                      componentType="mockup-occurrence"
                      label={
                        selectedComponentSource
                          ? `Drag ${selectedComponentSource.name} into mockup`
                          : "Choose a mockup component"
                      }
                      icon={<EntityIcon entityType="mockups_v3" />}
                      testId="structured-mockup-insert-component"
                      disabled={
                        disabled ||
                        !organizationId ||
                        !projectId ||
                        !selectedComponentSource
                      }
                      onClickDisabled={
                        disabled || !organizationId || !projectId
                      }
                      onClick={() => setComponentSearchOpen(true)}
                    />
                    <Tooltip title="Add a review note">
                      <span>
                        <IconButton
                          aria-label="Add note"
                          disabled={disabled || !materializedProposalId}
                          onClick={() =>
                            setPendingTarget({
                              type: "position",
                              x: 0.5,
                              y: 0.5,
                            })
                          }
                        >
                          <EditNoteIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Drawer>
                <Box
                  ref={scrollportRef}
                  role="region"
                  aria-label="Mockup canvas"
                  tabIndex={0}
                  data-testid="structured-mockup-canvas-scrollport"
                  sx={{
                    width: "100%",
                    maxHeight: { xs: 520, md: 680 },
                    minHeight: 320,
                    overflow: "auto",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    bgcolor: "action.hover",
                    p: 1,
                    boxSizing: "border-box",
                  }}
                >
                  <Box
                    ref={canvasRef}
                    data-testid="structured-mockup-canvas"
                    sx={{
                      ...structuredMockupEditorCanvasSx,
                      width: presentationSize?.width ?? "100%",
                      height: presentationSize?.height ?? "auto",
                      minWidth: presentationSize?.width ?? 0,
                      minHeight: presentationSize?.height ?? 420,
                      bgcolor: "#f3efe4",
                      color: "#302e2a",
                      boxSizing: "border-box",
                    }}
                  >
                    <Puck.Preview />
                    <StructuredMockupLayoutDiagnostics
                      canvasRef={canvasRef}
                      presentationKey={`${
                        document.sizeKey ??
                        definition.defaultSizeKey ??
                        "default"
                      }:${presentationSize?.width ?? "fluid"}x${
                        presentationSize?.height ?? "auto"
                      }`}
                    />
                    {materializedProposalId ? (
                      <StructuredMockupAnnotationLayer
                        document={document}
                        materializedProposalId={materializedProposalId}
                        presentationSizeKey={
                          document.sizeKey ??
                          definition.defaultSizeKey ??
                          "default"
                        }
                        canvasRef={canvasRef}
                        onCreate={
                          disabled || !(authorUserId ?? getCurrentUser()?.id)
                            ? undefined
                            : setPendingTarget
                        }
                        onLifecycleChange={
                          disabled ? undefined : handleAnnotationLifecycleChange
                        }
                      />
                    ) : null}
                  </Box>
                </Box>
                <SubmenuPopover />
              </Stack>
            </Puck>
          </ReferencedMockupContext.Provider>
        </Box>
        <Dialog
          open={pendingTarget !== null}
          onClose={() => setPendingTarget(null)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Add review note</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                autoFocus
                label="Note"
                multiline
                minRows={3}
                value={annotationNote}
                inputProps={{ maxLength: 4000 }}
                onChange={(event) => setAnnotationNote(event.target.value)}
              />
              <TextField
                select
                label="Category"
                value={annotationCategory}
                onChange={(event) =>
                  setAnnotationCategory(
                    event.target
                      .value as WorkItemStructuredMockupAnnotationCategory,
                  )
                }
              >
                {["context", "suggestion", "question", "issue"].map(
                  (category) => (
                    <MenuItem key={category} value={category}>
                      {category[0].toUpperCase() + category.slice(1)}
                    </MenuItem>
                  ),
                )}
              </TextField>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingTarget(null)}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!annotationNote.trim()}
              onClick={handleCreateAnnotation}
            >
              Add note
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog
          ownerKey={componentSearchOpenOwnerKey}
          open={componentSearchOpen}
          onClose={() => setComponentSearchOpen(false)}
          fullWidth
          maxWidth="sm"
          data-testid="structured-mockup-component-search-dialog"
        >
          <DialogTitle>Insert mockup component</DialogTitle>
          <DialogContent>
            <Stack spacing={1} sx={{ pt: 1 }}>
              <TextField
                label="Search mockups"
                value={componentQuery}
                onChange={(event) => setComponentQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchComponents();
                }}
              />
              <Button onClick={() => void searchComponents()}>Search</Button>
              {componentResults.map((result) => (
                <Button
                  key={result.id}
                  startIcon={<EntityIcon entityType="mockups_v3" />}
                  onClick={() => {
                    setSelectedComponentSource(result);
                    setComponentSearchOpen(false);
                  }}
                >
                  {result.name}
                </Button>
              ))}
            </Stack>
          </DialogContent>
        </Dialog>
      </Stack>
    </StructuredMockupEditorContext.Provider>
  );
};
