import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { ProposalList } from "@hey-hey/ui-common/components";
import { proposalsClient } from "@hey-hey/ui-common/clients";
import {
  Alert,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
} from "@mui/material";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ProposalResponseDto } from "@hey-hey/ui-common/api";
import {
  ProposalAction as ProposalActionEnum,
  ProposalStatus as ProposalStatusEnum,
  ProposalType as ProposalTypeEnum,
  TargetEntityType as TargetEntityTypeEnum,
} from "@hey-hey/ui-common/api";
import { proposalReviewPath } from "./proposalReviewPath";

const SORT_OPTIONS = ["newest", "oldest", "status"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const STATUS_FILTER_VALUES = [
  "",
  ...Object.values(ProposalStatusEnum),
] as const;
const TYPE_FILTER_VALUES = ["", ...Object.values(ProposalTypeEnum)] as const;
const ACTION_FILTER_VALUES = [
  "",
  ...Object.values(ProposalActionEnum),
] as const;
const TARGET_FILTER_VALUES = [
  "",
  ...Object.values(TargetEntityTypeEnum),
] as const;

function sortProposals(
  proposals: ProposalResponseDto[],
  sortBy: SortOption,
): ProposalResponseDto[] {
  const sorted = [...proposals];
  switch (sortBy) {
    case "newest":
      return sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case "oldest":
      return sorted.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    case "status":
      return sorted.sort((a, b) => a.status.localeCompare(b.status));
    default:
      return sorted;
  }
}

const PAGE_SIZE = 20;

export const ProposalsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrgId } = useUserIdentity() || {};
  const navigate = useNavigate();

  const [proposals, setProposals] = useState<ProposalResponseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const [page, setPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1),
  );
  const [statusFilter, setStatusFilter] = useQueryState(
    "status",
    parseAsStringLiteral(STATUS_FILTER_VALUES).withDefault(""),
  );
  const [typeFilter, setTypeFilter] = useQueryState(
    "type",
    parseAsStringLiteral(TYPE_FILTER_VALUES).withDefault(""),
  );
  const [actionFilter, setActionFilter] = useQueryState(
    "action",
    parseAsStringLiteral(ACTION_FILTER_VALUES).withDefault(""),
  );
  const [targetTypeFilter, setTargetTypeFilter] = useQueryState(
    "target",
    parseAsStringLiteral(TARGET_FILTER_VALUES).withDefault(""),
  );
  const [sortBy, setSortBy] = useQueryState(
    "sort",
    parseAsStringLiteral(SORT_OPTIONS).withDefault("newest"),
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadProposals = useCallback(async () => {
    if (!projectId || !currentOrgId) return;

    setLoading(true);
    setError(null);

    try {
      const offset = (page - 1) * PAGE_SIZE;
      const response =
        await proposalsClient.listProposals(
          {
            organizationId: currentOrgId,
            projectId,
            type: typeFilter || undefined,
            action: actionFilter || undefined,
            status: statusFilter || undefined,
            targetEntityType: targetTypeFilter || undefined,
            limit: PAGE_SIZE,
            offset,
          },
        );

      const body = response.data as {
        data?: { data: ProposalResponseDto[]; total: number };
      };
      const data = body?.data?.data ?? [];
      const responseTotal = body?.data?.total ?? 0;

      setProposals(data);
      setTotal(responseTotal);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load proposals";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    projectId,
    currentOrgId,
    page,
    statusFilter,
    typeFilter,
    actionFilter,
    targetTypeFilter,
  ]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, actionFilter, targetTypeFilter, setPage]);

  const sortedProposals = useMemo(
    () => sortProposals(proposals, sortBy),
    [proposals, sortBy],
  );

  const getProposalHref = useCallback(
    (proposal: ProposalResponseDto) => proposalReviewPath(projectId!, proposal),
    [projectId],
  );

  const handleClickProposal = (
    proposal: ProposalResponseDto,
    event: React.MouseEvent<HTMLElement>,
  ): void => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    navigate(proposalReviewPath(projectId!, proposal));
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 2,
            alignItems: "center",
          }}
        >
          <Box
            sx={{
              flex: { md: "0 0 150px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value as (typeof STATUS_FILTER_VALUES)[number],
                  )
                }
                label="Status"
              >
                <MenuItem value="">All Statuses</MenuItem>
                {Object.values(ProposalStatusEnum).map((s) => (
                  <MenuItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box
            sx={{
              flex: { md: "0 0 150px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(
                    e.target.value as (typeof TYPE_FILTER_VALUES)[number],
                  )
                }
                label="Type"
              >
                <MenuItem value="">All Types</MenuItem>
                {Object.values(ProposalTypeEnum).map((t) => (
                  <MenuItem key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box
            sx={{
              flex: { md: "0 0 150px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth size="small">
              <InputLabel>Action</InputLabel>
              <Select
                value={actionFilter}
                onChange={(e) =>
                  setActionFilter(
                    e.target.value as (typeof ACTION_FILTER_VALUES)[number],
                  )
                }
                label="Action"
              >
                <MenuItem value="">All Actions</MenuItem>
                {Object.values(ProposalActionEnum).map((a) => (
                  <MenuItem key={a} value={a}>
                    {a.charAt(0) + a.slice(1).toLowerCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box
            sx={{
              flex: { md: "0 0 170px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth size="small">
              <InputLabel>Target Type</InputLabel>
              <Select
                value={targetTypeFilter}
                onChange={(e) =>
                  setTargetTypeFilter(
                    e.target.value as (typeof TARGET_FILTER_VALUES)[number],
                  )
                }
                label="Target Type"
              >
                <MenuItem value="">All Targets</MenuItem>
                {Object.values(TargetEntityTypeEnum).map((t) => (
                  <MenuItem key={t} value={t}>
                    {t.replace(/_/g, " ").charAt(0) +
                      t.replace(/_/g, " ").slice(1).toLowerCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box
            sx={{
              flex: { md: "0 0 150px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth size="small">
              <InputLabel>Sort</InputLabel>
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                label="Sort"
              >
                <MenuItem value="newest">Newest first</MenuItem>
                <MenuItem value="oldest">Oldest first</MenuItem>
                <MenuItem value="status">Status</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <ProposalList
        proposals={sortedProposals}
        loading={loading}
        onClickProposal={handleClickProposal}
        getProposalHref={getProposalHref}
      />

      {totalPages > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, newPage) => setPage(newPage)}
            color="primary"
            showFirstButton
            showLastButton
          />
        </Box>
      )}
    </Box>
  );
};
