import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Step,
  StepButton,
  Stepper,
} from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { AnimatePresence, motion } from "motion/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ProposalAction,
  ProposalStatus,
  type ProposalResponseDto,
} from "../../api";
import { shouldReduceMotion, transitions } from "../../animations/variants";
import type { ProposalItemStatus } from "./types";

import { ProposalTitle } from "./ProposalTitle";
import { staticProposalEntityTypePresentation } from "./proposalHeaderType";

export type ProposalLifecycle =
  "pending" | "applying" | "applied" | "approved" | "rejected" | "failed";

export function deriveProposalLifecycle(
  proposal: ProposalResponseDto,
  itemState: ProposalItemStatus,
): ProposalLifecycle {
  if (proposal.action === ProposalAction.VersionedUpdate) {
    if (itemState.state === "applying") return "applying";
    if (itemState.state === "failed") return "failed";
    if (
      itemState.state === "rejected" ||
      proposal.status === ProposalStatus.Rejected
    ) {
      return "rejected";
    }
    if (proposal.reviewedFuture?.outcome === "APPLIED") return "applied";
    if (
      itemState.state === "applied" ||
      proposal.status === ProposalStatus.Approved
    ) {
      return "approved";
    }
    return "pending";
  }

  if (itemState.state === "applying") return "applying";
  if (itemState.state === "failed") return "failed";
  if (itemState.state === "applied") return "applied";
  if (itemState.state === "rejected") return "rejected";
  if (proposal.status === ProposalStatus.Approved) return "applied";
  if (proposal.status === ProposalStatus.Rejected) return "rejected";
  return "pending";
}

const isResolved = (lifecycle: ProposalLifecycle): boolean =>
  lifecycle === "applied" ||
  lifecycle === "approved" ||
  lifecycle === "rejected";

const stepMotionOffset = shouldReduceMotion() ? 0 : 30;

const stepContentVariants = {
  enter: (direction: number) => ({
    x: direction * stepMotionOffset,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction * -stepMotionOffset,
    opacity: 0,
  }),
};

export interface ProposalStepperProps {
  proposals: ProposalResponseDto[];
  getItemState: (id: string) => ProposalItemStatus;
  onApply: (id: string) => void;
  renderProposal: (proposal: ProposalResponseDto) => React.ReactNode;
  getStepMetadata?: (
    proposal: ProposalResponseDto,
    index: number,
  ) => React.ReactNode;
  hideHeaderMetadata?: boolean;
  disabled?: boolean;
}

const STATUS_DOT_SIZE = 28;

const StatusDot: React.FC<{
  index: number;
  lifecycle: ProposalLifecycle;
  active: boolean;
}> = ({ index, lifecycle, active }) => {
  const baseSx = {
    width: STATUS_DOT_SIZE,
    height: STATUS_DOT_SIZE,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: 600,
    border: "2px solid",
    borderColor: active ? "primary.main" : "divider",
    color: active ? "primary.main" : "text.secondary",
    bgcolor: "background.paper",
  };

  if (lifecycle === "applied") {
    return (
      <Box
        data-testid={`proposal-stepper-dot-${index}`}
        data-lifecycle="applied"
        sx={{ ...baseSx, borderColor: "success.main", color: "success.main" }}
      >
        <CheckCircleIcon fontSize="small" />
      </Box>
    );
  }
  if (lifecycle === "approved") {
    return (
      <Box
        data-testid={`proposal-stepper-dot-${index}`}
        data-lifecycle="approved"
        aria-label="Approved, not applied"
        title="Approved, not applied"
        sx={{ ...baseSx, borderColor: "info.main", color: "info.main" }}
      >
        <CheckCircleIcon fontSize="small" />
      </Box>
    );
  }
  if (lifecycle === "rejected") {
    return (
      <Box
        data-testid={`proposal-stepper-dot-${index}`}
        data-lifecycle="rejected"
        sx={{ ...baseSx, borderColor: "error.main", color: "error.main" }}
      >
        <BlockIcon fontSize="small" />
      </Box>
    );
  }
  if (lifecycle === "failed") {
    return (
      <Box
        data-testid={`proposal-stepper-dot-${index}`}
        data-lifecycle="failed"
        sx={{ ...baseSx, borderColor: "error.main", color: "error.main" }}
      >
        <ErrorOutlineIcon fontSize="small" />
      </Box>
    );
  }
  if (lifecycle === "applying") {
    return (
      <Box
        data-testid={`proposal-stepper-dot-${index}`}
        data-lifecycle="applying"
        sx={baseSx}
      >
        <CircularProgress size={14} />
      </Box>
    );
  }
  return (
    <Box
      data-testid={`proposal-stepper-dot-${index}`}
      data-lifecycle="pending"
      sx={baseSx}
    >
      {index + 1}
    </Box>
  );
};

