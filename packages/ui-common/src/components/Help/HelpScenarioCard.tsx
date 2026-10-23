import OndemandVideoOutlinedIcon from "@mui/icons-material/OndemandVideoOutlined";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import React, { Fragment, useId, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import { HeyheyPairTerminalDemo } from "../Activity/HeyheyPairTerminalDemo";
import { InstallAgentBridgeTerminalDemo } from "../Activity/InstallAgentBridgeTerminalDemo";
import { WorksWithStrip } from "../Activity/WorksWithStrip";
import { useOptionalHelp } from "./HelpContext";
import type { HelpScenarioDisplayEntry } from "./helpContentTypes";
import type { ProjectFeatureNextStepKind } from "../../api";
import type {
  HelpScenarioCheckpoint,
  HelpScenarioCheckpointSlot,
  HelpScenarioCta,
  HelpScenarioFeatureNextStepsCopy,
  HelpScenarioTemplatedCopy,
} from "./helpScenarioCatalog";
import type {
  HelpActionsCapability,
  HelpFeatureNextStep,
  HelpFeatureRecord,
  HelpRoutingCapability,
} from "./helpCapabilities";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { helpImageUrlTransform } from "./helpContentSource";
import { SHOW_ME_HOW_ENABLED } from "./helpFeatureFlags";
import { useGuidedWalkthroughControls } from "../GuidedWalkthrough";
import { buildGuidedFirstStepsWalkthrough } from "./buildGuidedFirstStepsWalkthrough";

const renderTemplatedSummary = (
  templated: HelpScenarioTemplatedCopy,
  features: readonly HelpFeatureRecord[],
): React.ReactNode => {
  if (features.length === 0) {
    return templated.emptyState;
  }
  return (
    <>
      {templated.lead}{" "}
      {features.map((feature, index) => (
        <Fragment key={feature.id}>
          <Link href={feature.href} underline="hover">
            {feature.name}
          </Link>
          {index < features.length - 1 ? ", " : ""}
        </Fragment>
      ))}
      {templated.trail ? <>. {templated.trail}</> : null}
    </>
  );
};

const renderSummary = (
  scenario: HelpScenarioDisplayEntry,
  features: readonly HelpFeatureRecord[] | undefined,
): React.ReactNode => {
  if (scenario.templatedCopy && features) {
    return renderTemplatedSummary(scenario.templatedCopy, features);
  }
  return scenario.summary;
};

const renderCheckpointSlot = (
  slot: HelpScenarioCheckpointSlot,
): React.ReactNode => {
  switch (slot) {
    case "works-with-strip":
      return <WorksWithStrip />;
    case "install-terminal":
      return <InstallAgentBridgeTerminalDemo />;
    case "heyhey-pair-terminal":
      return <HeyheyPairTerminalDemo />;
    default: {
      const _exhaustive: never = slot;
      return _exhaustive;
    }
  }
};

const renderCta = (
  cta: HelpScenarioCta,
  routing: HelpRoutingCapability | null,
  actions: HelpActionsCapability | null,
): React.ReactNode => {
  if (cta.kind === "action") {
    const action = actions?.[cta.action];
    return (
      <Stack spacing={1}>
        <Button
          data-testid="help-scenario-action"
          variant="outlined"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          disabled={!action || action.status !== "ready"}
          onClick={action?.execute}
          aria-busy={action?.status === "pending"}
        >
          {cta.label}
        </Button>
        {action?.status === "loading" && (
          <Typography role="status" data-testid="help-action-loading">
            Checking existing imports…
          </Typography>
        )}
        {action?.status === "pending" && (
          <Typography role="status" data-testid="help-action-pending">
            Opening import…
          </Typography>
        )}
        {action?.status === "error" && (
          <Alert
            severity="error"
            data-testid="help-action-error"
            action={
              <Button data-testid="help-action-retry" onClick={action.retry}>
                Retry
              </Button>
            }
          >
            {action.error}
          </Alert>
        )}
      </Stack>
    );
  }
  if (cta.disabled) {
    return (
      <Button variant="contained" size="small" disabled>
        {cta.label}
      </Button>
    );
  }
  const href = routing ? routing.buildHref(cta.intent) : "#";
  return (
    <Button
      {...linkDestination(href)}
      variant="outlined"
      size="small"
      sx={{ alignSelf: "flex-start" }}
    >
      {cta.label}
    </Button>
  );
};

/** In-app paths route client-side; anything else stays a plain anchor. */
const linkDestination = (href: string) =>
  href.startsWith("/") && !href.startsWith("//")
    ? { component: RouterLink, to: href }
    : { component: "a" as const, href };

const NEXT_STEP_KIND_COLOR: Record<
  ProjectFeatureNextStepKind,
  "primary" | "secondary" | "success"
> = {
  TASKS: "primary",
  MOCKUPS: "secondary",
  DIAGRAM: "success",
};

const FeatureOverviewList: React.FC<{
  copy: HelpScenarioFeatureNextStepsCopy;
  features: readonly HelpFeatureRecord[];
  steps: readonly HelpFeatureNextStep[];
}> = ({ copy, features, steps }) => {
  const walkthroughs = useGuidedWalkthroughControls();
  if (features.length === 0) {
    return (
      <Typography variant="body1" color="text.secondary">
        {copy.emptyState}
      </Typography>
    );
  }
  const stepsByFeatureId = new Map(
    steps.map((step) => [step.feature.id, step]),
  );
  // Suggested features first (in suggestion order), then the rest.
  const ordered = [
    ...steps.map((step) => step.feature),
    ...features.filter((feature) => !stepsByFeatureId.has(feature.id)),
  ];
  return (
    <Stack spacing={1.5}>
      <Stack
        component="ul"
        spacing={1}
        data-testid="help-feature-overview-list"
        sx={{ listStyle: "none", m: 0, p: 0 }}
      >
        {ordered.map((feature) => {
          const step = stepsByFeatureId.get(feature.id);
          return (
            <Stack
              component="li"
              key={feature.id}
              direction="row"
              spacing={1.5}
              alignItems="center"
              data-testid={
                step ? "help-feature-next-step" : "help-feature-overview"
              }
              sx={{
                p: 1.5,
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Link
                    {...linkDestination(feature.href)}
                    underline="hover"
                    variant="subtitle2"
                    sx={{ fontWeight: 700 }}
                  >
                    {feature.name}
                  </Link>
                  {step ? (
                    <Chip
                      data-testid="help-feature-next-step-kind"
                      label={copy.kindLabels[step.kind]}
                      color={NEXT_STEP_KIND_COLOR[step.kind]}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  ) : null}
                </Stack>
                {feature.overview ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    data-testid="help-feature-overview-text"
                  >
                    {feature.overview}
                  </Typography>
                ) : null}
              </Box>
              {step ? (
                <Button
                  type="button"
                  data-testid="help-feature-next-step-start"
                  variant="contained"
                  size="small"
                  sx={{ flexShrink: 0 }}
                  disabled={walkthroughs === null}
                  onClick={() =>
                    walkthroughs?.startWalkthrough(
                      buildGuidedFirstStepsWalkthrough(step),
                    )
                  }
                >
                  {copy.startLabel.replace("{feature}", feature.name)}
                </Button>
              ) : null}
            </Stack>
          );
        })}
      </Stack>
      {steps.length > 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="help-feature-next-steps-invite"
        >
          {copy.invite}
        </Typography>
      ) : null}
    </Stack>
  );
};

const CheckpointEntry: React.FC<{
  checkpoint: HelpScenarioCheckpoint;
  routing: HelpRoutingCapability | null;
  actions: HelpActionsCapability | null;
}> = ({ checkpoint, routing, actions }) => (
  <Stack spacing={1} data-testid="help-scenario-checkpoint">
    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
      {checkpoint.title}
    </Typography>
    <Typography variant="body2" color="text.secondary">
      {checkpoint.body}
    </Typography>
    {checkpoint.slots?.map((slot) => (
      <React.Fragment key={slot}>{renderCheckpointSlot(slot)}</React.Fragment>
    )) ?? null}
    {checkpoint.command ? (
      <Box
        component="code"
        sx={{
          fontFamily: "monospace",
          bgcolor: "action.hover",
          px: 1,
          py: 0.5,
          borderRadius: 1,
          display: "inline-block",
          alignSelf: "flex-start",
          fontSize: "0.875rem",
        }}
      >
        {checkpoint.command}
      </Box>
    ) : null}
    {checkpoint.cta ? (
      <Box>{renderCta(checkpoint.cta, routing, actions)}</Box>
    ) : null}
  </Stack>
);

export interface HelpScenarioCardProps {
  scenario: HelpScenarioDisplayEntry;
  number?: number;
  features?: readonly HelpFeatureRecord[];
  featureNextSteps?: readonly HelpFeatureNextStep[];
  demo?: React.ReactNode;
  showDeepContent?: boolean;
  titleVariant?: "subtitle1" | "h6";
  titleComponent?: React.ElementType;
}

export const HelpScenarioCard: React.FC<HelpScenarioCardProps> = ({
  scenario,
  number,
  features,
  featureNextSteps,
  demo,
  showDeepContent = true,
  titleVariant = "subtitle1",
  titleComponent,
}) => {
  const help = useOptionalHelp();
  const routing = help?.routing ?? null;
  const checkpoints = scenario.checkpoints ?? [];
  const hasCheckpoints = checkpoints.length > 0;
  const [demoOpen, setDemoOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogTitleId = `${useId()}-demo-title`;
  const hasDemo =
    SHOW_ME_HOW_ENABLED &&
    Boolean(demo) &&
    scenario.callToAction?.kind !== "action";
  const closeDemo = (): void => setDemoOpen(false);
  const restoreTriggerFocus = (): void => {
    triggerRef.current?.focus({ preventScroll: true });
  };
  const body = (
    <Stack spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        data-testid="help-scenario-title"
        variant={titleVariant}
        {...(titleComponent ? { component: titleComponent } : {})}
        sx={{ fontWeight: 600 }}
      >
        {scenario.title}
      </Typography>
      {scenario.summary || scenario.templatedCopy ? (
        <Typography variant="body1" color="text.secondary" component="div">
          {renderSummary(scenario, features)}
        </Typography>
      ) : null}
      {scenario.featureNextSteps && features ? (
        <FeatureOverviewList
          copy={scenario.featureNextSteps}
          features={features}
          steps={featureNextSteps ?? []}
        />
      ) : null}
      {scenario.callToAction ? (
        <Box>
          {renderCta(scenario.callToAction, routing, help?.actions ?? null)}
        </Box>
      ) : null}
      {scenario.instructions && scenario.instructions.length > 0 ? (
        <Box component="ul" sx={{ my: 0, pl: 3 }}>
          {scenario.instructions.map((instruction, index) => (
            <Typography component="li" variant="body2" key={index}>
              {instruction}
            </Typography>
          ))}
        </Box>
      ) : null}
      {hasDemo ? (
        <>
          <Button
            ref={triggerRef}
            type="button"
            variant="outlined"
            size="small"
            startIcon={<OndemandVideoOutlinedIcon />}
            onClick={() => setDemoOpen(true)}
            sx={{ alignSelf: "flex-start" }}
          >
            Show me how
          </Button>
          <Dialog
            open={demoOpen}
            onClose={closeDemo}
            aria-labelledby={dialogTitleId}
            slotProps={{ transition: { onExited: restoreTriggerFocus } }}
            fullWidth
            maxWidth="md"
          >
            <DialogTitle id={dialogTitleId}>{scenario.title}</DialogTitle>
            <DialogContent>
              {demoOpen ? <Stack spacing={2}>{demo}</Stack> : null}
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={closeDemo}>
                Close
              </Button>
            </DialogActions>
          </Dialog>
        </>
      ) : null}
      {hasCheckpoints ? (
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {checkpoints.map((checkpoint, index) => (
            <CheckpointEntry
              key={`${checkpoint.title}-${index}`}
              checkpoint={checkpoint}
              routing={routing}
              actions={help?.actions ?? null}
            />
          ))}
        </Stack>
      ) : showDeepContent && scenario.deepContent ? (
        <MarkdownRenderer urlTransform={helpImageUrlTransform}>
          {scenario.deepContent}
        </MarkdownRenderer>
      ) : null}
    </Stack>
  );

  if (number === undefined) {
    return body;
  }

  return (
    <Stack direction="row" spacing={2} alignItems="flex-start">
      <Avatar
        sx={{
          width: 32,
          height: 32,
          bgcolor: "action.selected",
          color: "text.primary",
          fontSize: "0.95rem",
          fontWeight: 600,
        }}
      >
        {number}
      </Avatar>
      {body}
    </Stack>
  );
};
