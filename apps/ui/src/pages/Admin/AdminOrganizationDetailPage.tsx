import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  OrganizationEntitlementMutationError,
  useAdminOrganizationDetail,
  useAdminOrganizationMembers,
  useMakeOrganizationBetaAccessOpenEnded,
} from "@hey-hey/ui-common/data";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "No activity yet";

const entitlementFailureMessage = (error: Error | null) => {
  if (!(error instanceof OrganizationEntitlementMutationError))
    return "Access could not be made permanent. Try again.";
  switch (error.failure) {
    case "authorization":
      return "You are not authorized to change this organization’s access.";
    case "conflict":
      return "Access changed after this page loaded. Refresh and review the latest state.";
    case "ineligible":
      return "Only active beta access with an expiry can be made permanent.";
    case "irreversible-closure":
      return "This organization is irreversibly closed and its access cannot be restored.";
    default:
      return "Access could not be made permanent. Try again.";
  }
};

export const AdminOrganizationDetailPage: React.FC = () => {
  const { organizationId = "" } = useParams();
  const [name, setName] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const [confirmationOpen, setConfirmationOpen, confirmationOpenOwnerKey] =
    useModalState(false);
  const [reason, setReason] = useState("");
  const detail = useAdminOrganizationDetail({ organizationId });
  const members = useAdminOrganizationMembers({
    organizationId,
    name,
    cursor,
    limit: 25,
  });
  const makeAccessPermanent = useMakeOrganizationBetaAccessOpenEnded();
  const changeSearch = useCallback((value: string) => {
    setName(value);
    setCursor(undefined);
    setHistory([]);
  }, []);

  if (detail.isForbidden || members.isForbidden)
    return (
      <Container sx={{ py: 5 }}>
        <Alert severity="warning">
          You are not authorized to view this organization.
        </Alert>
      </Container>
    );
  if (
    (detail.isLoading && !detail.isFetched) ||
    (members.isLoading && !members.isFetched)
  )
    return (
      <Container sx={{ py: 5 }}>
        <Typography role="status">Loading organization…</Typography>
      </Container>
    );
  if (detail.error || members.error || !detail.data)
    return (
      <Container sx={{ py: 5 }}>
        <Alert severity="error">
          The organization detail could not be loaded.
        </Alert>
        <Button
          onClick={() => {
            void detail.refetch();
            void members.refetch();
          }}
        >
          Retry
        </Button>
      </Container>
    );

  const { organization, entitlement, evidence, latestAgentSessions } =
    detail.data;
  const canMakeAccessPermanent =
    entitlement.subscriptionType === "BETA" &&
    entitlement.accessStatus === "ACTIVE" &&
    entitlement.accessThroughAt !== null;
  const horizonLabel =
    entitlement.subscriptionType === "BETA" &&
    entitlement.accessStatus === "ACTIVE" &&
    entitlement.accessThroughAt === null
      ? "Until revoked"
      : entitlement.effectiveAccessThroughAt
        ? formatDate(entitlement.effectiveAccessThroughAt)
        : entitlement.subscriptionType === "PAID" && !entitlement.paidThroughAt
          ? "No paid-through date"
          : "No active access horizon";
  const maximum = Math.max(
    1,
    ...evidence.workItemsByType.map((item) => item.count),
  );
  const memberRows = members.members.map((member) => ({
    ...member,
    lastActive: formatDate(member.lastActiveAt),
  }));
  const workItems = (
    <Stack spacing={2} sx={{ mt: 2 }}>
      {evidence.workItemsByType.length ? (
        evidence.workItemsByType.map((item) => (
          <Box key={item.typeKey}>
            <Stack direction="row" justifyContent="space-between">
              <Typography>{item.displayName}</Typography>
              <Typography>{item.count}</Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={(item.count / maximum) * 100}
            />
          </Box>
        ))
      ) : (
        <Typography color="text.secondary">No work items created.</Typography>
      )}
    </Stack>
  );
  const sessions = (
    <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
      {latestAgentSessions.length ? (
        latestAgentSessions.map((session) => (
          <Box key={session.id} sx={{ py: 1.5 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography fontWeight={600}>{session.name}</Typography>
              <Chip label={session.status} size="small" />
            </Stack>
            <Typography color="text.secondary" variant="body2">
              {session.sessionType} · {formatDate(session.lastActivityAt)}
            </Typography>
          </Box>
        ))
      ) : (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          No Agent Session activity.
        </Typography>
      )}
    </Stack>
  );

  return (
    <Container
      component="main"
      data-testid="admin-organization-detail-page"
      maxWidth="xl"
      sx={{ py: { xs: 3, md: 5 } }}
    >
      <Link component={RouterLink} to="/admin/organizations">
        ← Organizations
      </Link>
      <Stack sx={{ my: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography component="h1" variant="h4">
            {organization.name}
          </Typography>
          <Chip label="Admin" size="small" />
        </Stack>
        <Typography color="text.secondary">
          Created {formatDate(organization.createdAt)}
        </Typography>
      </Stack>
      <Box
        data-testid="organization-summary"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
          gap: 2,
        }}
      >
        {[
          ["Members", organization.memberCount],
          ["Projects", organization.projectCount],
          ["Work items created · All time", evidence.workItemsCreatedAllTime],
          [
            "Agent sessions created · All time",
            evidence.agentSessionsCreatedAllTime,
          ],
        ].map(([label, value]) => (
          <Paper key={label} sx={{ p: 2 }} variant="outlined">
            <Typography color="text.secondary" variant="caption">
              {label}
            </Typography>
            <Typography variant="h4">{value}</Typography>
          </Paper>
        ))}
      </Box>
      <Typography color="text.secondary" sx={{ mt: 2 }}>
        Latest Agent Session activity:{" "}
        {formatDate(evidence.latestAgentSessionActivityAt)}
      </Typography>
      <Paper
        data-testid="organization-entitlement-panel"
        sx={{ p: { xs: 2, md: 3 }, mt: 3 }}
        variant="outlined"
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="h6">Account access</Typography>
            <Stack direction="row" spacing={1} sx={{ my: 1 }}>
              <Chip label={entitlement.subscriptionType} size="small" />
              <Chip label={entitlement.accessStatus} size="small" />
            </Stack>
            <Typography color="text.secondary" variant="body2">
              {entitlement.subscriptionType === "PAID"
                ? "Paid through"
                : "Access through"}
            </Typography>
            <Typography fontWeight={600}>{horizonLabel}</Typography>
          </Box>
          {canMakeAccessPermanent && (
            <Button
              onClick={() => setConfirmationOpen(true)}
              sx={{ alignSelf: { xs: "stretch", md: "center" } }}
              variant="contained"
            >
              Make access permanent
            </Button>
          )}
        </Stack>
        {makeAccessPermanent.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {entitlementFailureMessage(makeAccessPermanent.error)}
          </Alert>
        )}
      </Paper>
      <Box
        data-testid="organization-evidence-desktop"
        sx={{
          display: { xs: "none", md: "grid" },
          gridTemplateColumns: "1fr 1fr",
          gap: 3,
          my: 4,
        }}
      >
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">Work items created · All time</Typography>
          {workItems}
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">Latest Agent Sessions</Typography>
          {sessions}
        </Paper>
      </Box>
      <Stack
        data-testid="organization-evidence-mobile"
        spacing={2}
        sx={{ display: { xs: "flex", md: "none" }, my: 3 }}
      >
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Work items by type</Typography>
          {workItems}
        </Paper>
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Latest Agent Sessions</Typography>
          {sessions}
        </Paper>
      </Stack>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h5">Members</Typography>
        <TextField
          fullWidth
          label="Search members"
          onChange={(event) => changeSearch(event.target.value)}
          sx={{ my: 2 }}
          value={name}
        />
        {!memberRows.length ? (
          <Typography color="text.secondary">No members found.</Typography>
        ) : (
          <>
            <Box
              data-testid="organization-members-desktop"
              sx={{ display: { xs: "none", md: "block" } }}
            >
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Member</TableCell>
                    <TableCell>Organization role</TableCell>
                    <TableCell>Projects</TableCell>
                    <TableCell>Last active</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {memberRows.map((member) => (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <Typography fontWeight={600}>{member.name}</Typography>
                        <Typography color="text.secondary" variant="body2">
                          {member.email}
                        </Typography>
                      </TableCell>
                      <TableCell>{member.organizationRole}</TableCell>
                      <TableCell>{member.projectCount}</TableCell>
                      <TableCell>{member.lastActive}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Stack
              data-testid="organization-members-mobile"
              spacing={1.5}
              sx={{ display: { xs: "flex", md: "none" } }}
            >
              {memberRows.map((member) => (
                <Paper key={member.userId} sx={{ p: 2 }} variant="outlined">
                  <Typography fontWeight={600}>{member.name}</Typography>
                  <Typography color="text.secondary">{member.email}</Typography>
                  <Typography>
                    {member.organizationRole} · {member.projectCount} projects
                  </Typography>
                  <Typography variant="body2">
                    Last active {member.lastActive}
                  </Typography>
                </Paper>
              ))}
            </Stack>
          </>
        )}
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
          <Typography color="text.secondary">
            {members.totalCount} members
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              disabled={!history.length || members.isFetching}
              onClick={() => {
                setCursor(history.at(-1));
                setHistory((items) => items.slice(0, -1));
              }}
            >
              Previous
            </Button>
            <Button
              disabled={!members.nextCursor || members.isFetching}
              onClick={() => {
                setHistory((items) => [...items, cursor]);
                setCursor(members.nextCursor ?? undefined);
              }}
            >
              Next
            </Button>
          </Stack>
        </Stack>
      </Paper>
      <Dialog
        ownerKey={confirmationOpenOwnerKey}
        fullWidth
        maxWidth="sm"
        onClose={() =>
          !makeAccessPermanent.isPending && setConfirmationOpen(false)
        }
        open={confirmationOpen}
      >
        <DialogTitle>Make beta access permanent?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            This removes the beta expiry. Future access will continue until it
            is explicitly revoked.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="Reason"
            multiline
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </DialogContent>
        <DialogActions>
          <Button
            disabled={makeAccessPermanent.isPending}
            onClick={() => setConfirmationOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || makeAccessPermanent.isPending}
            onClick={() => {
              void makeAccessPermanent
                .mutate({
                  organizationId,
                  expectedRevision: entitlement.revision,
                  reason: reason.trim(),
                })
                .then(async () => {
                  await detail.refetch();
                  setConfirmationOpen(false);
                  setReason("");
                })
                .catch(() => undefined);
            }}
            variant="contained"
          >
            {makeAccessPermanent.isPending
              ? "Saving…"
              : "Confirm permanent access"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};
