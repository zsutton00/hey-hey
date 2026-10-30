import { Alert, CircularProgress, Stack, Typography } from "@mui/material";
import { ImplementationHintReadView } from "@hey-hey/ui-common/components";
import { useImplementationHints } from "@hey-hey/ui-common/data";

interface ServiceImplementationHintsTabProps {
  organizationId: string;
  serviceId: string;
}

export function ServiceImplementationHintsTab({
  organizationId,
  serviceId,
}: ServiceImplementationHintsTabProps) {
  const { hints, isLoading, error } = useImplementationHints(
    organizationId,
    serviceId,
    { enabled: Boolean(organizationId && serviceId) },
  );

  if (isLoading)
    return <CircularProgress aria-label="Loading implementation hints" />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2} data-testid="service-implementation-hints">
      {hints.length === 0 ? (
        <Typography color="text.secondary">
          No implementation hints available yet.
        </Typography>
      ) : (
        hints.map((hint) => (
          <ImplementationHintReadView key={hint.id} hint={hint} />
        ))
      )}
    </Stack>
  );
}
