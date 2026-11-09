import React, { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Box, Link, Skeleton, Stack } from "@mui/material";
import type { UxFlowMembership } from "../../api";
import { useUxFlowsForMockup } from "../../data/hooks/useUxFlowsForMockup";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { getPathService } from "../../services/webPathService";
import { EntityIcon } from "../Entity/EntityIcon";
import { WorkflowGraphSurface } from "./WorkflowMentionInlineRenderer";

const DIAGRAM_ELEMENT_TYPE = "DIAGRAM_ELEMENT";
const DIAGRAM_TYPE = "DIAGRAM";

/** Loads a UX flow and draws it on the shared flow surface. */
const UxFlowSurface: React.FC<{
  organizationId: string;
  projectId: string;
  flow: UxFlowMembership;
}> = ({ organizationId, projectId, flow }) => {
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
    return <Skeleton height={320} data-testid="ux-flow-from-mockup-loading" />;
  }

  return (
    <WorkflowGraphSurface
      graphData={graphData}
      organizationId={organizationId}
      projectId={projectId}
      currentUxFlowStepId={flow.elementId}
    />
  );
};

/**
 * Shows each UX flow a Mockup belongs to as its own block: the flow icon and
 * title (a link to the full flow) above a preview with this Mockup's screen
 * marked. A Mockup in no flow renders nothing.
 */
export const MockupUxFlows: React.FC<{
  organizationId: string;
  projectId: string;
  mockupId: string;
}> = ({ organizationId, projectId, mockupId }) => {
  const { flows } = useUxFlowsForMockup(organizationId, projectId, mockupId);
  const diagramType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    DIAGRAM_TYPE,
  );

  if (flows.length === 0) {
    return null;
  }

  return (
    <Stack spacing={3} data-testid="mockup-ux-flows">
      {flows.map((flow) => (
        <Box
          key={flow.diagramId}
          data-testid="mockup-ux-flow"
          data-diagram-id={flow.diagramId}
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <EntityIcon
              entityType={DIAGRAM_TYPE}
              workItemIcon={{
                typeKey: DIAGRAM_TYPE,
                definition: diagramType.workItemTypeDefinition,
              }}
              size={24}
            />
            <Link
              component={RouterLink}
              to={getPathService().task({
                projectId,
                taskId: flow.diagramId,
              })}
              variant="subtitle1"
              fontWeight={600}
              underline="hover"
              data-testid="ux-flow-title-link"
            >
              {flow.diagramName}
            </Link>
          </Stack>
          <UxFlowSurface
            organizationId={organizationId}
            projectId={projectId}
            flow={flow}
          />
        </Box>
      ))}
    </Stack>
  );
};
