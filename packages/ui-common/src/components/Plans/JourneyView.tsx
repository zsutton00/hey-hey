import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { JourneyMap, JourneyStep, ServiceNote } from "../../api";
import { PLAN_PROPOSAL_BORDER } from "../ProposalDispatchers/proposalRenderOverrides";

export interface JourneyViewProps {
  journeyMap: JourneyMap;
}

const JourneyStepCard: React.FC<{ step: JourneyStep }> = ({ step }) => (
  <Paper
    data-testid={`journey-step-card-${step.id}`}
    elevation={0}
    variant="outlined"
    sx={{
      p: 2,
      width: 280,
      minWidth: 280,
      display: "flex",
      flexDirection: "column",
      gap: 1.25,
      border: PLAN_PROPOSAL_BORDER,
    }}
  >
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
        {step.title}
      </Typography>
      {step.isUserInteractive && (
        <Chip
          data-testid={`journey-step-validation-badge-${step.id}`}
          label="Validation"
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
    </Stack>
    <Typography variant="body2" color="text.secondary">
      {step.description}
    </Typography>
    {step.implementationNotes.length > 0 && (
      <Box
        component="ul"
        sx={{
          listStyle: "disc",
          pl: 2.5,
          m: 0,
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
        }}
      >
        {step.implementationNotes.map((note, index) => (
          <ImplementationNoteBullet
            key={`${step.id}-note-${index}`}
            note={note}
          />
        ))}
      </Box>
    )}
  </Paper>
);

const ImplementationNoteBullet: React.FC<{ note: ServiceNote }> = ({
  note,
}) => (
  <Box component="li">
    <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
      <Typography variant="body2" sx={{ flex: 1 }}>
        {note.text}
      </Typography>
      {note.serviceName !== null && (
        <Chip
          label={note.serviceName}
          size="small"
          variant="outlined"
          sx={{ height: 20 }}
        />
      )}
    </Stack>
  </Box>
);

const JourneyConnector: React.FC = () => (
  <Box
    data-testid="journey-connector"
    aria-hidden="true"
    sx={{
      display: "flex",
      alignItems: "center",
      color: "text.disabled",
      flexShrink: 0,
    }}
  >
    <ChevronRightIcon fontSize="medium" />
  </Box>
);

export const JourneyView: React.FC<JourneyViewProps> = ({ journeyMap }) => (
  <Stack
    data-testid="journey-view"
    direction="row"
    spacing={0}
    alignItems="stretch"
    sx={{
      overflowX: "auto",
      py: 1,
      gap: 1.5,
    }}
  >
    {journeyMap.steps.map((step, index) => (
      <React.Fragment key={step.id}>
        <JourneyStepCard step={step} />
        {index < journeyMap.steps.length - 1 && <JourneyConnector />}
      </React.Fragment>
    ))}
  </Stack>
);
