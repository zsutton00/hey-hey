import { Alert, Button, MenuItem, Stack, TextField } from "@mui/material";
import { useState } from "react";
import { useProjectMembers } from "@hey-hey/ui-common/data";
import {
  editActivityHistoryQuery,
  getActivityHistorySelection,
  type CrossProjectActivityFeedQuery,
} from "@hey-hey/ui-common/components";

interface ActivityHistoryFiltersProps {
  organizationId: string;
  query: CrossProjectActivityFeedQuery;
  onChange: (query: CrossProjectActivityFeedQuery) => void;
}

const toLocalInput = (value?: string): string => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export function ActivityHistoryFilters({
  organizationId,
  query,
  onChange,
}: ActivityHistoryFiltersProps) {
  const selection = getActivityHistorySelection(query);
  const [start, setStart] = useState(() => toLocalInput(selection.windowStart));
  const [end, setEnd] = useState(() => toLocalInput(selection.windowEnd));
  const [userId, setUserId] = useState(selection.userId ?? "");
  const projects =
    query.historyFilter?.projectIds ?? query.metricContinuation?.projectIds;
  const projectId = projects?.length === 1 ? projects[0] : query.projectId;
  const members = useProjectMembers(organizationId, projectId, {
    enabled: Boolean(projectId),
  });
  const validWindow =
    Number.isFinite(Date.parse(start)) &&
    Number.isFinite(Date.parse(end)) &&
    Date.parse(start) < Date.parse(end);
  const selectedUser = members.data.find(
    (member) => member.user?.id === userId,
  )?.user;
  return (
    <Stack data-testid="activity-history-filters" spacing={1} sx={{ mb: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          label="Period start"
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: {
              step: 60,
              "data-testid": "activity-history-start",
            },
          }}
        />
        <TextField
          label="Period end"
          type="datetime-local"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { step: 60, "data-testid": "activity-history-end" },
          }}
        />
        {projectId && members.isReady ? (
          <TextField
            select
            label="User"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            sx={{ minWidth: 180 }}
            data-testid="activity-history-user"
          >
            <MenuItem value="">All users</MenuItem>
            {userId && !selectedUser ? (
              <MenuItem disabled value={userId}>
                Selected user unavailable
              </MenuItem>
            ) : null}
            {members.data.flatMap((member) =>
              member.user
                ? [
                    <MenuItem key={member.user.id} value={member.user.id}>
                      {member.user.name}
                    </MenuItem>,
                  ]
                : [],
            )}
          </TextField>
        ) : null}
        <Button
          data-testid="activity-history-apply"
          disabled={!validWindow}
          onClick={() =>
            onChange(
              editActivityHistoryQuery(query, {
                windowStart: new Date(start).toISOString(),
                windowEnd: new Date(end).toISOString(),
                ...(userId ? { userId } : {}),
              }),
            )
          }
        >
          Apply filters
        </Button>
      </Stack>
      {projectId && !members.isFetched && !members.error ? (
        <Alert severity="info">Loading project users…</Alert>
      ) : null}
      {projectId && members.error ? (
        <Alert
          severity="error"
          action={<Button onClick={() => void members.refetch()}>Retry</Button>}
        >
          Project users could not be loaded.
        </Alert>
      ) : null}
      {projectId && members.isReady && userId && !selectedUser ? (
        <Alert severity="info">
          The selected user is not available in the loaded project members.
        </Alert>
      ) : null}
      {projectId && members.hasNext ? (
        <Button
          data-testid="activity-history-more-users"
          onClick={members.fetchNextPage}
        >
          Load more users
        </Button>
      ) : null}
    </Stack>
  );
}
