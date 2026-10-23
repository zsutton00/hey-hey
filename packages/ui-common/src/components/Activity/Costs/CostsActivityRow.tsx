import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type {
  CliReadProjectSessionCostMember,
  CliReadProjectSessionCostRow,
  CliReadProviderSessionUsageCost,
} from "../../../api";
import { usePathService } from "../../../contexts";
import {
  formatActivityRelativeTimestamp,
  formatActivityTimestamp,
} from "../activityFormatting";

export interface CostsActivityRowProps {
  projectId: string;
  row: CliReadProjectSessionCostRow;
}

const assertNever = (value: never): never => {
  throw new Error(`Unexpected cost state: ${JSON.stringify(value)}`);
};

const formatUsd = (amount: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);

const formatCost = (cost: CliReadProviderSessionUsageCost): string => {
  switch (cost.state) {
    case "available":
      return formatUsd(cost.amountUsd);
    case "unavailable":
      return `Unavailable — ${cost.reason.replace(/_/g, " ")}`;
    default:
      return assertNever(cost);
  }
};

const ProviderSession = ({
  member,
}: {
  member: CliReadProjectSessionCostMember;
}) => (
  <Stack
    data-testid="costs-provider-session"
    data-provider-session-id={member.providerSessionId}
    spacing={0.5}
  >
    <Stack
      alignItems={{ xs: "flex-start", sm: "center" }}
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      spacing={1}
    >
      <Stack direction="row" spacing={1}>
        <Chip label={member.providerId} size="small" variant="outlined" />
        <Typography sx={{ fontFamily: "monospace" }} variant="body2">
          {member.providerSessionId}
        </Typography>
      </Stack>
      <Typography variant="body2">{formatCost(member.cost)}</Typography>
    </Stack>
    <Typography color="text.secondary" variant="caption">
      Observed {formatActivityTimestamp(member.observedAt)}
    </Typography>
    {member.cost.state === "unavailable" && member.cost.message ? (
      <Typography color="text.secondary" variant="caption">
        {member.cost.message}
      </Typography>
    ) : null}
  </Stack>
);

const contextTitle = (row: CliReadProjectSessionCostRow): string =>
  row.context.entityTitle?.trim() || "Session context unavailable";

const SessionTitle = ({
  projectId,
  row,
}: CostsActivityRowProps) => {
  const pathService = usePathService();
  const title = contextTitle(row);

  if (!row.conversationId) {
    return <Typography variant="subtitle2">{title}</Typography>;
  }

  return (
    <Link
      component={RouterLink}
      onClick={(event) => event.stopPropagation()}
      to={pathService.resolveAgentSession({
        projectId,
        conversationId: row.conversationId,
      })}
      variant="subtitle2"
    >
      {title}
    </Link>
  );
};

export const CostsActivityRow = ({ projectId, row }: CostsActivityRowProps) => (
  <Accordion
    data-agent-session-id={row.agentSessionId}
    data-testid="costs-activity-row"
    disableGutters
  >
    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
      <Stack
        alignItems={{ xs: "flex-start", sm: "center" }}
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ pr: 1, width: "100%" }}
      >
        <Stack spacing={0.5}>
          <SessionTitle projectId={projectId} row={row} />
          <Typography color="text.secondary" variant="caption">
            Latest activity{" "}
            {formatActivityRelativeTimestamp(row.latestActivityAt)}
          </Typography>
        </Stack>
        <Stack alignItems="center" direction="row" spacing={1}>
          <Chip label={row.completeness} size="small" variant="outlined" />
          <Typography
            data-testid="costs-known-aggregate"
            sx={{ fontFamily: "monospace", fontWeight: 600 }}
            variant="body2"
          >
            {row.knownCostUsd === null
              ? "Cost unavailable"
              : formatUsd(row.knownCostUsd)}
          </Typography>
        </Stack>
      </Stack>
    </AccordionSummary>
    <AccordionDetails>
      <Stack spacing={1.5}>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {row.context.entityType ? (
            <Chip label={row.context.entityType} size="small" />
          ) : null}
          {row.context.promptType ? (
            <Chip label={row.context.promptType} size="small" />
          ) : null}
          <Chip
            label={`Read ${formatActivityRelativeTimestamp(row.costReadAt)}`}
            size="small"
            title={formatActivityTimestamp(row.costReadAt)}
            variant="outlined"
          />
        </Stack>
        <Divider />
        {row.providerSessions.length === 0 ? (
          <Box data-testid="costs-provider-sessions-empty">
            <Typography color="text.secondary" variant="body2">
              No provider sessions were recorded for this session.
            </Typography>
          </Box>
        ) : (
          row.providerSessions.map((member, index) => (
            <Stack key={`${member.providerId}:${member.providerSessionId}`}>
              {index > 0 ? <Divider sx={{ mb: 1.5 }} /> : null}
              <ProviderSession member={member} />
            </Stack>
          ))
        )}
      </Stack>
    </AccordionDetails>
  </Accordion>
);
