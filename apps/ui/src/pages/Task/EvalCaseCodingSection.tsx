import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type {
  EvalCaseCoding,
  EvalCaseMockupChecklist,
} from "@hey-hey/contracts/api/models";
import { EvalTargetHandlerKey } from "@hey-hey/contracts/api";
import { useService } from "@hey-hey/ui-common/data";
import { SavedPatchDiffViewer } from "@hey-hey/ui-common/components";
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

function isMockupChecklist(value: unknown): value is EvalCaseMockupChecklist {
  return (
    isRecord(value) &&
    typeof value.mockupId === "string" &&
    (value.kind === "NEW" || value.kind === "UPDATE") &&
    Array.isArray(value.items) &&
    value.items.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.description === "string",
    )
  );
}

// Own guard: the only schema validator for this shape is zod in apps/api, which the UI cannot import.
export function isEvalCaseCoding(value: unknown): value is EvalCaseCoding {
  if (!isRecord(value) || !isRecord(value.pinnedCommit)) {
    return false;
  }

  const { serviceId, pinnedCommit, knownGoodDiff, knownBadDiff } = value;

  if (
    value.mockupChecklist !== undefined &&
    !isMockupChecklist(value.mockupChecklist)
  ) {
    return false;
  }

  return (
    typeof serviceId === "string" &&
    typeof pinnedCommit.sha === "string" &&
    typeof pinnedCommit.shortMessage === "string" &&
    (knownGoodDiff === undefined || typeof knownGoodDiff === "string") &&
    (knownBadDiff === undefined || typeof knownBadDiff === "string")
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

export function splitDiffFiles(
  diff: string,
): Array<{ filePath: string; patch: string }> {
  if (diff.trim().length === 0) return [];

  const lines = diff.split("\n");
  const hasGitHeaders = lines.some((line) => line.startsWith("diff --git "));
  const filePatches: string[] = [];
  let current: string[] = [];
  let oldLinesLeft = 0;
  let newLinesLeft = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const isUnifiedFileHeader =
      !hasGitHeaders &&
      oldLinesLeft === 0 &&
      newLinesLeft === 0 &&
      line.startsWith("--- ") &&
      lines[index + 1]?.startsWith("+++ ");

    if (
      current.length > 0 &&
      (line.startsWith("diff --git ") || isUnifiedFileHeader)
    ) {
      filePatches.push(current.join("\n"));
      current = [];
    }
    current.push(line);

    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLinesLeft = Number(hunk[1] ?? 1);
      newLinesLeft = Number(hunk[2] ?? 1);
    } else if (oldLinesLeft > 0 || newLinesLeft > 0) {
      if (line.startsWith("-")) {
        oldLinesLeft -= 1;
      } else if (line.startsWith("+")) {
        newLinesLeft -= 1;
      } else if (!line.startsWith("\\")) {
        oldLinesLeft -= 1;
        newLinesLeft -= 1;
      }
    }
  }

  if (current.length > 0) {
    filePatches.push(current.join("\n"));
  }

  return filePatches.map((patch, index) => {
    const gitHeader = /^diff --git a\/(.+) b\/(.+)$/m.exec(patch);
    const newFileHeader = /^\+\+\+ b\/(.+)$/m.exec(patch);
    const oldFileHeader = /^--- a\/(.+)$/m.exec(patch);
    const filePath =
      gitHeader?.[2] ??
      newFileHeader?.[1] ??
      oldFileHeader?.[1] ??
      `file-${String(index + 1)}`;

    return { filePath, patch };
  });
}

const DiffField: React.FC<{
  id: string;
  label: string;
  diff: string;
  accent: "success.main" | "error.main";
}> = ({ id, label, diff, accent }) => {
  const { t } = useTranslation();
  const [openFilePath, setOpenFilePath] = React.useState<string | null>(null);
  const { files, added, removed } = summarizeDiff(diff);
  const filePatches = splitDiffFiles(diff);

  return (
    <Field id={id} label={label} accent={accent}>
      <Typography variant="caption" color="text.secondary" component="div">
        {t("eval.case.coding.diffSummary", {
          count: files,
          added,
          removed,
        })}
      </Typography>
      <Stack spacing={0.5}>
        {filePatches.map(({ filePath, patch }) => {
          const fileOpen = openFilePath === filePath;
          return (
            <Box key={filePath}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {filePath}
                </Typography>
                <Button
                  size="small"
                  onClick={() => setOpenFilePath(fileOpen ? null : filePath)}
                >
                  {fileOpen
                    ? t("eval.case.coding.hideDiff")
                    : t("eval.case.coding.viewDiff")}
                </Button>
              </Stack>
              {fileOpen ? (
                <SavedPatchDiffViewer
                  filePath={filePath}
                  patch={patch}
                  testId={`${id}-diff-${filePath}`}
                />
              ) : null}
            </Box>
          );
        })}
      </Stack>
    </Field>
  );
};

const MockupChecklistBlock: React.FC<{
  checklist: EvalCaseMockupChecklist;
  projectId: string;
}> = ({ checklist, projectId }) => {
  const { t } = useTranslation();

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t("eval.case.coding.checklist.heading")}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        data-hh-id="coding-mockup-source"
        data-testid="coding-mockup-source"
      >
        {t("eval.case.coding.checklist.from")}{" "}
        <SpaLink
          testId="coding-open-mockup"
          href={WebPathService.task({
            projectId,
            taskId: checklist.mockupId,
          })}
        >
          {t("eval.case.coding.checklist.openMockup")}
        </SpaLink>
        {" · "}
        <b data-testid="coding-mockup-kind">
          {t(`eval.case.coding.checklist.kind.${checklist.kind}`)}
        </b>
        {": "}
        {t(`eval.case.coding.checklist.note.${checklist.kind}`)}
      </Typography>
      <Box
        component="ul"
        sx={{ my: 0.5, pl: 2.5 }}
        data-hh-id="coding-mockup-checklist"
        data-testid="coding-mockup-checklist"
      >
        {checklist.items.map((item) => (
          <li key={item.id} data-hh-id={`checklist-item-${item.id}`}>
            <Typography variant="body2">{item.description}</Typography>
          </li>
        ))}
      </Box>
    </Box>
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
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
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
        {coding.mockupChecklist ? (
          <MockupChecklistBlock
            checklist={coding.mockupChecklist}
            projectId={projectId}
          />
        ) : null}
        {coding.knownGoodDiff !== undefined ||
        coding.knownBadDiff !== undefined ? (
          <Stack direction="row" spacing={1.5}>
            {coding.knownGoodDiff !== undefined ? (
              <DiffField
                id="coding-known-good"
                label={t("eval.case.coding.knownGood")}
                diff={coding.knownGoodDiff}
                accent="success.main"
              />
            ) : null}
            {coding.knownBadDiff !== undefined ? (
              <DiffField
                id="coding-known-bad"
                label={t("eval.case.coding.knownBad")}
                diff={coding.knownBadDiff}
                accent="error.main"
              />
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
};
