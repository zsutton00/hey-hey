import { Stack } from "@mui/material";
import React from "react";

import {
  EXISTING_WORK_WELCOME_CATALOG,
  getFeatureDiscoveryWelcomeCatalog,
} from "./helpScenarioCatalog";
import { useHelp } from "./HelpContext";
import { HELP_DEMO_FALLBACK } from "./helpCapabilities";
import type { HelpDemoFallback, PlatformDemo } from "./helpCapabilities";
import { HelpScenarioCard } from "./HelpScenarioCard";

const renderDemo = (demo: PlatformDemo | HelpDemoFallback): React.ReactNode => {
  if (demo === HELP_DEMO_FALLBACK) {
    return null;
  }
  return demo as React.ReactNode;
};

export type IntroHelpViewVariant = "generic" | "existing-work";

export interface IntroHelpViewProps {
  variant?: IntroHelpViewVariant;
}

export const IntroHelpView: React.FC<IntroHelpViewProps> = ({
  variant = "generic",
}) => {
  const { data, demos } = useHelp();
  const featureNextSteps = data.featureNextSteps ?? [];
  const scenarios =
    variant === "existing-work"
      ? EXISTING_WORK_WELCOME_CATALOG
      : getFeatureDiscoveryWelcomeCatalog();

  return (
    <Stack
      spacing={3.5}
      sx={{ py: 2, maxWidth: 1280 }}
      data-testid="intro-help-view"
    >
      {scenarios.map((scenario, index) => (
        <HelpScenarioCard
          key={scenario.id}
          scenario={scenario}
          number={index + 1}
          features={data.features}
          featureNextSteps={featureNextSteps}
          demo={renderDemo(demos[scenario.id])}
          showDeepContent={false}
        />
      ))}
    </Stack>
  );
};
