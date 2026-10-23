import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  type FC,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createProjectReportCitationRuntime,
  readProjectReportCitationKey,
  readProjectReportHeight,
  readProjectReportMention,
} from "./projectReportCitationRuntime";
import { rewriteProjectReportMentions } from "./projectReportMentions";
import { usePathService, useProjectContext } from "../../../contexts";
import { navigateToEntity } from "../../WebUtils/navigateToEntity";
import { logger } from "../../../utils/logger";
import {
  ProjectReportCoverageStatusEnum,
  type ProjectReportBody,
  type ProjectReportEvidenceReference,
  type ProjectReportPayload,
} from "../../../api";
import { IsolatedHtmlCssDocument } from "../../shared/IsolatedHtmlCssDocument";
import {
  ReportEntityMention,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRendererProps } from "./rendererContract";

/** Authored markup cites evidence only by key; the host resolves the key. */
const PROJECT_REPORT_EVIDENCE_KEY_ATTRIBUTE = "data-evidence-key";

/**
 * Height used until the host runtime reports the document's measured height.
 * The frame then grows to its full content so the surrounding surface scrolls.
 */
const PROJECT_REPORT_BODY_INITIAL_HEIGHT = 240;

const readAuthoredBody = (body: unknown): ProjectReportBody | null => {
  if (typeof body !== "object" || body === null) return null;
  const { html, css } = body as Record<string, unknown>;
  if (typeof html !== "string" || html.trim().length === 0) return null;
  if (typeof css !== "string") return null;
  return { html, css };
};

const readCitedEvidenceKeys = (html: string): string[] => {
  if (typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(html, "text/html");
  const keys = Array.from(
    document.querySelectorAll(`[${PROJECT_REPORT_EVIDENCE_KEY_ATTRIBUTE}]`),
    (element) =>
      element.getAttribute(PROJECT_REPORT_EVIDENCE_KEY_ATTRIBUTE) ?? "",
  ).filter((key) => key.length > 0);
  return Array.from(new Set(keys));
};

const formatDateTime = (value: string, timeZone?: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  };
  try {
    return date.toLocaleString(undefined, { ...options, timeZone });
  } catch {
    return date.toLocaleString(undefined, options);
  }
};

export interface ProjectReportProps extends ReportRendererProps<ProjectReportPayload> {
  /** Whether this renderer owns the visible title; the viewer coordinates it. */
  showTitle?: boolean;
}

