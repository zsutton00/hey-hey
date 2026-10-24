import { SessionRole } from "../../api";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import { ProposalAction } from "../../api";
import type { ProposalResponseDto, WorkItemTypeDefinitionDto } from "../../api";
import { getStatusColorMapping, getStatusLabel } from "../../utils/statusUtils";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type { ProposalItemStatus } from "./types";
import { isPlaceholderEntityId } from "./types";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import { ProposalEdges } from "./ProposalEdges";
import { useProjectCapabilities } from "../../hooks";
import type { ApprovalProgress } from "../../permissions";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { ProposalTitle } from "./ProposalTitle";
import {
  resolveWorkItemTypeColors,
  staticProposalTypePresentation,
} from "./proposalHeaderType";
import { WorkItemTypeCreateProposalPresentation } from "./WorkItemTypeCreateProposalPresentation";

/**
 * Humanize a stable machine key (camelCase, snake_case, or SCREAMING_SNAKE)
 * into Title Case for display — used for capability flags, edge-type keys, and
 * the EntityType / ReportType enum members the DTO carries as raw identifiers
 * with no dedicated label helper.
 */
const humanizeKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * A framed group of related axes, captioned with a one-line framing of what the
 * group describes. Renders nothing when it carries no content so absent groups
 * leave no trace.
 */
const Group: React.FC<{
  title: string;
  caption: string;
  children: React.ReactNode;
}> = ({ title, caption, children }) => (
  <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
    <Typography variant="subtitle2">{title}</Typography>
    <Typography
      variant="caption"
      color="text.secondary"
      component="div"
      sx={{ mb: 1 }}
    >
      {caption}
    </Typography>
    <Stack spacing={1.5}>{children}</Stack>
  </Box>
);

/**
 * A small labeled block grouping one axis of the definition. Renders nothing
 * when the axis is empty so absent axes leave no trace.
 */
