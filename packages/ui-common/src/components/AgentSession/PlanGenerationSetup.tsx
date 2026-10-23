import { Alert, Button, LinearProgress, Stack } from "@mui/material";
import { getErrorMessage } from "../../utils/errorUtils";
import { PlanFromDesignDocPreStart } from "./PlanFromDesignDocPreStart";
import {
  usePlanGenerationDraft,
  type PlanGenerationDraftProps,
} from "./usePlanGenerationDraft";

/** The normal design-doc review gate also works before a session exists. */
export const PlanGenerationSetup = (props: PlanGenerationDraftProps) => {
  const { preStartProps, startError, document } = usePlanGenerationDraft(props);
  if (document.isLoading)
    return <LinearProgress aria-label="Loading Plan design doc" />;
  if (!document.isLoading && !document.seed) {
    return (
      <Alert
        severity="warning"
        data-testid="plan-generation-seed-unavailable"
        action={
          document.error ? (
            <Button
              color="inherit"
              onClick={() => {
                void document.retry();
              }}
            >
              Retry
            </Button>
          ) : undefined
        }
      >
        {document.error
          ? getErrorMessage(
              document.error,
              "Unable to load this Plan’s design doc."
            )
          : "No design doc is linked to this Plan. Open Documents to link one before generating."}
      </Alert>
    );
  }
  return (
    <Stack spacing={2} data-testid="plan-generation-setup">
      {startError && <Alert severity="error">{startError}</Alert>}
      <PlanFromDesignDocPreStart {...preStartProps} />
    </Stack>
  );
};
