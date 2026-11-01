import { Fragment } from "react";
import { Box, Typography } from "@mui/material";
import isEqual from "lodash/isEqual.js";
import type { FeatureRequirementRecord } from "../../utils/structuredRequirements";
import { StructuredRequirementsView } from "../shared/StructuredRequirementsView";
import { WordDiffText } from "../SuggestedContent/DiffRenderer";
import { branchChange } from "./threeWayProjection";

const LIVE_NO_CHANGE_MESSAGE = "No change since this was proposed.";
const PROPOSAL_NO_CHANGE_MESSAGE =
  "This proposal did not change this requirement.";

export function ThreeWayRequirements({
  original,
  live,
  intended,
  overlapping,
  conflictingIds,
}: {
  original: readonly FeatureRequirementRecord[];
  live: readonly FeatureRequirementRecord[];
  intended: readonly FeatureRequirementRecord[];
  overlapping: boolean;
  conflictingIds: readonly string[];
}) {
  const maps = [original, live, intended].map(
    (records) => new Map(records.map((record) => [record.id, record])),
  );
  const ids = [
    ...new Set([...original, ...live, ...intended].map((record) => record.id)),
  ];
  return (
    <>
      {ids
        .filter((id) => conflictingIds.includes(id))
        .map((id) => {
          const basis = maps[0].get(id);
          const overlap =
            overlapping &&
            basis &&
            branchChange(basis, maps[1].get(id)) !== "Unchanged" &&
            branchChange(basis, maps[2].get(id)) !== "Unchanged" &&
            !isEqual(maps[1].get(id), maps[2].get(id));
          return (
            <Fragment key={id}>
              {maps.map((map, index) => {
                const record = map.get(id);
                const change =
                  index === 0 ? "Original" : branchChange(basis, record);
                return (
                  <Box
                    key={index}
                    data-testid="three-way-requirement-cell"
                    data-requirement-id={id}
                    data-state={index}
                    sx={{
                      p: 2,
                      borderBottom: 1,
                      borderColor: "divider",
                      bgcolor:
                        change === "Added" || change === "Changed"
                          ? "action.hover"
                          : undefined,
                    }}
                  >
                    <Typography variant="caption">
                      {change}
                      {overlap && index > 0 ? " · Overlapping edit" : ""}
                      {index === 2 && change === "Added"
                        ? " · Check it still belongs"
                        : ""}
                    </Typography>
                    {index > 0 && basis && change === "Unchanged" ? (
                      <Typography
                        data-testid="three-way-requirement-no-change"
                        variant="body2"
                        color="text.secondary"
                      >
                        {index === 1
                          ? LIVE_NO_CHANGE_MESSAGE
                          : PROPOSAL_NO_CHANGE_MESSAGE}
                      </Typography>
                    ) : record ? (
                      <StructuredRequirementsView
                        requirements={[record]}
                        itemStatementRenderers={
                          new Map([
                            [
                              id,
                              <WordDiffText
                                key={id}
                                oldContent={
                                  index === 0
                                    ? record.statement
                                    : (basis?.statement ?? "")
                                }
                                newContent={record.statement}
                                pane="new"
                              />,
                            ],
                          ])
                        }
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {index === 0
                          ? "This requirement did not exist."
                          : "No corresponding requirement."}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Fragment>
          );
        })}
    </>
  );
}
