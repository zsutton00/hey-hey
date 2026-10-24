import { useEffect, useState } from "react";
import { Button, Stack, Typography } from "@mui/material";
import { OpenInNew } from "@mui/icons-material";
import type { ChangeWalkthroughExcerpt } from "../../../api";
import {
  createDirectoryBindingApi,
  resolveLocalDirectoryRuntimeBaseUrl,
  resolveWalkthroughSource,
} from "../../AgentSession/runtime/directoryBindingApi";
import {
  buildExternalEditorUrl,
  readExternalEditorPreference,
  type ExternalEditorPreference,
} from "../../EditorPreference/editorPreference";
import { ExternalEditorPreferenceDialog } from "../../EditorPreference/ExternalEditorPreferenceDialog";
import { FILE_REFERENCE_FONT_FAMILY } from "../../SmarterTextAreaCard/fileReferences/FileReferenceLink";

export function WalkthroughSourceLink({
  excerpt,
  runId,
}: {
  excerpt: ChangeWalkthroughExcerpt;
  runId: string;
}) {
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [setup, setSetup] = useState(false);
  const eligible = excerpt.sourceVersion.kind === "WORKSPACE";
  const resolve = async () => {
    const baseUrl = resolveLocalDirectoryRuntimeBaseUrl();
    const repos = await createDirectoryBindingApi(baseUrl).listRepos();
    if (
      !repos.bindings.some((binding) => binding.serviceId === excerpt.serviceId)
    ) {
      throw new Error("Service is not mapped on this machine");
    }
    return resolveWalkthroughSource(baseUrl, runId, repos.machineId, excerpt);
  };
  useEffect(() => {
    let cancelled = false;
    setAvailable(false);
    if (eligible)
      void resolve()
        .then(() => {
          if (!cancelled) setAvailable(true);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runId, excerpt, eligible]);
  const open = async (preference: ExternalEditorPreference) => {
    setPending(true);
    try {
      const source = await resolve();
      window.open(
        buildExternalEditorUrl(preference, source),
        "_self",
        "noopener,noreferrer",
      );
    } catch {
      setAvailable(false);
    } finally {
      setPending(false);
    }
  };
  return (
    <Stack spacing={0.5}>
      <Button
        data-testid="walkthrough-source"
        data-service-id={excerpt.serviceId}
        disabled={!available || pending}
        sx={{
          textTransform: "none",
          fontFamily: FILE_REFERENCE_FONT_FAMILY,
          display: "block",
          width: "100%",
          minWidth: 0,
          textAlign: "left",
          whiteSpace: "normal",
          overflowWrap: "anywhere",
          wordBreak: "normal",
        }}
        onClick={() => {
          const preference = readExternalEditorPreference();
          if (preference) void open(preference);
          else setSetup(true);
        }}
      >
        {available && (
          <OpenInNew
            data-testid="walkthrough-source-open-icon"
            aria-hidden
            sx={{ fontSize: "1em", verticalAlign: "middle", mr: 0.75 }}
          />
        )}
        {excerpt.file}:{excerpt.startLine}–{excerpt.endLine}
      </Button>
      {eligible && !available && (
        <Typography variant="caption">
          Current source opening unavailable
        </Typography>
      )}
      <ExternalEditorPreferenceDialog
        open={setup}
        onCancel={() => setSetup(false)}
        onSaved={(preference) => {
          setSetup(false);
          void open(preference);
        }}
      />
    </Stack>
  );
}
