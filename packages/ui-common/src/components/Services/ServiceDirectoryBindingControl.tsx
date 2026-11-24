import LinkIcon from "@mui/icons-material/Link";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import type { ServiceRepoBinding } from "../../api";
import { useLocalRepoBindings } from "../../data/hooks/useLocalRepoBindings";
import {
  createDirectoryBindingApi,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../AgentSession/runtime/directoryBindingApi";

export interface ServiceDirectoryBindingControlProps {
  serviceId: string;
  serviceName?: string;
  /**
   * When supplied, the directory picker and binding write are constrained to
   * this paired machine. The local CLI identity is checked before writing.
   */
  machineId?: string | null;
  /**
   * Optional server/live-state result for callers that already know whether
   * this Service is bound on the selected machine.
   */
  isBound?: boolean;
  showPath?: boolean;
  /** Button text while no directory is linked. */
  unboundLabel?: string;
  /**
   * Renders just a link-style directory action, for a Service listed on one
   * line. The default is the stacked layout with the path and an outlined button.
   */
  inline?: boolean;
  onLinked?: (binding: ServiceRepoBinding) => void;
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;

export const ServiceDirectoryBindingControl = ({
  serviceId,
  serviceName = "this Service",
  machineId,
  isBound,
  showPath = true,
  unboundLabel = "Link directory",
  inline = false,
  onLinked,
}: ServiceDirectoryBindingControlProps) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const localBindings = useLocalRepoBindings();
  const localBinding = localBindings.bindingsByServiceId[serviceId];
  const hasBinding = isBound ?? localBinding !== undefined;
  const localApi = useMemo(
    () => createDirectoryBindingApi(resolveLocalDirectoryRuntimeBaseUrl()),
    [],
  );
  const [isLinking, setIsLinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = localBindings.refetch;

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    await refetch().catch(() => undefined);
  }, [refetch]);

  const linkDirectory = useCallback(async () => {
    setNotice(null);
    setError(null);
    setIsLinking(true);

    try {
      const listed = await localApi.listRepos();
      const targetMachineId = machineId ?? listed.machineId;
      if (machineId && listed.machineId !== machineId) {
        throw new Error(
          "The selected CLI machine is not the machine connected to this browser. Select the CLI running on this computer, then try linking again.",
        );
      }

      const picked = await localApi.pickDirectory(targetMachineId);
      if (picked.status === "cancelled") {
        setNotice("Directory linking was cancelled. No directory was linked.");
        return;
      }

      if (picked.machineId !== targetMachineId) {
        throw new Error(
          "The directory picker returned a different CLI machine. No directory was linked.",
        );
      }

      const binding = await localApi.setRepo(
        serviceId,
        targetMachineId,
        picked.repositoryPath,
      );
      await refetch().catch(() => {
        setNotice(
          "Directory linked, but the local binding list could not be refreshed.",
        );
      });
      onLinked?.(binding);
    } catch (linkError) {
      setError(
        getErrorMessage(
          linkError,
          `Failed to link a directory for ${serviceName}. Try again.`,
        ),
      );
    } finally {
      setIsLinking(false);
    }
  }, [localApi, machineId, onLinked, refetch, serviceId, serviceName]);

  if (
    localBindings.status === "loading" ||
    (localBindings.status === "fetching" && !localBinding)
  ) {
    return (
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        data-testid="service-directory-binding-control"
      >
        <CircularProgress aria-label="Loading local directory" size={24} />
        <Typography color="text.secondary">
          Loading local directory...
        </Typography>
      </Stack>
    );
  }

  if (localBindings.status === "error" && isCompact) {
    return (
      <Stack spacing={1.5} data-testid="service-directory-binding-control">
        <Typography color="text.secondary">
          A directory can only be linked from the computer running the CLI.
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack
      spacing={inline ? 0.5 : 1.5}
      data-testid="service-directory-binding-control"
    >
      {localBindings.status === "error" ? (
        <Alert
          severity="warning"
          data-testid="service-directory-binding-unreachable"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => void refresh()}
              disabled={isLinking}
              data-testid="service-directory-binding-try-again"
            >
              Try again
            </Button>
          }
        >
          Could not reach the local CLI on this computer. Make sure it is
          running, then try again or link a directory.
        </Alert>
      ) : null}
      {showPath && localBindings.status !== "error" ? (
        localBinding && hasBinding ? (
          <Typography
            component="code"
            data-testid="service-local-directory"
            sx={{ display: "block", overflowWrap: "anywhere" }}
          >
            {localBinding.repositoryPath}
          </Typography>
        ) : hasBinding ? (
          <Typography color="text.secondary">
            A directory is linked on the selected CLI machine.
          </Typography>
        ) : (
          <Typography color="text.secondary">
            No directory is linked on the connected local CLI.
          </Typography>
        )
      ) : null}
      <Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "flex-start", sm: "center" }}
        >
          <Button
            variant={inline ? "text" : "outlined"}
            size={inline ? "small" : "medium"}
            startIcon={inline ? undefined : <LinkIcon />}
            onClick={() => void linkDirectory()}
            disabled={isLinking}
            sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {isLinking
              ? hasBinding
                ? "Updating..."
                : "Linking..."
              : hasBinding
                ? "Update directory"
                : unboundLabel}
          </Button>
        </Stack>
      </Box>
      {notice ? <Alert severity="info">{notice}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  );
};
