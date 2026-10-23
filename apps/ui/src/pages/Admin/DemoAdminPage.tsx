import axios from "axios";
import type { DemoSandboxProgramDto } from "@hey-hey/ui-common/api";
import { useOrganization } from "@hey-hey/ui-common/context";
import { useDemoSandboxAdmin, useProjects } from "@hey-hey/ui-common/data";
import {
  Alert,
  Button,
  CircularProgress,
  Container,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type LimitsDraft = Record<
  "activeCap" | "perIpLimit" | "perIpWindowSeconds",
  string
>;

const toDraft = (program: DemoSandboxProgramDto): LimitsDraft => ({
  activeCap: String(program.activeCap),
  perIpLimit: String(program.perIpLimit),
  perIpWindowSeconds: String(program.perIpWindowSeconds),
});

type Limits = Omit<DemoSandboxProgramDto, "enabled">;

const parseLimits = (draft: LimitsDraft): Limits | null => {
  const [activeCap, perIpLimit, perIpWindowSeconds] = [
    draft.activeCap,
    draft.perIpLimit,
    draft.perIpWindowSeconds,
  ].map((value) => (/^\d+$/.test(value.trim()) ? Number(value) : NaN));
  if (
    Number.isNaN(activeCap) ||
    !(perIpLimit >= 1) ||
    !(perIpWindowSeconds >= 1)
  )
    return null;
  return { activeCap, perIpLimit, perIpWindowSeconds };
};

// Surfaces the server's own reason (e.g. a repository that isn't public).
const serverMessage = (error: unknown): string | null => {
  if (!axios.isAxiosError(error)) return null;
  const message: unknown = (error.response?.data as { message?: unknown })
    ?.message;
  return typeof message === "string" ? message : null;
};

export const DemoAdminPage: React.FC = () => {
  const { t } = useTranslation();
  const demo = useDemoSandboxAdmin();
  const { currentOrganization } = useOrganization();
  const { projects } = useProjects(currentOrganization?.id);

  const program = demo.data?.program ?? null;
  const template = demo.data?.template ?? null;
  const [limits, setLimits] = useState<LimitsDraft | null>(null);
  const [projectId, setProjectId] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (program) setLimits(toDraft(program));
  }, [program]);
  useEffect(() => {
    setProjectId(template?.projectId ?? "");
    setRepositoryUrl(template?.repositoryUrl ?? "");
  }, [template]);

  if (demo.error && !demo.data) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error" data-testid="demo-admin-load-error">
          {t("admin.demo.loadError")}
        </Alert>
      </Container>
    );
  }
  if (!demo.data || !program || !limits) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <CircularProgress data-testid="demo-admin-loading" />
      </Container>
    );
  }

  const parsedLimits = parseLimits(limits);
  const saving = demo.updateProgram.isPending || demo.setTemplate.isPending;

  const saveProgram = async (next: DemoSandboxProgramDto) => {
    setError(null);
    try {
      await demo.updateProgram.mutate(next);
    } catch (caught) {
      setError(serverMessage(caught) ?? t("admin.demo.saveError"));
    }
  };
  const saveLimits = () =>
    parsedLimits && saveProgram({ ...program, ...parsedLimits });
  const saveTemplate = async () => {
    setError(null);
    try {
      await demo.setTemplate.mutate({
        projectId,
        repositoryUrl: repositoryUrl.trim(),
      });
    } catch (caught) {
      setError(serverMessage(caught) ?? t("admin.demo.saveError"));
    }
  };

  const templateProjectName =
    template &&
    (projects.find((project) => project.id === template.projectId)?.name ??
      template.projectId);
  const projectOptions =
    template && !projects.some((project) => project.id === template.projectId)
      ? [{ id: template.projectId, name: template.projectId }, ...projects]
      : projects;

  return (
    <Container maxWidth="md" sx={{ py: 4 }} data-testid="demo-admin-page">
      <Stack spacing={3}>
        <Typography variant="h5" component="h2">
          {t("admin.demo.title")}
        </Typography>

        {error && (
          <Alert severity="error" data-testid="demo-admin-error">
            {error}
          </Alert>
        )}
        {!template && (
          <Alert severity="warning" data-testid="demo-admin-no-template">
            {t("admin.demo.noTemplate")}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <FormControlLabel
              label={t("admin.demo.enabled.label")}
              control={
                <Switch
                  checked={program.enabled}
                  disabled={saving || (!program.enabled && !template)}
                  onChange={(event) =>
                    void saveProgram({
                      ...program,
                      enabled: event.target.checked,
                    })
                  }
                  slotProps={{
                    input: {
                      "data-testid": "demo-admin-enabled",
                    } as React.InputHTMLAttributes<HTMLInputElement>,
                  }}
                />
              }
            />
            <Typography variant="body2" color="text.secondary">
              {t("admin.demo.enabled.help")}
            </Typography>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ minWidth: 240 }}>
                {t("admin.demo.activeNow")}
              </Typography>
              <Typography data-testid="demo-admin-active-count">
                {demo.data.activeCount} / {program.activeCap}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("admin.demo.activeNowNote")}
            </Typography>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6" component="h3">
              {t("admin.demo.limits.title")}
            </Typography>
            {(["activeCap", "perIpLimit", "perIpWindowSeconds"] as const).map(
              (field) => (
                <TextField
                  key={field}
                  type="number"
                  size="small"
                  label={t(`admin.demo.limits.${field}`)}
                  value={limits[field]}
                  onChange={(event) =>
                    setLimits({ ...limits, [field]: event.target.value })
                  }
                  slotProps={{
                    htmlInput: {
                      min: field === "activeCap" ? 0 : 1,
                      "data-testid": `demo-admin-${field}`,
                    },
                  }}
                />
              ),
            )}
            {!parsedLimits && (
              <Alert severity="warning">{t("admin.demo.limits.invalid")}</Alert>
            )}
            <Button
              variant="contained"
              sx={{ alignSelf: "flex-start" }}
              data-testid="demo-admin-save-limits"
              disabled={saving || !parsedLimits}
              onClick={() => void saveLimits()}
            >
              {t("admin.demo.limits.save")}
            </Button>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6" component="h3">
              {t("admin.demo.template.title")}
            </Typography>
            <Typography data-testid="demo-admin-template-current">
              {template
                ? `${templateProjectName} · ${template.repositoryUrl}`
                : t("admin.demo.template.none")}
            </Typography>
            <FormControl size="small">
              <InputLabel id="demo-admin-template-project-label">
                {t("admin.demo.template.project")}
              </InputLabel>
              <Select
                labelId="demo-admin-template-project-label"
                label={t("admin.demo.template.project")}
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                inputProps={{ "data-testid": "demo-admin-template-project" }}
              >
                {projectOptions.map((project) => (
                  <MenuItem key={project.id} value={project.id}>
                    {project.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label={t("admin.demo.template.repository")}
              helperText={t("admin.demo.template.repositoryHelp")}
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
              slotProps={{
                htmlInput: { "data-testid": "demo-admin-template-repository" },
              }}
            />
            <Button
              variant="contained"
              sx={{ alignSelf: "flex-start" }}
              data-testid="demo-admin-save-template"
              disabled={saving || !projectId || !repositoryUrl.trim()}
              onClick={() => void saveTemplate()}
            >
              {t("admin.demo.template.save")}
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
};
