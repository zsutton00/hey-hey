import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Pagination,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePathService } from "../../contexts";
import { useProjectReadyFutures } from "../../data/hooks/useProjectReadyFutures";
import { Card } from "../Card";

export function ProjectReadyFutures({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const [page, setPage] = useState(1);
  const query = useProjectReadyFutures(organizationId, projectId, page);
  const paths = usePathService();
  const navigate = useNavigate();
  return (
    <Card
      title="Ready to apply"
      dataTestId="project-ready-futures"
      titleAccessory={
        query.data && !query.isError ? (
          <Chip size="small" label={query.data.total} />
        ) : undefined
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Reviewed changes with implementation work ready. Apply each change
          after reviewing it.
        </Typography>
        {query.isPending && (
          <CircularProgress aria-label="Loading ready changes" size={24} />
        )}
        {query.isError ? (
          <Alert
            severity="error"
            action={
              <Button
                data-testid="ready-futures-retry"
                onClick={() => void query.refetch()}
              >
                Retry
              </Button>
            }
          >
            We couldn&apos;t load ready changes.
          </Alert>
        ) : (
          query.data && (
            <>
              {query.data.unavailableCount > 0 && (
                <Alert
                  severity="warning"
                  action={
                    <Button
                      data-testid="ready-futures-retry"
                      onClick={() => void query.refetch()}
                    >
                      Retry
                    </Button>
                  }
                >
                  Some changes could not be loaded.
                </Alert>
              )}
              {query.data.items.length === 0 &&
                query.data.unavailableCount === 0 && (
                  <Typography>
                    {query.data.total > 0
                      ? "No ready changes on this page."
                      : "No ready changes."}
                  </Typography>
                )}
              {query.data.items.map((item) => {
                const permissionDenied =
                  item.applicability.blockers.includes("PERMISSION_DENIED");
                const baselineUnavailable =
                  item.applicability.blockers.includes("BASELINE_UNAVAILABLE");
                const drift = item.applicability.blockers.some(
                  (blocker) =>
                    blocker === "BASELINE_CHANGED" ||
                    blocker === "BASELINE_UNAVAILABLE",
                );
                return (
                  <Box
                    key={item.futureId}
                    data-testid="ready-future-entry"
                    data-future-id={item.futureId}
                    sx={{
                      borderBottom: 1,
                      borderColor: "divider",
                      pb: 2,
                      overflowWrap: "anywhere",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {item.targetType} · {item.targetName}
                    </Typography>
                    <Typography variant="subtitle1">
                      {item.proposalTitle}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ my: 1 }}>
                      <Chip size="small" label="Approved" />
                      <Chip size="small" label="Work ready" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {drift
                        ? `${baselineUnavailable ? "Baseline unavailable" : "Baseline changed"} · Not applied · Reconciliation required`
                        : "Baseline current · Not applied"}
                    </Typography>
                    {permissionDenied && (
                      <Typography variant="body2" color="text.secondary">
                        You don&apos;t have permission to apply this change.
                      </Typography>
                    )}
                    <Button
                      data-testid="review-ready-future"
                      sx={{ mt: 1, whiteSpace: "normal" }}
                      onClick={() =>
                        navigate(
                          item.reviewGroupId
                            ? paths.proposalGroup({
                                projectId,
                                groupId: item.reviewGroupId,
                              })
                            : paths.proposal({
                                projectId,
                                proposalId: item.proposalId,
                              }),
                        )
                      }
                    >
                      {permissionDenied
                        ? "Review change"
                        : drift
                          ? "Review reconciliation"
                          : item.applicability.canApply
                            ? "Review & apply"
                            : "Review change"}
                    </Button>
                  </Box>
                );
              })}
              {(query.data.total > 10 || page > 1) && (
                <Pagination
                  data-testid="ready-futures-pagination"
                  count={Math.max(page, Math.ceil(query.data.total / 10))}
                  page={page}
                  onChange={(_, value) => setPage(value)}
                  aria-label="Ready changes pages"
                />
              )}
            </>
          )
        )}
        <Typography variant="caption" color="text.secondary">
          Outstanding changes for this project, regardless of activity period.
        </Typography>
      </Stack>
    </Card>
  );
}
