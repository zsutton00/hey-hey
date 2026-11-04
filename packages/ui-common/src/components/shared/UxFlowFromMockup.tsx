import React, { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
  Skeleton,
} from "@mui/material";
import type { UxFlowMembership } from "../../api";
import { useUxFlowsForMockup } from "../../data/hooks/useUxFlowsForMockup";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { WorkflowGraphSurface } from "./WorkflowMentionInlineRenderer";

const DIAGRAM_ELEMENT_TYPE = "DIAGRAM_ELEMENT";

/** Loads a UX flow and opens its walkthrough on the chosen screen. */
const UxFlowDialog: React.FC<{
  organizationId: string;
  projectId: string;
  flow: UxFlowMembership;
  onClose: () => void;
}> = ({ organizationId, projectId, flow, onClose }) => {
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

  return (
    <Dialog open onClose={onClose} fullScreen>
      <DialogTitle>{flow.diagramName}</DialogTitle>
      <DialogContent dividers>
        {failed ? (
          <Alert severity="error" data-testid="ux-flow-from-mockup-unavailable">
            This UX flow is unavailable.
          </Alert>
        ) : !ready ? (
          <Skeleton height={240} data-testid="ux-flow-from-mockup-loading" />
        ) : (
          <WorkflowGraphSurface
            graphData={{
              workflow: aggregate.root,
              steps: aggregate.children.filter(
                (child) => child.type.toUpperCase() === DIAGRAM_ELEMENT_TYPE,
              ),
              edges: aggregate.relationships,
              participation: aggregate.participation,
              layout: aggregate.layout,
              workflowTypeDefinition: workflowType.workItemTypeDefinition,
              nodeTypeDefinition: elementType.workItemTypeDefinition,
            }}
            initialUxFlowStepId={flow.elementId}
          />
        )}
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
};

/**
 * Opens the UX flow a Mockup belongs to on this screen. With several flows the
 * person picks one; a Mockup in no flow renders nothing.
 */
export const OpenInUxFlowButton: React.FC<{
  organizationId: string;
  projectId: string;
  mockupId: string;
}> = ({ organizationId, projectId, mockupId }) => {
  const { flows } = useUxFlowsForMockup(organizationId, projectId, mockupId);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [openFlow, setOpenFlow] = useState<UxFlowMembership | null>(null);

  if (flows.length === 0) {
    return null;
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        data-testid="open-in-ux-flow"
        onClick={(event) =>
          flows.length === 1
            ? setOpenFlow(flows[0])
            : setMenuAnchor(event.currentTarget)
        }
      >
        Open in UX flow
      </Button>
      <Menu
        open={menuAnchor !== null}
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        {flows.map((flow) => (
          <MenuItem
            key={flow.diagramId}
            data-testid="ux-flow-choice"
            data-diagram-id={flow.diagramId}
            onClick={() => {
              setMenuAnchor(null);
              setOpenFlow(flow);
            }}
          >
            {flow.diagramName}
          </MenuItem>
        ))}
      </Menu>
      {openFlow ? (
        <UxFlowDialog
          organizationId={organizationId}
          projectId={projectId}
          flow={openFlow}
          onClose={() => setOpenFlow(null)}
        />
      ) : null}
    </>
  );
};