const AxisBlock: React.FC<{
  label: string;
  children: React.ReactNode;
  "data-testid"?: string;
}> = ({ label, children, "data-testid": testId }) => (
  <Box data-testid={testId}>
    <Typography
      variant="caption"
      sx={{
        color: "text.secondary",
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {label}
    </Typography>
    <Box sx={{ mt: 0.5 }}>{children}</Box>
  </Box>
);

/** A wrap-flow row of chips built from a list of plain string labels. */
const ChipRow: React.FC<{
  values: string[];
  color?: "default" | "primary" | "secondary" | "warning";
}> = ({ values, color = "default" }) => (
  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
    {values.map((value) => (
      <Chip
        key={value}
        label={value}
        size="small"
        color={color}
        variant="outlined"
      />
    ))}
  </Stack>
);

/** A wrap-flow row of work-status chips, colored by the shared status mapping. */
const StatusChipRow: React.FC<{
  statuses: WorkItemTypeDefinitionDto["allowedStatuses"];
}> = ({ statuses }) => (
  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
    {statuses.map((statusValue) => (
      <Chip
        key={statusValue}
        label={getStatusLabel(statusValue)}
        color={getStatusColorMapping(statusValue)}
        size="small"
        variant="outlined"
      />
    ))}
  </Stack>
);

/**
 * Renders a work-item-type CREATE proposal as a read-only review card. A
 * placeholder target is a new-definition review; a retained stable-key target
 * is a restoration review. Shows
 * every axis the WorkItemTypeDefinitionDto carries, grouped into framed blocks —
 * Purpose (description), Structure & placement (sections with their writing
 * standards, parent/child type keys, parent entity types, edge targets),
 * Tracking, Lifecycle & statuses (allowed and agent-settable statuses, required
 * and forbidden scalars, anchorable report types), Writing standards (the
 * type-level create/edit writing standards), and Capabilities — so a reviewer
 * can vet the full type definition before approving. Carries no accept-side
 * logic of its own; apply/reject pass straight through.
 */
export const WorkItemTypeCreateRenderer: React.FC<{
  proposal: ProposalResponseDto & { updates: WorkItemTypeDefinitionDto };
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  overrides?: ProposalRenderOverrides;
}> = ({
  proposal,
  status,
  onApply,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  overrides,
}) => {
  const { updates } = proposal;
  const { manageWorkItemTypes } = useProjectCapabilities(
    proposal.organizationId,
    proposal.projectId,
  );
  const isRestoration =
    !isPlaceholderEntityId(proposal.targetEntityId) &&
    proposal.targetEntityId === updates.key;
  const sections = updates.sections ?? [];
  const requiredScalars = updates.requiredScalars ?? [];
  const forbiddenScalars = updates.forbiddenScalars ?? [];
  const allowedStatuses = updates.allowedStatuses ?? [];
  const agentSettableStatuses = updates.agentSettableStatuses ?? [];
  const allowedParentTypes = updates.allowedParentTypes ?? [];
  const allowedParentEntityTypes = updates.allowedParentEntityTypes ?? [];
  const anchorableReportTypes = updates.anchorableReportTypes ?? [];
  const edgeTargets = updates.edgeTargets ?? [];
  const capabilities = Object.entries(updates.capabilities ?? {}).filter(
    ([, value]) => value !== undefined,
  );
  const { tracking, writingStandards } = updates;

  const hasStructure =
    sections.length > 0 ||
    allowedParentTypes.length > 0 ||
    allowedParentEntityTypes.length > 0 ||
    edgeTargets.length > 0;

  const hasLifecycle =
    allowedStatuses.length > 0 ||
    agentSettableStatuses.length > 0 ||
    requiredScalars.length > 0 ||
    forbiddenScalars.length > 0 ||
    anchorableReportTypes.length > 0;

  const hasWritingStandards =
    !!writingStandards &&
    (!!writingStandards.create || !!writingStandards.edit);

  const content = (
    <Stack spacing={1.5}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={updates.name}
          typePresentation={staticProposalTypePresentation(
            "Work Item Type",
            undefined,
            resolveWorkItemTypeColors(updates.key, updates, "PROJECT_CUSTOM"),
          )}
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
        />
      )}

      {isRestoration && (
        <Alert severity="info" data-testid="work-item-type-restore-review">
          Restoring this retained definition returns the type to new-work
          choices. Existing items and their history remain preserved.
        </Alert>
      )}

      {!isRestoration && (
        <WorkItemTypeCreateProposalPresentation
          definition={updates}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
        />
      )}

      <Accordion
        disableGutters
        elevation={0}
        data-testid="work-item-type-complete-definition"
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls="work-item-type-complete-definition-content"
          id="work-item-type-complete-definition-header"
        >
          <Typography variant="subtitle1" fontWeight={700}>
            Complete proposed definition
          </Typography>
        </AccordionSummary>
        <AccordionDetails id="work-item-type-complete-definition-content">
          <Stack spacing={1.5}>
            {updates.description && (
              <Group
                title="Purpose"
                caption="What this type captures and when to reach for it."
              >
                <Typography
                  variant="body2"
                  color="text.secondary"
                  component="div"
                >
                  <MarkdownRenderer allowMentionEscapes>
                    {updates.description}
                  </MarkdownRenderer>
                </Typography>
              </Group>
            )}

            <Group
              title="Classification"
              caption="Purpose classification only; execution behavior is defined elsewhere."
            >
              <AxisBlock label="Type key">
                <Chip
                  label={updates.key}
                  size="small"
                  variant="outlined"
                  data-testid="work-item-type-key"
                />
              </AxisBlock>
              <AxisBlock label="Role">
                <Chip
                  label={updates.role}
                  size="small"
                  data-testid="work-item-type-role"
                />
              </AxisBlock>
              {updates.iconKey && (
                <AxisBlock label="Icon">
                  <Chip
                    label={humanizeKey(updates.iconKey)}
                    size="small"
                    variant="outlined"
                    data-testid="work-item-type-icon-key"
                  />
                </AxisBlock>
              )}
              {updates.colorKey && (
                <AxisBlock label="Color">
                  <Chip
                    label={humanizeKey(updates.colorKey)}
                    size="small"
                    variant="outlined"
                    data-testid="work-item-type-color-key"
                  />
                </AxisBlock>
              )}
            </Group>

            {hasStructure && (
              <Group
                title="Structure & placement"
                caption="The content of an item of this type and where it sits in the graph."
              >
                {sections.length > 0 && (
                  <AxisBlock label="Sections">
                    <Stack spacing={1}>
                      {sections.map((section, index) => (
                        <Box key={section.key ?? `section-${index}`}>
                          <Typography variant="subtitle2">
                            {section.label}
                          </Typography>
                          {section.writingStandard && (
                            <AxisBlock label="Section writing standard">
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                component="div"
                              >
                                <MarkdownRenderer allowMentionEscapes>
                                  {section.writingStandard}
                                </MarkdownRenderer>
                              </Typography>
                            </AxisBlock>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </AxisBlock>
                )}

                {allowedParentTypes.length > 0 && (
                  <AxisBlock
                    label="Allowed Parents"
                    data-testid="work-item-type-allowed-parents"
                  >
                    <ChipRow values={allowedParentTypes} />
                  </AxisBlock>
                )}

                {allowedParentEntityTypes.length > 0 && (
                  <AxisBlock label="Parent Entity Types">
                    <ChipRow
                      values={allowedParentEntityTypes.map(humanizeKey)}
                    />
                  </AxisBlock>
                )}

                {edgeTargets.length > 0 && (
                  <AxisBlock label="Edge Targets">
                    <Stack spacing={0.5}>
                      {edgeTargets.map((edge, index) => (
                        <Stack
                          key={`${edge.edgeType}-${index}`}
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          useFlexGap
                          flexWrap="wrap"
                        >
                          <Chip
                            label={humanizeKey(edge.edgeType)}
                            size="small"
                            color="secondary"
                            variant="outlined"
                          />
                          {edge.targetTypeKeys.length > 0 ? (
                            edge.targetTypeKeys.map((targetKey) => (
                              <Chip
                                key={targetKey}
                                label={targetKey}
                                size="small"
                                variant="outlined"
                              />
                            ))
                          ) : (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Any type
                            </Typography>
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  </AxisBlock>
                )}
              </Group>
            )}

            {updates.sessionRoleGuidance && (
              <Box data-testid="work-item-type-create-role-guidance">
                <Typography variant="subtitle2">
                  Session-role guidance
                </Typography>
                {Object.values(SessionRole).map(
                  (role) =>
                    updates.sessionRoleGuidance?.[role] !== undefined && (
                      <Box key={role} sx={{ mt: 1 }}>
                        <Typography variant="subtitle2">{role}</Typography>
                        <Typography
                          variant="body2"
                          sx={{ whiteSpace: "pre-wrap" }}
                        >
                          {updates.sessionRoleGuidance[role]}
                        </Typography>
                      </Box>
                    ),
                )}
              </Box>
            )}
            {updates.agentGuidance && (
              <Group
                title="Semantic guidance"
                caption="Meaning, examples, and guidance for selected focal types."
              >
                <Stack
                  spacing={1.5}
                  data-testid="work-item-type-semantic-guidance"
                >
                  <AxisBlock label="Overview">
                    <MarkdownRenderer allowMentionEscapes>
                      {updates.agentGuidance.overview}
                    </MarkdownRenderer>
                  </AxisBlock>
                  {updates.agentGuidance.examples &&
                    updates.agentGuidance.examples.length > 0 && (
                      <AxisBlock label="Examples">
                        <Stack spacing={1}>
                          {updates.agentGuidance.examples.map(
                            (example, index) => (
                              <Box key={index}>
                                <Typography variant="subtitle2">
                                  {example.title}
                                </Typography>
                                <MarkdownRenderer allowMentionEscapes>
                                  {example.guidance}
                                </MarkdownRenderer>
                              </Box>
                            ),
                          )}
                        </Stack>
                      </AxisBlock>
                    )}
                  {updates.agentGuidance.contexts &&
                    updates.agentGuidance.contexts.length > 0 && (
                      <AxisBlock label="Contextual guidance">
                        <Stack spacing={1.5}>
                          {updates.agentGuidance.contexts.map(
                            (context, index) => (
                              <Box key={index}>
                                <AxisBlock label="Focal types">
                                  <ChipRow values={context.focalTypeKeys} />
                                </AxisBlock>
                                <MarkdownRenderer allowMentionEscapes>
                                  {context.guidance}
                                </MarkdownRenderer>
                                {context.examples &&
                                  context.examples.length > 0 && (
                                    <AxisBlock label="Context examples">
                                      <Stack spacing={1}>
                                        {context.examples.map(
                                          (example, exampleIndex) => (
                                            <Box key={exampleIndex}>
                                              <Typography variant="subtitle2">
                                                {example.title}
                                              </Typography>
                                              <MarkdownRenderer
                                                allowMentionEscapes
                                              >
                                                {example.guidance}
                                              </MarkdownRenderer>
                                            </Box>
                                          ),
                                        )}
                                      </Stack>
                                    </AxisBlock>
                                  )}
                              </Box>
                            ),
                          )}
                        </Stack>
                      </AxisBlock>
                    )}
                </Stack>
              </Group>
            )}

            {tracking && (
              <Group
                title="Tracking"
                caption="Which entities and work-item types may track this target type."
              >
                {tracking.allowedSourceEntityTypes.length > 0 && (
                  <AxisBlock label="Allowed Source Entity Types">
                    <ChipRow
                      values={tracking.allowedSourceEntityTypes.map(
                        humanizeKey,
                      )}
                    />
                  </AxisBlock>
                )}

                {tracking.allowedSourceTaskTypes.length > 0 && (
                  <AxisBlock label="Allowed Source Type Keys">
                    <ChipRow values={tracking.allowedSourceTaskTypes} />
                  </AxisBlock>
                )}
              </Group>
            )}

            {hasLifecycle && (
              <Group
                title="Lifecycle & statuses"
                caption="The statuses items move through and the scalar fields and reports they carry."
              >
                {allowedStatuses.length > 0 && (
                  <AxisBlock label="Allowed Statuses">
                    <StatusChipRow statuses={allowedStatuses} />
                  </AxisBlock>
                )}

                {agentSettableStatuses.length > 0 && (
                  <AxisBlock label="Agent-Settable Statuses">
                    <StatusChipRow statuses={agentSettableStatuses} />
                  </AxisBlock>
                )}

                {requiredScalars.length > 0 && (
                  <AxisBlock label="Required Scalars">
                    <ChipRow
                      values={requiredScalars.map(humanizeKey)}
                      color="warning"
                    />
                  </AxisBlock>
                )}

                {forbiddenScalars.length > 0 && (
                  <AxisBlock label="Forbidden Scalars">
                    <ChipRow values={forbiddenScalars.map(humanizeKey)} />
                  </AxisBlock>
                )}

                {anchorableReportTypes.length > 0 && (
                  <AxisBlock label="Anchorable Report Types">
                    <ChipRow values={anchorableReportTypes.map(humanizeKey)} />
                  </AxisBlock>
                )}
              </Group>
            )}

            {hasWritingStandards && writingStandards && (
              <Group
                title="Writing standards"
                caption="Type-level standards an agent reads before creating or editing an item."
              >
                {writingStandards.create && (
                  <AxisBlock label="Writing standard — Create">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      component="div"
                    >
                      <MarkdownRenderer allowMentionEscapes>
                        {writingStandards.create}
                      </MarkdownRenderer>
                    </Typography>
                  </AxisBlock>
                )}

                {writingStandards.edit && (
                  <AxisBlock label="Writing standard — Edit">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      component="div"
                    >
                      <MarkdownRenderer allowMentionEscapes>
                        {writingStandards.edit}
                      </MarkdownRenderer>
                    </Typography>
                  </AxisBlock>
                )}
              </Group>
            )}

            {capabilities.length > 0 && (
              <Group
                title="Capabilities"
                caption="The boolean feature switches an item of this type carries."
              >
                <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                  {capabilities.map(([capKey, value]) => {
                    const enabled = value === true || typeof value === "object";
                    return (
                      <Chip
                        key={capKey}
                        label={`${humanizeKey(capKey)}: ${
                          enabled ? "Yes" : "No"
                        }`}
                        size="small"
                        color={enabled ? "success" : "default"}
                        variant="outlined"
                      />
                    );
                  })}
                </Stack>
              </Group>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>

      {siblingProposals && (
        <ProposalEdges
          edges={proposal.edges}
          siblingProposals={siblingProposals}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
          ownerApplied={status.state === "applied"}
        />
      )}

      {!overrides?.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          <ProposalStateIndicator
            status={status}
            action={ProposalAction.Create}
            onApply={onApply}
            onReject={onReject}
            disabled={disabled}
            approvalProgress={approvalProgress}
            applyLabel={isRestoration ? "Restore" : overrides?.applyLabel}
            canApprove={manageWorkItemTypes}
          />
        </Box>
      )}
    </Stack>
  );

  return overrides?.hideCard ? (
    content
  ) : (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {content}
    </Paper>
  );
};
