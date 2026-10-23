import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import type { SvgIconProps } from "@mui/material";
import type { ComponentType } from "react";
import { AgentSessionType } from "../../api";
import { AgentSessionIcon } from "./AgentSession";

export const getAgentSessionIcon = (
  type?: AgentSessionType
): ComponentType<SvgIconProps> =>
  type === undefined || type === AgentSessionType.Coding
    ? AgentSessionIcon
    : ForumOutlinedIcon;
