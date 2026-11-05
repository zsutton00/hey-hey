import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Link,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import type { UxFlowMembership } from "../../api";
import { useUxFlowsForMockup } from "../../data/hooks/useUxFlowsForMockup";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { WorkflowGraphSurface } from "./WorkflowMentionInlineRenderer";

const DIAGRAM_ELEMENT_TYPE = "DIAGRAM_ELEMENT";

type FlowSurfaceMode =
  | { kind: "walkthrough"; elementId: string }
  | { kind: "preview"; elementId: string };

/** Loads a UX flow and draws it on the shared flow surface. */
const UxFlowSurface: React.FC<{
  organizationId: string;
  projectId: string;
  flow: UxFlowMembership;
  mode: FlowSurfaceMode;
  skeletonHeight: number;
}> = ({ organizationId, projectId, flow, mode, skeletonHeight }) => {
  const graph = useWorkItemGraph(organizationId, projectId, flow.diagramId, {
    incidentRelationshipTypes: ["GUARANTEES", "IMPLEMENTS", "CONSUMES"],
  });
  const workflowType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    graph.data?.root.type,
  );
  const elementType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    DIAGRAM_ELEMENT_TYPE,
  );
  const aggregate = graph.data;
  const failed = graph.error || workflowType.error || elementType.error;
  const ready =
    aggregate && workflowType.isFetched && elementType.isFetched && !failed;
  const workflowTypeDefinition = workflowType.workItemTypeDefinition;
  const nodeTypeDefinition = elementType.workItemTypeDefinition;
  const graphData = useMemo(
    () =>
      ready
        ? {
            workflow: aggregate.root,
            steps: aggregate.children.filter(
              (child) => child.type.toUpperCase() === DIAGRAM_ELEMENT_TYPE,
            ),
            edges: aggregate.relationships,
            participation: aggregate.participation,
            layout: aggregate.layout,
            workflowTypeDefinition,
            nodeTypeDefinition,
          }
        : undefined,
    [ready, aggregate, workflowTypeDefinition, nodeTypeDefinition],
  );

  if (failed) {
    return (
      <Alert severity="error" data-testid="ux-flow-from-mockup-unavailable">
        This UX flow is unavailable.
      </Alert>
    );
  }
  if (!graphData) {
    return (
      <Skeleton
        height={skeletonHeight}
        data-testid="ux-flow-from-mockup-loading"
      />
    );
  }

  return (
    <WorkflowGraphSurface
      graphData={graphData}
      organizationId={organizationId}
      projectId={projectId}
      {...(mode.kind === "walkthrough"
        ? { initialUxFlowStepId: mode.elementId }
        : { currentUxFlowStepId: mode.elementId })}
    />
  );
};

/** Opens a UX flow full screen on the chosen screen. */
const UxFlowDialog: React.FC<{
  organizationId: string;
  projectId: string;
  flow: UxFlowMembership;
  onClose: () => void;
}> = ({ organizationId, projectId, flow, onClose }) => (
  <Dialog open onClose={onClose} fullScreen>
    <DialogTitle>{flow.diagramName}</DialogTitle>
    <DialogContent dividers>
      <UxFlowSurface
        organizationId={organizationId}
        projectId={projectId}
        flow={flow}
        mode={{ kind: "walkthrough", elementId: flow.elementId }}
        skeletonHeight={240}
      />
    </DialogContent>
    <Button
      onClick={onClose}
      data-testid="ux-flow-from-mockup-close"
      sx={{ m: 1, alignSelf: "flex-end" }}
    >
      Close
    </Button>
  </Dialog>
);

/**
 * Shows each UX flow a Mockup belongs to as its own titled block, with the
 * Mockup's screen marked and a link that opens the full flow. A Mockup in no
 * flow renders nothing.
 */
export const MockupUxFlows: React.FC<{
  organizationId: string;
  projectId: string;
  mockupId: string;
}> = ({ organizationId, projectId, mockupId }) => {
  const { flows } = useUxFlowsForMockup(organizationId, projectId, mockupId);
  const [openFlow, setOpenFlow] = useState<UxFlowMembership | null>(null);
  const handleCloseFlow = useCallback(() => setOpenFlow(null), []);

  if (flows.length === 0) {
    return null;
  }

  return (
    <Stack spacing={3} data-testid="mockup-ux-flows">
      <Typography variant="subtitle1" fontWeight={600}>
        {flows.length === 1
          ? `Part of UX flow: ${flows[0].diagramName}`
          : `Part of ${flows.length} UX flows`}
      </Typography>
      {flows.map((flow) => (
        <Box
          key={flow.diagramId}
          data-testid="mockup-ux-flow"
          data-diagram-id={flow.diagramId}
        >
          {flows.length > 1 ? (
            <Typography variant="subtitle2" gutterBottom>
              {flow.diagramName}
            </Typography>
          ) : null}
          <UxFlowSurface
            organizationId={organizationId}
            projectId={projectId}
            flow={flow}
            mode={{ kind: "preview", elementId: flow.elementId }}
            skeletonHeight={320}
          />
          <Link
            component="button"
            type="button"
            underline="hover"
            data-testid="open-ux-flow"
            data-diagram-id={flow.diagramId}
            onClick={() => setOpenFlow(flow)}
            sx={{ mt: 1 }}
          >
            Open flow →
          </Link>
        </Box>
      ))}
      {openFlow ? (
        <UxFlowDialog
          organizationId={organizationId}
          projectId={projectId}
          flow={openFlow}
          onClose={handleCloseFlow}
        />
      ) : null}
    </Stack>
  );
};