export const ProposalStepper: React.FC<ProposalStepperProps> = ({
  proposals,
  getItemState,
  renderProposal,
  getStepMetadata,
  hideHeaderMetadata = false,
  disabled,
}) => {
  // Computed fresh each render so updates inside `getItemState`'s closure are
  // reflected without needing a ref-equality change. The downstream effect is
  // keyed off a stable string snapshot to avoid running on every render.
  const lifecycles = proposals.map((p) =>
    deriveProposalLifecycle(p, getItemState(p.id)),
  );
  const lifecyclesKey = JSON.stringify(
    proposals.map((proposal, index) => [proposal.id, lifecycles[index]]),
  );

  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const idx = lifecycles.findIndex((lc) => !isResolved(lc));
    return idx === -1 ? 0 : idx;
  });

  const previousLifecyclesRef = useRef(
    new Map(
      proposals.map(
        (proposal, index) => [proposal.id, lifecycles[index]] as const,
      ),
    ),
  );
  const directionRef = useRef<number>(1);

  const navigateTo = useCallback((next: number) => {
    setActiveIndex((prev) => {
      directionRef.current = next >= prev ? 1 : -1;
      return next;
    });
  }, []);

  useEffect(() => {
    const currentProposal = proposals[activeIndex];
    const currentLc = lifecycles[activeIndex];
    const previousLc = currentProposal
      ? previousLifecyclesRef.current.get(currentProposal.id)
      : undefined;
    previousLifecyclesRef.current = new Map(
      proposals.map(
        (proposal, index) => [proposal.id, lifecycles[index]] as const,
      ),
    );
    if (
      !currentLc ||
      !previousLc ||
      isResolved(previousLc) ||
      !isResolved(currentLc)
    ) {
      return;
    }

    const nextAfter = lifecycles.findIndex(
      (lc, i) => i > activeIndex && !isResolved(lc),
    );
    if (nextAfter !== -1) {
      directionRef.current = 1;
      setActiveIndex(nextAfter);
      return;
    }
    const firstPending = lifecycles.findIndex((lc) => !isResolved(lc));
    if (firstPending !== -1 && firstPending !== activeIndex) {
      directionRef.current = firstPending > activeIndex ? 1 : -1;
      setActiveIndex(firstPending);
    }
    // lifecycles is reconstructed each render; lifecyclesKey is its stable
    // identity. eslint can't see that — disabling the deps check on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecyclesKey, activeIndex]);

  const safeActiveIndex = Math.min(activeIndex, proposals.length - 1);
  const activeProposal = proposals[safeActiveIndex];
  const isFirst = safeActiveIndex <= 0;
  const isLast = safeActiveIndex >= proposals.length - 1;

  const stepperMinWidth = Math.max(320, proposals.length * 160);

  return (
    <Stack spacing={3}>
      <Box sx={{ pb: 1, overflowX: "auto", pt: 10 }}>
        <Stepper
          activeStep={safeActiveIndex}
          alternativeLabel
          nonLinear
          sx={{
            minWidth: stepperMinWidth,
            // marginTop: 4,
            overflow: "hidden",
            "& .MuiStepLabel-label": {
              minWidth: 0,
              whiteSpace: "nowrap",
              textAlign: "center",
            },
            "& .MuiStepLabel-labelContainer": {
              maxWidth: 160,
              minWidth: 0,
            },
          }}
        >
          {proposals.map((p, i) => {
            const active = i === safeActiveIndex;
            return (
              <Step key={p.id}>
                <StepButton
                  onClick={() => navigateTo(i)}
                  icon={
                    <StatusDot
                      index={i}
                      lifecycle={lifecycles[i]}
                      active={active}
                    />
                  }
                >
                  <Stack alignItems="center" spacing={0.25}>
                    <ProposalTitle
                      proposal={p}
                      typePresentation={staticProposalEntityTypePresentation(
                        p.targetEntityType,
                      )}
                      hideHeaderMetadata={hideHeaderMetadata}
                      hideTypeChip
                      titleSx={{
                        display: "block",
                        font: "inherit",
                        minWidth: 0,
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        "& > .MuiTypography-root": {
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        },
                      }}
                    />
                    {getStepMetadata?.(p, i)}
                  </Stack>
                </StepButton>
              </Step>
            );
          })}
        </Stepper>
      </Box>

      <AnimatePresence mode="wait" custom={directionRef.current}>
        {activeProposal && (
          <motion.div
            key={activeProposal.id}
            custom={directionRef.current}
            variants={stepContentVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transitions.medium}
          >
            {renderProposal(activeProposal)}
          </motion.div>
        )}
      </AnimatePresence>

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Button
          variant="text"
          size="small"
          type="button"
          disabled={disabled || isFirst}
          onClick={() => navigateTo(safeActiveIndex - 1)}
        >
          Previous
        </Button>
        <Button
          variant="text"
          size="small"
          type="button"
          disabled={disabled || isLast}
          onClick={() => navigateTo(safeActiveIndex + 1)}
        >
          Next
        </Button>
      </Box>
    </Stack>
  );
};
