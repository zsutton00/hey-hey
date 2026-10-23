import React from "react";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import ViewModuleOutlinedIcon from "@mui/icons-material/ViewModuleOutlined";
import { Box, Stack, Typography } from "@mui/material";

import {
  MINI_DEMO_TARGETS,
  type MiniDemoScene,
  type MiniDemoTargetId,
} from "./types";

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
const SIDEBAR_WIDTH = 240;
export const MINI_DEMO_PRESET_KEYS = {
  featuresNav: "features-nav",
} as const;

export type MiniDemoPresetKey =
  (typeof MINI_DEMO_PRESET_KEYS)[keyof typeof MINI_DEMO_PRESET_KEYS];

export type MiniDemoSceneBuilder = () => MiniDemoScene[];

const element = React.createElement;

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  highlighted?: boolean;
  active?: boolean;
  targetId?: MiniDemoTargetId;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  icon,
  label,
  highlighted,
  active,
  targetId,
}) =>
  targetId
    ? element(
        "a",
        {
          href: "/features",
          "aria-label": label,
          "data-demo-target": targetId,
          style: { display: "block", textDecoration: "none" },
        },
        element(
          Stack,
          {
            direction: "row",
            alignItems: "center",
            spacing: 1.5,
            sx: {
              px: 2,
              py: 1.25,
              borderRadius: 1,
              mx: 1,
              backgroundColor: active
                ? "primary.main"
                : highlighted
                ? "action.hover"
                : "transparent",
              color: active ? "primary.contrastText" : "text.primary",
              fontWeight: active || highlighted ? 600 : 400,
            },
          },
          element(Box, { sx: { display: "flex", color: "inherit" } }, icon),
          element(
            Typography,
            {
              variant: "body1",
              sx: { color: "inherit", fontWeight: "inherit" },
            },
            label
          )
        )
      )
    : element(
        Stack,
        {
          direction: "row",
          alignItems: "center",
          spacing: 1.5,
          sx: {
            px: 2,
            py: 1.25,
            borderRadius: 1,
            mx: 1,
            backgroundColor: active
              ? "primary.main"
              : highlighted
              ? "action.hover"
              : "transparent",
            color: active ? "primary.contrastText" : "text.primary",
            fontWeight: active || highlighted ? 600 : 400,
          },
        },
        element(Box, { sx: { display: "flex", color: "inherit" } }, icon),
        element(
          Typography,
          { variant: "body1", sx: { color: "inherit", fontWeight: "inherit" } },
          label
        )
      );

const FauxSidebar: React.FC<{ activeLabel?: string }> = ({ activeLabel }) =>
  element(
    Box,
    {
      sx: {
        width: SIDEBAR_WIDTH,
        height: "100%",
        backgroundColor: "background.default",
        borderRight: 1,
        borderColor: "divider",
        pt: 4,
      },
    },
    element(
      Stack,
      { spacing: 0.5 },
      element(SidebarItem, {
        icon: element(HomeOutlinedIcon),
        label: "Overview",
        active: activeLabel === "Overview",
      }),
      element(SidebarItem, {
        icon: element(ViewModuleOutlinedIcon),
        label: "Features",
        active: activeLabel === "Features",
        targetId: MINI_DEMO_TARGETS.featuresNavLink,
      }),
      element(SidebarItem, {
        icon: element(StorageOutlinedIcon),
        label: "Services",
        active: activeLabel === "Services",
      }),
      element(SidebarItem, {
        icon: element(PeopleOutlineIcon),
        label: "Members",
        active: activeLabel === "Members",
      })
    )
  );

interface FauxFeatureCardProps {
  title: string;
  body: string;
}

const FauxFeatureCard: React.FC<FauxFeatureCardProps> = ({ title, body }) =>
  element(
    Box,
    {
      sx: {
        p: 3,
        borderRadius: 1,
        border: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
      },
    },
    element(Typography, { variant: "h6", sx: { mb: 1 } }, title),
    element(Typography, { variant: "body2", color: "text.secondary" }, body)
  );

const BriefingScene: React.FC = () =>
  element(
    "div",
    {
      "data-demo-scene": "briefing",
      style: {
        display: "flex",
        width: SCENE_WIDTH,
        height: SCENE_HEIGHT,
      },
    },
    element(FauxSidebar),
    element(
      Box,
      { sx: { flex: 1, p: 6 } },
      element(
        Typography,
        { variant: "h3", sx: { mb: 2 } },
        "Welcome to Hey Hey"
      ),
      element(
        Typography,
        { variant: "h6", color: "text.secondary", sx: { mb: 4 } },
        "Set up your project in a few short steps."
      ),
      element(
        Stack,
        { spacing: 3, sx: { maxWidth: 720 } },
        element(FauxFeatureCard, {
          title: "Features",
          body: "Features describe what your project delivers — the outcomes, not the work.",
        }),
        element(FauxFeatureCard, {
          title: "Services",
          body: "Services are the codebases the agent will work in.",
        })
      )
    )
  );

const FeaturesPageScene: React.FC = () =>
  element(
    "div",
    {
      "data-demo-scene": "features-page",
      style: {
        display: "flex",
        width: SCENE_WIDTH,
        height: SCENE_HEIGHT,
      },
    },
    element(FauxSidebar, { activeLabel: "Features" }),
    element(
      Box,
      { sx: { flex: 1, p: 6 } },
      element(Typography, { variant: "h3", sx: { mb: 1 } }, "Features"),
      element(
        Typography,
        { variant: "body1", color: "text.secondary", sx: { mb: 4 } },
        "Define what your project delivers. Tasks live under each feature."
      ),
      element(
        Stack,
        { spacing: 2, sx: { maxWidth: 800 } },
        element(FauxFeatureCard, {
          title: "Authentication",
          body: "Sign up, sign in, password reset, and SSO.",
        }),
        element(FauxFeatureCard, {
          title: "Project dashboard",
          body: "At-a-glance status across initiatives, features, and tasks.",
        }),
        element(FauxFeatureCard, {
          title: "Notifications",
          body: "In-app and email alerts when something needs attention.",
        })
      )
    )
  );

const buildFeaturesNavScenes = (): MiniDemoScene[] => [
  {
    id: "briefing",
    targetId: MINI_DEMO_TARGETS.featuresNavLink,
    content: element(BriefingScene),
    durationMs: 2800,
    cursor: [
      { t: 0, x: 920, y: 540 },
      { t: 1800, target: MINI_DEMO_TARGETS.featuresNavLink },
      { t: 2200, target: MINI_DEMO_TARGETS.featuresNavLink, click: true },
      { t: 2800, target: MINI_DEMO_TARGETS.featuresNavLink },
    ],
  },
  {
    id: "features-page",
    content: element(FeaturesPageScene),
    durationMs: 2400,
  },
];

export const miniDemoPresetRegistry = {
  [MINI_DEMO_PRESET_KEYS.featuresNav]: buildFeaturesNavScenes,
} satisfies Record<MiniDemoPresetKey, MiniDemoSceneBuilder>;

const isMiniDemoPresetKey = (key: string): key is MiniDemoPresetKey =>
  Object.prototype.hasOwnProperty.call(miniDemoPresetRegistry, key);

export const resolvePreset = (key: string): MiniDemoScene[] => {
  if (!isMiniDemoPresetKey(key)) {
    const knownKeys = Object.keys(miniDemoPresetRegistry).join(", ");
    throw new Error(
      `Unknown mini-demo preset key "${key}". Known keys: ${knownKeys}.`
    );
  }

  return miniDemoPresetRegistry[key]();
};
