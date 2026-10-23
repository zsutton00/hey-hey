import { Stack, Typography } from "@mui/material";
import React from "react";
import type {
  CodingResearchDiscoveryCall,
  CodingResearchEdgeTraversal,
} from "../../../api";
import {
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";

export interface CodingResearchProvenanceSectionsProps {
  discoveryCalls: CodingResearchDiscoveryCall[];
  edgesTraversed: CodingResearchEdgeTraversal[];
  reportTestId: string;
}

export const CodingResearchProvenanceSections: React.FC<
  CodingResearchProvenanceSectionsProps
> = ({ discoveryCalls, edgesTraversed, reportTestId }) => {
  return (
    <>
      <ReportPanel
        emptyMessage="No discovery calls recorded."
        isEmpty={discoveryCalls.length === 0}
        testId={`${reportTestId}-coding-research-discovery-calls`}
        title="Discovery calls"
      >
        <Stack spacing={1}>
          {discoveryCalls.map((call, index) => (
            <DiscoveryCallCard
              call={call}
              key={`discovery-call-${index}`}
              testIdPrefix={`${reportTestId}-coding-research-discovery-call-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
      <ReportPanel
        emptyMessage="No edges traversed."
        isEmpty={edgesTraversed.length === 0}
        testId={`${reportTestId}-coding-research-edges`}
        title="Edges traversed"
      >
        <Stack spacing={1}>
          {edgesTraversed.map((edge, index) => (
            <EdgeTraversalCard
              edge={edge}
              index={index}
              key={`edge-${index}`}
              testIdPrefix={`${reportTestId}-coding-research-edge-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
    </>
  );
};

interface DiscoveryCallCardProps {
  call: CodingResearchDiscoveryCall;
  testIdPrefix: string;
}

const DiscoveryCallCard: React.FC<DiscoveryCallCardProps> = ({
  call,
  testIdPrefix,
}) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      <Typography sx={{ fontFamily: "monospace" }} variant="subtitle2">
        {call.tool}
      </Typography>
    }
  >
    <ReportLabeledText
      label="Query"
      testId={`${testIdPrefix}-query`}
      value={call.query}
    />
    <ReportLabeledText
      label="Intent"
      renderMentions
      testId={`${testIdPrefix}-intent`}
      value={call.intent}
    />
  </ReportItemCard>
);

interface EdgeTraversalCardProps {
  edge: CodingResearchEdgeTraversal;
  index: number;
  testIdPrefix: string;
}

const EdgeTraversalCard: React.FC<EdgeTraversalCardProps> = ({
  edge,
  index,
  testIdPrefix,
}) => (
  <ReportItemCard testId={`${testIdPrefix}-card`} title={`Edge ${index + 1}`}>
    <ReportLabeledText
      label="From ID"
      testId={`${testIdPrefix}-from-id`}
      value={edge.fromId}
    />
    <ReportLabeledText
      label="To ID"
      testId={`${testIdPrefix}-to-id`}
      value={edge.toId}
    />
    <ReportLabeledText
      label="Reasoning"
      renderMentions
      testId={`${testIdPrefix}-reasoning`}
      value={edge.reasoning}
    />
  </ReportItemCard>
);
