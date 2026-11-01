import { ANNOTATION_COLORS } from "../../utils/annotationColors";
import EditIcon from "@mui/icons-material/Edit";
import { Button, Tooltip } from "@mui/material";
import React from "react";
import {
  buildMockupPageUrl,
  type MockupPageSource,
} from "../../utils/mockupPageUrl";
import { resolveLocalDirectoryRuntimeBaseUrl } from "../AgentSession/runtime/directoryBindingApi";
import { useRunBrowserOpener } from "../AgentSession/runtime/hooks/useRunBrowserOpener";
import {
  useRunBrowserContext,
  type RunBrowserContextValue,
} from "../AgentSession/runtime/RunBrowserContext";

export interface MockupBrowserPencilProps {
  /** Where the mockup comes from; absent when there is no page to serve. */
  source: MockupPageSource | undefined;
  organizationId: string | undefined;
  projectId: string | undefined;
  /** The size currently shown. */
  sizeKey: string;
}

interface PencilButtonProps {
  run: RunBrowserContextValue;
  source: MockupPageSource;
  organizationId: string;
  projectId: string;
  sizeKey: string;
}

const PencilButton: React.FC<PencilButtonProps> = ({
  run,
  source,
  organizationId,
  projectId,
  sizeKey,
}) => {
  const { localCli, opening, failure, blockedReason, open } =
    useRunBrowserOpener(run.runId, run.sessionMachineId);
  const reason =
    blockedReason ??
    failure?.reason ??
    "Open this mockup in the Run's browser to annotate it";
  return (
    <Tooltip title={reason}>
      <span>
        <Button
          size="small"
          variant="contained"
          startIcon={<EditIcon fontSize="small" />}
          aria-label="Open mockup in Run browser"
          data-testid="html-css-open-in-browser"
          disabled={
            blockedReason !== null || localCli.status === "checking" || opening
          }
          sx={{
            borderRadius: 999,
            textTransform: "none",
            fontWeight: 600,
            boxShadow: 3,
            bgcolor: ANNOTATION_COLORS.main,
            color: ANNOTATION_COLORS.contrastText,
            "&:hover": { bgcolor: ANNOTATION_COLORS.hover },
          }}
          onClick={() =>
            void open(
              buildMockupPageUrl({
                baseUrl: resolveLocalDirectoryRuntimeBaseUrl(),
                source,
                organizationId,
                projectId,
                sizeKey,
              }),
            )
          }
        >
          Annotate
        </Button>
      </span>
    </Tooltip>
  );
};

/**
 * Opens a mockup — of a work item or as a proposal holds it — at the size shown,
 * as a page in the browser tab of the Run the viewer is working in. Renders
 * nothing outside a Run context or without a source (no page to serve).
 */
export const MockupBrowserPencil: React.FC<MockupBrowserPencilProps> = ({
  source,
  organizationId,
  projectId,
  sizeKey,
}) => {
  const run = useRunBrowserContext();
  if (!run || !source || !organizationId || !projectId) return null;
  return (
    <PencilButton
      run={run}
      source={source}
      organizationId={organizationId}
      projectId={projectId}
      sizeKey={sizeKey}
    />
  );
};
