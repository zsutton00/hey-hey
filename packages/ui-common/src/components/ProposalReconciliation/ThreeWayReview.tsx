import { ReconciliationReference } from "./ReconciliationReference";
import { Fragment } from "react";
import { Alert, Box, Link, Stack, Typography } from "@mui/material";
import { format, formatDistanceToNow } from "date-fns";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../api";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { usePathService } from "../../contexts/PathServiceContext";
import {
  isCanonicalFeatureRequirementsDefinition,
  readFeatureRequirementsSection,
} from "../../utils/featureRequirementsSection";
import {
  projectThreeWayReview,
  threeWayFields,
  threeWayValue,
  branchChange,
} from "./threeWayProjection";
import {
  reconciliationFieldLabel,
  type ReconciliationPresentation,
} from "./reconciliationPresentation";
import { ThreeWayRequirements } from "./ThreeWayRequirements";
import { ReconciliationValue } from "./ReconciliationValue";

export function ThreeWayReview({
  proposal,
  state,
}: {
  proposal: ProposalResponseDto;
  state: ProposalReconciliationState;
}) {
  const count = state.interveningProposals.length;
  const headings = [
    [
      "When this was proposed",
      state.writtenAt
        ? formatDistanceToNow(new Date(state.writtenAt), { addSuffix: true })
        : "Proposal date unavailable.",
    ],
    [
      "Current",
      `${count} ${count === 1 ? "change has" : "changes have"} been applied since this was proposed.`,
    ],
    [
      "Proposal",
      "There are changes since this was proposed that prevent applying it without confirmation.",
    ],
  ];
  const projection = projectThreeWayReview(proposal, state);
  const paths = usePathService();
  const registry = useWorkItemTypes(proposal.organizationId, {
    projectId: proposal.projectId,
  });
  const definition = registry.workItemTypes.find(
    (item) => item.definition.key === projection.live?.type,
  )?.definition;
  const presentation: ReconciliationPresentation =
    proposal.targetEntityType === "DESIGN_DOC"
      ? { kind: "design-doc" }
      : { kind: "work-item", definition };
  const states = [projection.original, projection.live, projection.intended];
  const fields = threeWayFields(projection);
  const sectionOrder = new Map(
    definition?.sections.map((section, index) => [
      `sections.${section.key}`,
      index,
    ]),
  );
  fields.sort(
    (a, b) => (sectionOrder.get(a) ?? -1) - (sectionOrder.get(b) ?? -1),
  );
  return (
    <Stack spacing={1} data-testid="proposal-three-way-review">
      <Typography variant="h6">
        Decide how these changes should fit together
      </Typography>
      <Typography>
        The live content and this proposal changed from the same starting point.
        Compare both changes, including whether proposed additions still belong
        even without textual overlap.
      </Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {headings.map(([heading, help]) => (
            <Box key={heading} sx={{ p: 2, bgcolor: "action.hover" }}>
              <Typography variant="subtitle2">{heading}</Typography>
              <Typography variant="body2">{help}</Typography>
            </Box>
          ))}
          {fields.map((path) => {
            const values = states.map((content) =>
              threeWayValue(content, path),
            );
            const section = definition?.sections.find(
              (item) => path === `sections.${item.key}`,
            );
            const requirements = isCanonicalFeatureRequirementsDefinition(
              definition?.key,
              section,
            )
              ? values.map(readFeatureRequirementsSection)
              : undefined;
            const validRequirements =
              requirements?.every((value) => value.status !== "invalid") &&
              states.every(Boolean);
            const overlapping = state.overlaps.some(
              (overlap) =>
                overlap.path === path || overlap.path.startsWith(`${path}.`),
            );
            const attribution = state.interveningProposals.filter((entry) =>
              entry.changes.some(
                (change) =>
                  change.path === path || change.path.startsWith(`${path}.`),
              ),
            );
            return (
              <Fragment key={path}>
                <Box
                  sx={{
                    gridColumn: "1 / -1",
                    p: 1,
                    borderTop: 1,
                    borderColor: "divider",
                  }}
                >
                  <Typography variant="subtitle2">
                    {reconciliationFieldLabel(path, presentation)}
                  </Typography>
                </Box>
                {validRequirements && requirements ? (
                  <ThreeWayRequirements
                    original={
                      requirements[0].status === "valid" ||
                      requirements[0].status === "valid-empty"
                        ? requirements[0].records
                        : []
                    }
                    live={
                      requirements[1].status === "valid" ||
                      requirements[1].status === "valid-empty"
                        ? requirements[1].records
                        : []
                    }
                    intended={
                      requirements[2].status === "valid" ||
                      requirements[2].status === "valid-empty"
                        ? requirements[2].records
                        : []
                    }
                    overlapping={overlapping}
                  />
                ) : (
                  values.map((value, index) => (
                    <Box key={index} sx={{ p: 2, minWidth: 0 }}>
                      <Typography variant="caption">
                        {index === 0
                          ? "Original"
                          : projection.original
                            ? branchChange(values[0], value)
                            : "Change comparison unavailable"}
                      </Typography>
                      {!states[index] ? (
                        <Alert severity="warning">
                          {index === 0
                            ? "Original evidence is unavailable; it has not been reconstructed from live content."
                            : "Content is unavailable."}
                        </Alert>
                      ) : requirements ? (
                        <Alert severity="warning">
                          Requirements cannot be compared without valid retained
                          evidence.
                        </Alert>
                      ) : typeof value === "string" && path.endsWith("Id") ? (
                        <ReconciliationReference
                          entityId={value}
                          entityType={
                            path === "assigneeId"
                              ? "user"
                              : path === "initiativeId"
                                ? "initiative"
                                : path === "parentEntityId" &&
                                    typeof states[index]?.parentEntityType ===
                                      "string"
                                  ? String(
                                      states[index]?.parentEntityType,
                                    ).toLowerCase()
                                  : "task"
                          }
                          organizationId={proposal.organizationId}
                          projectId={proposal.projectId}
                        />
                      ) : path === "serviceIds" && Array.isArray(value) ? (
                        <Stack>
                          {value
                            .filter(
                              (id): id is string => typeof id === "string",
                            )
                            .map((id) => (
                              <ReconciliationReference
                                key={id}
                                entityId={id}
                                entityType="service"
                                organizationId={proposal.organizationId}
                                projectId={proposal.projectId}
                              />
                            ))}
                        </Stack>
                      ) : (
                        <ReconciliationValue
                          value={value}
                          original={values[0]}
                          branch={index > 0 && !!projection.original}
                          section={section}
                          typeKey={definition?.key}
                        />
                      )}
                    </Box>
                  ))
                )}
                {attribution.length > 0 ? (
                  <>
                    <Box />
                    <Stack spacing={0.5} sx={{ p: 1 }}>
                      {attribution.map((entry) => (
                        <Typography key={entry.proposalId} variant="caption">
                          <Link
                            href={paths.proposal({
                              projectId: proposal.projectId,
                              proposalId: entry.proposalId,
                            })}
                          >
                            {entry.title}
                          </Link>{" "}
                          · Approved{" "}
                          {format(
                            new Date(entry.approvedAt),
                            "MMM d, yyyy · p",
                          )}
                          {entry.approvedByName
                            ? ` by ${entry.approvedByName}`
                            : ""}
                        </Typography>
                      ))}
                    </Stack>
                    <Box />
                  </>
                ) : null}
              </Fragment>
            );
          })}
          {!projection.original && fields.length === 0 ? (
            <Alert sx={{ gridColumn: "1 / -1" }} severity="warning">
              Original evidence is unavailable.
            </Alert>
          ) : null}
        </Box>
      </Box>
    </Stack>
  );
}
