import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { EvalCaseCoding } from "@hey-hey/contracts/api/models";
import { EvalTargetHandlerKey } from "@hey-hey/contracts/api";
import { useService } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

import { SpaLink } from "../EvalRun/SpaLink";
import { shortSha } from "../EvalRun/shortSha";

export interface EvalCaseCodingSectionProps {
  /** The stored Coding section content (JSON). */
  content: string;
  organizationId: string;
  projectId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Own guard: the only schema validator for this shape is zod in apps/api, which the UI cannot import.
export function isEvalCaseCoding(value: unknown): value is EvalCaseCoding {
  if (!isRecord(value) || !isRecord(value.pinnedCommit)) {
    return false;
  }

  const { serviceId, pinnedCommit, knownGoodDiff, knownBadDiff } = value;

  return (
    typeof serviceId === "string" &&
    typeof pinnedCommit.sha === "string" &&
    typeof pinnedCommit.shortMessage === "string" &&
    typeof knownGoodDiff === "string" &&
    typeof knownBadDiff === "string"
  );
}

function parseCoding(content: string): EvalCaseCoding | null {
  try {
    const parsed: unknown = JSON.parse(content);

    return isEvalCaseCoding(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The Coding section applies only to a case whose handler is `free_form`. */
export function isFreeFormEvalCase(
  sections:
    | ReadonlyArray<{ key: string; materializedMarkdown?: string | null }>
    | undefined,
): boolean {
  const handler = sections?.find((section) => section.key === "handler");

  return (
    handler?.materializedMarkdown?.trim() === EvalTargetHandlerKey.FreeForm
  );
}

const Field: React.FC<{
  id: string;
  label: string;
  accent?: string;
  children: React.ReactNode;
}> = ({ id, label, accent, children }) => (
  <Box
    data-hh-id={id}
    data-testid={id}
    sx={
      accent
        ? {
            flex: 1,
            minWidth: 0,
            pl: 1.5,
            borderLeft: 4,
            borderColor: accent,
          }
        : undefined
    }
  >
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Box>{children}</Box>
  </Box>
);

/**
 * Counts files and changed lines in a unified diff. Lines starting `---` or
 * `+++` are file headers only outside a hunk; inside one they are content (a
 * removed SQL comment reads `---`), so each hunk's header says how many lines
 * it holds.
 */
export function summarizeDiff(diff: string): {
  files: number;
  added: number;
  removed: number;
} {
  let files = 0;
  let added = 0;
  let removed = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let gitHeaderCounted = false;

  for (const line of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("-")) {
        removed += 1;
        oldLeft -= 1;
      } else if (line.startsWith("+")) {
        added += 1;
        newLeft -= 1;
      } else if (!line.startsWith("\\")) {
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }

    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = Number(hunk[1] ?? 1);
      newLeft = Number(hunk[2] ?? 1);
    } else if (line.startsWith("diff --git")) {
      files += 1;
      gitHeaderCounted = true;
    } else if (line.startsWith("+++ ")) {
      files += gitHeaderCounted ? 0 : 1;
      gitHeaderCounted = false;
    }
  }

  return { files, added, removed };
}

const DiffField: React.FC<{
  id: string;
  label: string;
  diff: string;
  accent: "success.main" | "error.main";
}> = ({ id, label, diff, accent }) => {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const { files, added, removed } = summarizeDiff(diff);

  return (
    <Field id={id} label={label} accent={accent}>
      <Typography variant="caption" color="text.secondary" component="div">
        {t("eval.case.coding.diffSummary", {
          count: files,
          added,
          removed,
        })}
      </Typography>
      <Button size="small" onClick={() => setOpen((value) => !value)}>
        {open ? t("eval.case.coding.hideDiff") : t("eval.case.coding.viewDiff")}
      </Button>
      {open ? (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1,
            overflow: "auto",
            fontSize: 12,
            bgcolor: "action.hover",
          }}
        >
          {diff}
        </Box>
      ) : null}
    </Field>
  );
};

/**
 * The Coding section of a free-form coding Eval Case: where the attempt
 * starts and the reference changes. Reviewer
 * and judge context only; the evaluated agent never sees it.
 */
export const EvalCaseCodingSection: React.FC<EvalCaseCodingSectionProps> = ({
  content,
  organizationId,
  projectId,
}) => {
  const { t } = useTranslation();
  const coding = parseCoding(content);
  const { data: service } = useService(organizationId, coding?.serviceId);

  if (!coding) {
    return <Alert severity="error">{t("eval.case.coding.invalid")}</Alert>;
  }

  return (
    <Box data-testid="work-item-section" data-section-key="coding">
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        {t("eval.case.coding.heading")}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mb: 1 }}
        data-hh-id="coding-hidden-note"
        data-testid="coding-hidden-note"
      >
        {t("eval.case.coding.hiddenNote")}
      </Typography>
      <Stack spacing={1.5}>
        <Field id="coding-service" label={t("eval.case.coding.service")}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">
              {service?.name ?? coding.serviceId}
            </Typography>
            <SpaLink
              testId="coding-open-service"
              href={WebPathService.service({
                projectId,
                serviceId: coding.serviceId,
              })}
            >
              {t("eval.case.coding.openService")}
            </SpaLink>
          </Stack>
        </Field>
        <Field id="coding-commit" label={t("eval.case.coding.commit")}>
          <Typography variant="body2">
            <code>{shortSha(coding.pinnedCommit.sha)}</code>{" "}
            {coding.pinnedCommit.shortMessage}
          </Typography>
        </Field>
        <Stack direction="row" spacing={1.5}>
          <DiffField
            id="coding-known-good"
            label={t("eval.case.coding.knownGood")}
            diff={coding.knownGoodDiff}
            accent="success.main"
          />
          <DiffField
            id="coding-known-bad"
            label={t("eval.case.coding.knownBad")}
            diff={coding.knownBadDiff}
            accent="error.main"
          />
        </Stack>
      </Stack>
    </Box>
  );
};
