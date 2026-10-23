import axios from "axios";
import type { PrivateBetaAccessRequestReviewDto } from "@hey-hey/ui-common/api";
import {
  usePrivateBetaAccessRequest,
  usePrivateBetaAccessRequestDecision,
  usePrivateBetaAccessRequests,
} from "@hey-hey/ui-common/data";
import { Alert, Box, Container, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { PrivateBetaAccessRequestDetail } from "./PrivateBetaAccessRequestDetail";
import { PrivateBetaAccessRequestList } from "./PrivateBetaAccessRequestList";
import { PrivateBetaAdmissionModeControl } from "./PrivateBetaAdmissionModeControl";

const safeDecisionError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    switch (error.response?.status) {
      case 401:
        return "Your session is no longer authorized. Sign in again and retry.";
      case 403:
        return "You are not authorized to manage beta access requests.";
      case 404:
        return "This access request is no longer available. Refresh the list.";
      case 409:
        return "The request changed before this decision was saved. Refresh and review the current result.";
      default:
        break;
    }
  }

  return "The decision could not be saved. Refresh and try again.";
};

export const PrivateBetaAccessPage: React.FC = () => {
  const requests = usePrivateBetaAccessRequests();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    if (
      selectedRequestId &&
      requests.data.some((request) => request.requestId === selectedRequestId)
    ) {
      return;
    }

    setSelectedRequestId(requests.data[0]?.requestId ?? null);
  }, [requests.data, selectedRequestId]);

  const selectedRequest = usePrivateBetaAccessRequest(
    selectedRequestId ?? undefined,
    {
      enabled: Boolean(selectedRequestId),
    },
  );
  const decision = usePrivateBetaAccessRequestDecision();

  const handleSelect = useCallback((requestId: string) => {
    setDecisionError(null);
    setSelectedRequestId(requestId);
  }, []);

  const handleDecision = useCallback(
    async (decisionValue: "APPROVE" | "REJECT"): Promise<void> => {
      if (!selectedRequestId) {
        return;
      }

      setDecisionError(null);
      try {
        await decision.mutate({
          requestId: selectedRequestId,
          decision: decisionValue,
        });
        await selectedRequest.refetch();
        await requests.refetch();
      } catch (error) {
        setDecisionError(safeDecisionError(error));
      }
    },
    [decision, requests, selectedRequest, selectedRequestId],
  );

  return (
    <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">
          Beta access
        </Typography>
        <Typography color="text.secondary">
          Review durable access requests and record the next approved or
          rejected outcome.
        </Typography>
      </Stack>

      {decisionError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {decisionError}
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        <PrivateBetaAdmissionModeControl />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: "minmax(280px, 360px) minmax(0, 1fr)",
          },
          gap: 3,
          alignItems: "start",
        }}
      >
        <PrivateBetaAccessRequestList
          requests={requests.data as PrivateBetaAccessRequestReviewDto[]}
          selectedRequestId={selectedRequestId}
          isLoading={requests.isLoading}
          error={requests.error}
          onSelect={handleSelect}
        />
        <PrivateBetaAccessRequestDetail
          request={selectedRequest.data}
          isLoading={Boolean(selectedRequestId) && selectedRequest.isLoading}
          error={selectedRequest.error}
          isActionPending={decision.isPending}
          onDecision={handleDecision}
        />
      </Box>
    </Container>
  );
};
