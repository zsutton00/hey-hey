import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import CodeIcon from "@mui/icons-material/Code";
import HubIcon from "@mui/icons-material/Hub";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import LoginIcon from "@mui/icons-material/Login";
import PersonIcon from "@mui/icons-material/Person";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import PsychologyIcon from "@mui/icons-material/Psychology";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import StorageIcon from "@mui/icons-material/Storage";
import WebAssetIcon from "@mui/icons-material/WebAsset";
import WidgetsIcon from "@mui/icons-material/Widgets";
import type { SvgIconProps } from "@mui/material";
import type { ComponentType } from "react";
import type {
  DiagramElementRoleDefinition,
  WorkItemTypeDefinitionDto,
} from "../../api";
import { DecisionIcon } from "../../utils/icons/Decision";

export const DIAGRAM_ROLE_ICONS: Readonly<
  Record<string, ComponentType<SvgIconProps>>
> = {
  GENERIC: CategoryOutlinedIcon,
  PERSON: PersonIcon,
  AGENT: PsychologyIcon,
  START: PlayCircleOutlineIcon,
  END: StopCircleOutlinedIcon,
  SOFTWARE_SYSTEM: HubIcon,
  CONTAINER: Inventory2Icon,
  COMPONENT: WidgetsIcon,
  CODE: CodeIcon,
  DATABASE: StorageIcon,
  UI: WebAssetIcon,
  UI_START: LoginIcon,
  PRODUCT: Inventory2Icon,
  DECISION: DecisionIcon,
  EXTERNAL_SYSTEM: CloudOutlinedIcon,
  DIAGRAM_REFERENCE: AccountTreeIcon,
};

export const getDiagramRoleIcon = (
  roleKey: string,
  notation?: DiagramElementRoleDefinition["notation"],
): ComponentType<SvgIconProps> => {
  const knownRoleIcon = DIAGRAM_ROLE_ICONS[roleKey];
  if (knownRoleIcon) return knownRoleIcon;

  switch (notation) {
    case "person":
      return PersonIcon;
    case "cylinder":
      return StorageIcon;
    case "diamond":
      return DecisionIcon;
    case "frame":
      return AccountTreeIcon;
    case "box":
    default:
      return CategoryOutlinedIcon;
  }
};

export const getDiagramRoleDefinitions = (
  definition?: WorkItemTypeDefinitionDto,
): DiagramElementRoleDefinition[] =>
  definition?.sections.find(
    (section) => section.key === "diagramElementMetadata",
  )?.diagramElementPolicy?.roles ?? [];
