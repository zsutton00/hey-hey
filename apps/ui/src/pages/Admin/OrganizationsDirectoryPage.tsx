import {
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
} from "@hey-hey/ui-common/api";
import { useOrganizationsDirectory } from "@hey-hey/ui-common/data";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

const PAGE_SIZE = 25;

const formatCreatedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
};

const entitlementStatus = {
  ACTIVE: { label: "Active", color: "success" },
  REVOKED: { label: "Suspended", color: "warning" },
  EXPIRED: { label: "Expired", color: "default" },
} as const;

const EntitlementBadge: React.FC<{
  subscriptionType: "BETA" | "PAID";
  accessStatus: "ACTIVE" | "REVOKED" | "EXPIRED";
}> = ({ subscriptionType, accessStatus }) => {
  const status = entitlementStatus[accessStatus];
  const subscriptionLabel = subscriptionType === "BETA" ? "Beta" : "Paid";
  return (
    <Chip
      color={status.color}
      label={`${subscriptionLabel} · ${status.label}`}
      size="small"
      variant="outlined"
    />
  );
};

export const OrganizationsDirectoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [sortBy, setSortBy] = useState<OrganizationDirectorySortBy>(
    OrganizationDirectorySortBy.CreatedAt
  );
  const [sortOrder, setSortOrder] = useState<OrganizationDirectorySortOrder>(
    OrganizationDirectorySortOrder.Desc
  );
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>(
    []
  );

  const resetPagination = useCallback(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, []);

  const directory = useOrganizationsDirectory({
    name,
    sortBy,
    sortOrder,
    cursor,
    limit: PAGE_SIZE,
  });

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      resetPagination();
    },
    [resetPagination]
  );

  const handleSortByChange = useCallback(
    (event: SelectChangeEvent<OrganizationDirectorySortBy>) => {
      setSortBy(event.target.value as OrganizationDirectorySortBy);
      resetPagination();
    },
    [resetPagination]
  );

  const handleSortOrderChange = useCallback(
    (event: SelectChangeEvent<OrganizationDirectorySortOrder>) => {
      setSortOrder(event.target.value as OrganizationDirectorySortOrder);
      resetPagination();
    },
    [resetPagination]
  );

  const handleNextPage = useCallback(() => {
    if (!directory.nextCursor) {
      return;
    }
    setCursorHistory((history) => [...history, cursor]);
    setCursor(directory.nextCursor);
  }, [cursor, directory.nextCursor]);

  const handlePreviousPage = useCallback(() => {
    if (cursorHistory.length === 0) {
      return;
    }
    const previousCursor = cursorHistory[cursorHistory.length - 1];
    setCursor(previousCursor);
    setCursorHistory(cursorHistory.slice(0, -1));
  }, [cursorHistory]);

  const renderPagination = () => (
    <Stack
      alignItems={{ xs: "stretch", sm: "center" }}
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      spacing={2}
      sx={{ mt: 3 }}
    >
      <Typography color="text.secondary" variant="body2">
        {directory.totalCount} organization
        {directory.totalCount === 1 ? "" : "s"}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button
          aria-label="Previous page"
          disabled={cursorHistory.length === 0 || directory.isFetching}
          onClick={handlePreviousPage}
          variant="outlined"
        >
          Previous
        </Button>
        <Button
          aria-label="Next page"
          disabled={!directory.nextCursor || directory.isFetching}
          onClick={handleNextPage}
          variant="outlined"
        >
          Next
        </Button>
      </Stack>
    </Stack>
  );

  return (
    <Container
      component="main"
      data-testid="organizations-directory-page"
      maxWidth="xl"
      sx={{ py: { xs: 3, md: 5 } }}
    >
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">
          Organizations
        </Typography>
        <Typography color="text.secondary">
          Review organizations across the platform. Visibility is controlled by
          server authorization.
        </Typography>
      </Stack>

      {directory.isForbidden ? (
        <Alert severity="warning">
          You are not authorized to view the Organizations directory.
        </Alert>
      ) : directory.error ? (
        <Stack alignItems="flex-start" spacing={2}>
          <Alert severity="error">
            The Organizations directory could not be loaded.
          </Alert>
          <Button onClick={() => void directory.refetch()} variant="contained">
            Retry
          </Button>
        </Stack>
      ) : (
        <>
          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              sx={{ mb: 3 }}
            >
              <TextField
                fullWidth
                label="Search organizations"
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder="Search by organization name"
                value={name}
              />
              <FormControl sx={{ minWidth: { md: 210 } }}>
                <InputLabel id="organizations-directory-sort-by-label">
                  Sort by
                </InputLabel>
                <Select
                  label="Sort by"
                  labelId="organizations-directory-sort-by-label"
                  onChange={handleSortByChange}
                  value={sortBy}
                >
                  <MenuItem value={OrganizationDirectorySortBy.CreatedAt}>
                    Created
                  </MenuItem>
                  <MenuItem value={OrganizationDirectorySortBy.Name}>
                    Name
                  </MenuItem>
                  <MenuItem value={OrganizationDirectorySortBy.MemberCount}>
                    Members
                  </MenuItem>
                </Select>
              </FormControl>
              <FormControl sx={{ minWidth: { md: 170 } }}>
                <InputLabel id="organizations-directory-sort-order-label">
                  Direction
                </InputLabel>
                <Select
                  label="Direction"
                  labelId="organizations-directory-sort-order-label"
                  onChange={handleSortOrderChange}
                  value={sortOrder}
                >
                  <MenuItem value={OrganizationDirectorySortOrder.Desc}>
                    Newest / highest
                  </MenuItem>
                  <MenuItem value={OrganizationDirectorySortOrder.Asc}>
                    Oldest / lowest
                  </MenuItem>
                </Select>
              </FormControl>
            </Stack>

            {directory.isLoading && !directory.isFetched ? (
              <Box aria-live="polite" role="status" sx={{ py: 6 }}>
                <Typography color="text.secondary">
                  Loading organizations…
                </Typography>
              </Box>
            ) : directory.organizations.length === 0 ? (
              <Box aria-live="polite" role="status" sx={{ py: 6 }}>
                <Typography variant="h6">No organizations found</Typography>
                <Typography color="text.secondary">
                  Try a different name or clear the search filter.
                </Typography>
              </Box>
            ) : (
              <>
                <Box
                  data-testid="organizations-directory-desktop"
                  sx={{ display: { xs: "none", md: "block" } }}
                >
                  <TableContainer>
                    <Table aria-label="Organizations directory">
                      <TableHead>
                        <TableRow>
                          <TableCell>Organization</TableCell>
                          <TableCell>Created</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Members</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {directory.organizations.map((organization) => (
                          <TableRow
                            hover
                            key={organization.id}
                            onClick={() =>
                              navigate(
                                `/admin/organizations/${organization.id}`
                              )
                            }
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell>
                              <Typography fontWeight={600}>
                                {organization.name}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              {formatCreatedAt(organization.createdAt)}
                            </TableCell>
                            <TableCell>
                              <EntitlementBadge
                                accessStatus={organization.accessStatus}
                                subscriptionType={organization.subscriptionType}
                              />
                            </TableCell>
                            <TableCell align="right">
                              {organization.memberCount}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>

                <Box
                  data-testid="organizations-directory-mobile"
                  sx={{ display: { xs: "block", md: "none" } }}
                >
                  <Stack spacing={1.5}>
                    {directory.organizations.map((organization) => (
                      <Paper
                        component="article"
                        key={organization.id}
                        onClick={() =>
                          navigate(`/admin/organizations/${organization.id}`)
                        }
                        role="link"
                        sx={{ p: 2 }}
                        variant="outlined"
                      >
                        <Stack spacing={1.5}>
                          <Stack
                            alignItems="center"
                            direction="row"
                            justifyContent="space-between"
                            spacing={1}
                          >
                            <Typography fontWeight={600} variant="h6">
                              {organization.name}
                            </Typography>
                            <EntitlementBadge
                              accessStatus={organization.accessStatus}
                              subscriptionType={organization.subscriptionType}
                            />
                          </Stack>
                          <Stack direction="row" spacing={4}>
                            <Box>
                              <Typography
                                color="text.secondary"
                                variant="caption"
                              >
                                Created
                              </Typography>
                              <Typography variant="body2">
                                {formatCreatedAt(organization.createdAt)}
                              </Typography>
                            </Box>
                            <Box>
                              <Typography
                                color="text.secondary"
                                variant="caption"
                              >
                                Members
                              </Typography>
                              <Typography variant="body2">
                                {organization.memberCount}
                              </Typography>
                            </Box>
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              </>
            )}
          </Paper>
          {directory.isReady && renderPagination()}
        </>
      )}
    </Container>
  );
};
