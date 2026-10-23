import { Chip, Stack, Typography } from "@mui/material";
import React from "react";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import type {
  CodingResearchFrameEdge,
  CodingResearchFrameModel,
  CodingResearchFrameNode,
} from "./codingResearchReportModel";
import {
  ReportEntityMention,
  ReportItemCard,
  ReportPanel,
} from "./reportPrimitives";

export interface CodingResearchFrameSectionProps {
  frameModel: CodingResearchFrameModel;
  reportTestId: string;
}

export const CodingResearchFrameSection: React.FC<
  CodingResearchFrameSectionProps
> = ({ frameModel, reportTestId }) => {
  const testId = `${reportTestId}-coding-research-frame`;

  if (frameModel.state === "unavailable") {
    return (
      <ReportPanel testId={testId} title="Research frame">
        <Typography
          color="error"
          data-testid={`${testId}-unavailable`}
          variant="body2"
        >
          Research frame data is unavailable.
        </Typography>
      </ReportPanel>
    );
  }

  const { focalId, nodes } = frameModel.frame;

  return (
    <ReportPanel
      emptyMessage="No research frame nodes recorded."
      isEmpty={nodes.length === 0}
      testId={testId}
      title="Research frame"
    >
      <Stack data-testid={`${testId}-nodes`} spacing={1}>
        {nodes.map((node, index) => (
          <FrameNodeCard
            focalId={focalId}
            key={node.id}
            node={node}
            nodes={nodes}
            testIdPrefix={`${testId}-node-${index}`}
          />
        ))}
      </Stack>
    </ReportPanel>
  );
};

interface FrameNodeCardProps {
  focalId: string;
  node: CodingResearchFrameNode;
  nodes: CodingResearchFrameNode[];
  testIdPrefix: string;
}

const FrameNodeCard: React.FC<FrameNodeCardProps> = ({
  focalId,
  node,
  nodes,
  testIdPrefix,
}) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={<FrameEntityLink node={node} testId={`${testIdPrefix}-title`} />}
    trailing={
      <Stack
        data-testid={`${testIdPrefix}-metadata`}
        direction="row"
        flexWrap="wrap"
        sx={{ gap: 0.5 }}
      >
        {node.id === focalId ? (
          <Chip color="primary" label="Focal" size="small" />
        ) : null}
        <Chip
          data-testid={`${testIdPrefix}-type`}
          label={node.type}
          size="small"
          variant="outlined"
        />
        <Chip
          data-testid={`${testIdPrefix}-content-source`}
          label={CONTENT_SOURCE_LABELS[node.contentSource]}
          size="small"
          variant="outlined"
        />
      </Stack>
    }
  >
    <Typography data-testid={`${testIdPrefix}-content`} variant="body2">
      {renderInlineMentions(node.content, "minimal")}
    </Typography>
    <OutgoingEdges
      edges={node.edges}
      nodes={nodes}
      testIdPrefix={testIdPrefix}
    />
  </ReportItemCard>
);

const CONTENT_SOURCE_LABELS: Record<
  CodingResearchFrameNode["contentSource"],
  string
> = {
  original: "Original",
  extracted: "Extracted",
  summarized: "Summarized",
};

interface FrameEntityLinkProps {
  node: CodingResearchFrameNode;
  testId: string;
}

const FrameEntityLink: React.FC<FrameEntityLinkProps> = ({ node, testId }) => (
  <Stack data-testid={testId} direction="row">
    <ReportEntityMention
      entityId={node.id}
      entityName={node.title}
      entityType={node.type}
    />
  </Stack>
);

interface OutgoingEdgesProps {
  edges: CodingResearchFrameEdge[];
  nodes: CodingResearchFrameNode[];
  testIdPrefix: string;
}

const OutgoingEdges: React.FC<OutgoingEdgesProps> = ({
  edges,
  nodes,
  testIdPrefix,
}) => (
  <Stack data-testid={`${testIdPrefix}-edges`} spacing={0.75}>
    <Typography color="text.secondary" variant="caption">
      Outgoing edges
    </Typography>
    {edges.length === 0 ? (
      <Typography color="text.secondary" variant="body2">
        No outgoing edges.
      </Typography>
    ) : (
      edges.map((edge, index) => (
        <FrameEdgeCard
          edge={edge}
          key={`${edge.type}-${edge.toId}-${index}`}
          targetNode={nodes.find((candidate) => candidate.id === edge.toId)}
          testIdPrefix={`${testIdPrefix}-edge-${index}`}
        />
      ))
    )}
  </Stack>
);

const EDGE_TYPE_LABELS: Record<CodingResearchFrameEdge["type"], string> = {
  parent: "Parent",
  depends_on: "Depends on",
  related_to: "Related to",
  derives_from: "Derives from",
  supersedes: "Supersedes",
  contradicts: "Contradicts",
};

interface FrameEdgeCardProps {
  edge: CodingResearchFrameEdge;
  targetNode: CodingResearchFrameNode | undefined;
  testIdPrefix: string;
}

const FrameEdgeCard: React.FC<FrameEdgeCardProps> = ({
  edge,
  targetNode,
  testIdPrefix,
}) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      targetNode ? (
        <FrameEntityLink node={targetNode} testId={`${testIdPrefix}-target`} />
      ) : (
        <Typography
          color="error"
          data-testid={`${testIdPrefix}-target-unavailable`}
          variant="body2"
        >
          Referenced entity is not included in the research frame.
        </Typography>
      )
    }
    trailing={
      <Chip
        data-testid={`${testIdPrefix}-relationship`}
        label={EDGE_TYPE_LABELS[edge.type]}
        size="small"
        variant="outlined"
      />
    }
  >
    <Typography
      color="text.secondary"
      data-testid={`${testIdPrefix}-reasoning`}
      variant="body2"
    >
      {renderInlineMentions(edge.reasoning, "minimal")}
    </Typography>
  </ReportItemCard>
);
