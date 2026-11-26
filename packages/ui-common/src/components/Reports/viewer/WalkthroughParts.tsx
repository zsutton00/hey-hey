import { Stack, Typography } from "@mui/material";
import React from "react";
import type { ChangeWalkthroughPart } from "../../../api";
import { ReportItemCard } from "./reportPrimitives";
import { useWalkthroughPartBlocks } from "./useWalkthroughPartBlocks";
import { WalkthroughMarkdown } from "./WalkthroughMarkdown";
import {
  WalkthroughPartPreviews,
  WalkthroughPreviewsLoading,
} from "./WalkthroughPartPreviews";

interface ProjectScope {
  organizationId: string;
  projectId: string;
}

const PartName: React.FC<{ name: string }> = ({ name }) => (
  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 650 }}>
    {name}
  </Typography>
);

const PartDescription: React.FC<{ part: ChangeWalkthroughPart }> = ({
  part,
}) => (
  <Stack spacing={1}>
    <WalkthroughMarkdown text={part.role} />
    <WalkthroughMarkdown text={part.relations} />
  </Stack>
);

/** One card: each part's name and description in turn, then `children`. */
const PartsCard: React.FC<{
  parts: readonly ChangeWalkthroughPart[];
  children?: React.ReactNode;
}> = ({ parts, children }) => {
  const [first, ...others] = parts;

  return (
    <ReportItemCard
      title={<PartName name={first!.name} />}
      testId="walkthrough-part-block"
    >
      <Stack spacing={1}>
        <PartDescription part={first!} />
        {others.map((part, index) => (
          <Stack key={index} spacing={1} sx={{ pt: 1.5 }}>
            <PartName name={part.name} />
            <PartDescription part={part} />
          </Stack>
        ))}
        {children}
      </Stack>
    </ReportItemCard>
  );
};

/** Parts that link the same Diagram Element share a card and its previews. */
const LinkedPartCards: React.FC<
  ProjectScope & { parts: readonly ChangeWalkthroughPart[] }
> = ({ organizationId, projectId, parts }) => {
  const blocks = useWalkthroughPartBlocks(organizationId, projectId, parts);

  return blocks.map((block) => (
    <PartsCard key={block.position} parts={block.parts}>
      {block.isGrouping ? (
        <WalkthroughPreviewsLoading />
      ) : block.elementIds.length > 0 ? (
        <WalkthroughPartPreviews
          organizationId={organizationId}
          projectId={projectId}
          elementIds={block.elementIds}
        />
      ) : null}
    </PartsCard>
  ));
};

/**
 * The "Parts of the system" section. Without a project to read Diagrams from,
 * parts show their text alone.
 */
export const WalkthroughParts: React.FC<{
  scope: ProjectScope | undefined;
  parts: readonly ChangeWalkthroughPart[];
}> = ({ scope, parts }) => (
  <Stack spacing={1.5} data-testid="walkthrough-parts">
    <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 650 }}>
      Parts of the system
    </Typography>
    {scope ? (
      <LinkedPartCards {...scope} parts={parts} />
    ) : (
      parts.map((part, index) => <PartsCard key={index} parts={[part]} />)
    )}
  </Stack>
);
