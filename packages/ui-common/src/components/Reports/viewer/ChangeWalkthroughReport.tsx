import { Box, Stack, Typography } from "@mui/material";
import type { ChangeWalkthroughReportPayload } from "../../../api";
import { SyntaxHighlightedCodeBlock } from "../../CodingPlan/SyntaxHighlightedCodeBlock";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { ReportItemCard, ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";
import { WalkthroughSourceLink } from "./WalkthroughSourceLink";

const WalkthroughMarkdown = ({ text }: { text: string }) => (
  <MarkdownRenderer mentionMode="minimal" sx={{ fontSize: "0.875rem" }}>
    {text}
  </MarkdownRenderer>
);

export const ChangeWalkthroughReport: ReportRenderer<
  ChangeWalkthroughReportPayload
> = ({ payload }) => (
  <Stack
    spacing={3}
    data-testid="change-walkthrough-report"
    sx={{ minWidth: 0 }}
  >
    <ReportLabeledText
      label="Summary"
      value={<WalkthroughMarkdown text={payload.summary} />}
    />
    {payload.parts?.length ? (
      <Stack spacing={1.5} data-testid="walkthrough-parts">
        <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 650 }}>
          Parts of the system
        </Typography>
        {payload.parts.map((part, partIndex) => (
          <ReportItemCard
            key={partIndex}
            title={
              <Typography
                component="h3"
                variant="subtitle1"
                sx={{ fontWeight: 650 }}
              >
                {part.name}
              </Typography>
            }
            testId="walkthrough-part"
          >
            <Stack spacing={1}>
              <WalkthroughMarkdown text={part.role} />
              <WalkthroughMarkdown text={part.relations} />
            </Stack>
          </ReportItemCard>
        ))}
      </Stack>
    ) : null}
    {payload.groups.map((group, groupIndex) => (
      <ReportItemCard
        key={groupIndex}
        title={
          <Typography component="h2" variant="h5" sx={{ fontWeight: 650 }}>
            {group.title}
          </Typography>
        }
        testId="walkthrough-group"
      >
        <Stack
          spacing={2}
          component="ol"
          sx={{ listStyle: "none", m: 0, p: 0 }}
        >
          {group.changes.map((change, changeIndex) => (
            <li key={changeIndex}>
              <Stack
                spacing={2}
                data-testid="walkthrough-change"
                sx={{ minWidth: 0, py: 1.5 }}
              >
                <Typography
                  component="h3"
                  variant="subtitle1"
                  sx={{ fontWeight: 650 }}
                >
                  {change.title}
                </Typography>
                <Box
                  sx={{ "& .MuiTypography-body2": { color: "text.secondary" } }}
                >
                  <ReportLabeledText
                    label="Context"
                    value={<WalkthroughMarkdown text={change.context} />}
                  />
                </Box>
                {change.walkthrough.map((step, stepIndex) => (
                  <Stack
                    key={stepIndex}
                    spacing={0.5}
                    data-testid="walkthrough-step"
                  >
                    <SyntaxHighlightedCodeBlock
                      code={step.excerpt.code}
                      language={step.excerpt.language}
                      testId="walkthrough-code"
                    />
                    <WalkthroughSourceLink
                      excerpt={step.excerpt}
                      runId={payload.targetRunId}
                    />
                    {step.excerpt.sourceVersion.kind === "GIT" && (
                      <Typography variant="caption">
                        Historical revision:{" "}
                        {step.excerpt.sourceVersion.revision}
                      </Typography>
                    )}
                    {step.excerpt.verification.status === "UNRESOLVED" && (
                      <Typography color="warning.main" variant="caption">
                        Unresolved source: {step.excerpt.verification.reason}
                      </Typography>
                    )}
                    <ReportLabeledText
                      label="Explanation"
                      value={<WalkthroughMarkdown text={step.explanation} />}
                    />
                  </Stack>
                ))}
                <ReportLabeledText
                  label="Behavioral consequence"
                  value={
                    <WalkthroughMarkdown text={change.behavioralConsequence} />
                  }
                />
              </Stack>
            </li>
          ))}
        </Stack>
      </ReportItemCard>
    ))}
  </Stack>
);