export const ProjectReport: FC<ProjectReportProps> = ({
  payload,
  report,
  reportTestId,
  showTitle = false,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const evidenceElements = useRef(new Map<string, HTMLLIElement>());
  const pendingEvidenceKey = useRef<string | null>(null);
  const [channelToken] = useState(() => crypto.randomUUID());
  const [nonce] = useState(() => crypto.randomUUID());
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const detailsId = useId();
  const testId = `${reportTestId}-project-report`;
  const { scope, coverage, provenance } = payload;
  const isIncomplete =
    coverage.status !== ProjectReportCoverageStatusEnum.Complete;
  const body = readAuthoredBody(payload.body);
  const projectContext = useProjectContext();
  const pathService = usePathService();
  const authoredHtml = body?.html ?? null;
  const bodyHtml = useMemo(
    () =>
      authoredHtml === null ? null : rewriteProjectReportMentions(authoredHtml),
    [authoredHtml],
  );
  const evidenceByKey = useMemo(
    () =>
      new Map<string, ProjectReportEvidenceReference>(
        provenance.evidence.map((evidence) => [evidence.key, evidence]),
      ),
    [provenance.evidence],
  );
  const citationRuntime = useMemo(
    () =>
      createProjectReportCitationRuntime(
        nonce,
        channelToken,
        Array.from(evidenceByKey.keys()),
        payload.title,
      ),
    [nonce, channelToken, evidenceByKey, payload.title],
  );
  const focusEvidence = useCallback((key: string) => {
    const element = evidenceElements.current.get(key);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        !iframeRef.current ||
        event.source !== iframeRef.current.contentWindow
      )
        return;
      const height = readProjectReportHeight(event.data, channelToken);
      if (height !== null) {
        setBodyHeight(height);
        return;
      }
      const mention = readProjectReportMention(event.data, channelToken);
      if (mention !== null) {
        if (!projectContext) {
          logger.warn(
            "ui",
            "Project report mention click ignored: no ProjectContext",
            mention,
          );
          return;
        }
        void navigateToEntity({
          entity: {
            id: mention.entityId,
            type: mention.entityType,
            name: mention.entityName,
          },
          navigate: projectContext.navigate,
          projectId: projectContext.projectId,
          pathService,
        });
        return;
      }
      const key = readProjectReportCitationKey(event.data, channelToken);
      if (key === null || !evidenceByKey.has(key)) return;
      if (detailsExpanded) {
        focusEvidence(key);
        return;
      }
      // Evidence lives in the collapsed details; open them, then focus once
      // the disclosure has finished expanding so the target is laid out.
      pendingEvidenceKey.current = key;
      setDetailsExpanded(true);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    channelToken,
    detailsExpanded,
    evidenceByKey,
    focusEvidence,
    pathService,
    projectContext,
  ]);
  const handleDetailsEntered = useCallback(() => {
    const key = pendingEvidenceKey.current;
    pendingEvidenceKey.current = null;
    if (key !== null) focusEvidence(key);
  }, [focusEvidence]);
  const citedKeys = useMemo(
    () => (body ? readCitedEvidenceKeys(body.html) : []),
    [body],
  );
  const unresolvedCitedKeys = citedKeys.filter(
    (key) => !evidenceByKey.has(key),
  );

  return (
    <Stack data-testid={testId} spacing={2}>
      {showTitle ? (
        <Typography component="h2" variant="h6" data-testid={`${testId}-title`}>
          {payload.title}
        </Typography>
      ) : null}

      {isIncomplete ? (
        <Alert severity="warning" data-testid={`${testId}-coverage-incomplete`}>
          <AlertTitle>Incomplete report</AlertTitle>
          {coverage.processedActivityCount < coverage.matchingActivityCount
            ? `Only ${coverage.processedActivityCount} of ${coverage.matchingActivityCount} matching activities were read. `
            : null}
          This report is not exhaustive for the selected period.
          {coverage.limitations.length > 0 ? (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {coverage.limitations.map((limitation, index) => (
                <li key={index}>{limitation}</li>
              ))}
            </Box>
          ) : null}
        </Alert>
      ) : null}

      <Box data-testid={`${testId}-body`}>
        {body && bodyHtml !== null ? (
          <IsolatedHtmlCssDocument
            ref={iframeRef}
            runtime={citationRuntime}
            title={`${payload.title} report body`}
            testId={`${testId}-body-frame`}
            html={bodyHtml}
            css={body.css}
            presentationStyle="report"
            sx={{
              display: "block",
              height: bodyHeight ?? PROJECT_REPORT_BODY_INITIAL_HEIGHT,
              bgcolor: "#ffffff",
              border: 1,
              borderColor: "divider",
            }}
          />
        ) : (
          <Alert severity="warning" data-testid={`${testId}-body-unavailable`}>
            The authored report body is unavailable. The request, scope,
            coverage, and evidence in Report details remain authoritative.
          </Alert>
        )}
      </Box>

      <Accordion
        disableGutters
        variant="outlined"
        expanded={detailsExpanded}
        onChange={(_, expanded) => setDetailsExpanded(expanded)}
        slotProps={{ transition: { onEntered: handleDetailsEntered } }}
        data-testid={`${testId}-details`}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          id={`${detailsId}-summary`}
          aria-controls={`${detailsId}-content`}
          data-testid={`${testId}-details-toggle`}
        >
          <Typography variant="subtitle2" component="h3">
            Report details
          </Typography>
        </AccordionSummary>
        <AccordionDetails id={`${detailsId}-content`}>
          <Stack spacing={2}>
            <ReportLabeledText
              label="Original request"
              testId={`${testId}-question`}
              value={payload.question}
            />
            <ReportLabeledText
              label="Summary"
              renderMentions
              testId={`${testId}-summary`}
              value={payload.summary}
            />

            <ReportPanel
              title="Scope"
              testId={`${testId}-scope`}
              reportId={report.id}
            >
              <ReportLabeledText
                label="Period"
                testId={`${testId}-scope-period`}
                value={`${formatDateTime(
                  scope.windowStart,
                  scope.timeZone,
                )} – ${formatDateTime(scope.windowEnd, scope.timeZone)} (${
                  scope.timeZone
                })`}
              />
              {payload.preset ? (
                <ReportLabeledText label="Preset" value={payload.preset.key} />
              ) : null}
              {scope.userId ? (
                <ReportLabeledText
                  label="Member"
                  value={
                    <ReportEntityMention
                      entityType="USER"
                      entityId={scope.userId}
                    />
                  }
                />
              ) : null}
              {scope.activityTypes?.length ? (
                <ReportLabeledText
                  label="Activity types"
                  value={scope.activityTypes.join(", ")}
                />
              ) : null}
              {scope.sources?.length ? (
                <ReportLabeledText
                  label="Sources"
                  value={scope.sources.join(", ")}
                />
              ) : null}
            </ReportPanel>

            <ReportPanel
              title="Exclusions"
              testId={`${testId}-exclusions`}
              reportId={report.id}
              isEmpty={payload.exclusions.length === 0}
              emptyMessage="No subjects were excluded."
            >
              <Stack direction="row" flexWrap="wrap" sx={{ gap: 0.5 }}>
                {payload.exclusions.map((subject) => (
                  <ReportEntityMention
                    key={`${subject.entityType}-${subject.entityId}`}
                    entityType={subject.entityType}
                    entityId={subject.entityId}
                  />
                ))}
              </Stack>
            </ReportPanel>

            <ReportPanel
              title="Coverage and limitations"
              testId={`${testId}-coverage`}
              reportId={report.id}
            >
              <Typography
                variant="body2"
                data-testid={`${testId}-coverage-status`}
              >
                {isIncomplete ? "Incomplete" : "Complete"} —{" "}
                {coverage.processedActivityCount} of{" "}
                {coverage.matchingActivityCount} matching activities read across{" "}
                {coverage.pagesRead} pages.
              </Typography>
              {coverage.limitations.length > 0 ? (
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {coverage.limitations.map((limitation, index) => (
                    <Typography component="li" key={index} variant="body2">
                      {limitation}
                    </Typography>
                  ))}
                </Box>
              ) : null}
            </ReportPanel>

            <ReportPanel
              title="Evidence"
              testId={`${testId}-evidence`}
              reportId={report.id}
              isEmpty={provenance.evidence.length === 0}
              emptyMessage="No evidence was recorded for this report."
            >
              {unresolvedCitedKeys.length > 0 ? (
                <Alert
                  severity="info"
                  data-testid={`${testId}-evidence-unresolved`}
                >
                  {unresolvedCitedKeys.length === 1
                    ? "One citation in the report does not match recorded evidence"
                    : `${unresolvedCitedKeys.length} citations in the report do not match recorded evidence`}{" "}
                  ({unresolvedCitedKeys.join(", ")}).
                </Alert>
              ) : null}
              <Box
                component="ul"
                aria-label="Report evidence"
                sx={{ m: 0, pl: 0, listStyle: "none" }}
              >
                {provenance.evidence.map((evidence) => (
                  <Box
                    component="li"
                    tabIndex={-1}
                    ref={(element: HTMLLIElement | null) => {
                      if (element)
                        evidenceElements.current.set(evidence.key, element);
                      else evidenceElements.current.delete(evidence.key);
                    }}
                    key={evidence.key}
                    id={`${testId}-evidence-${evidence.key}`}
                    data-testid={`${testId}-evidence-item`}
                    data-evidence-key={evidence.key}
                    data-cited={citedKeys.includes(evidence.key) || undefined}
                    sx={{
                      display: "flex",
                      gap: 1,
                      alignItems: "center",
                      py: 0.25,
                    }}
                  >
                    <ReportEntityMention
                      entityType={evidence.subject.entityType}
                      entityId={evidence.subject.entityId}
                      entityName={evidence.title}
                    />
                    {evidence.occurredAt ? (
                      <Typography
                        color="text.secondary"
                        component="span"
                        variant="caption"
                      >
                        {formatDateTime(evidence.occurredAt)}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Box>
            </ReportPanel>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
};
