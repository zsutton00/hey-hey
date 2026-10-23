import { Stack, Typography } from "@mui/material";
import type { ChangeWalkthroughReportPayload } from "../../../api";
import { SyntaxHighlightedCodeBlock } from "../../CodingPlan/SyntaxHighlightedCodeBlock";
import {
  ReportPanel,
  ReportItemCard,
  ReportLabeledText,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";
import { WalkthroughSourceLink } from "./WalkthroughSourceLink";

export const ChangeWalkthroughReport: ReportRenderer<
  ChangeWalkthroughReportPayload
> = ({ payload }) => (
  <Stack spacing={2} data-testid="change-walkthrough-report">
    <ReportLabeledText label="Summary" value={payload.summary} renderMentions />
    {payload.groups.map((group, groupIndex) => (
      <ReportPanel
        key={groupIndex}
        title={group.title}
        testId="walkthrough-group"
      >
        <Stack
          spacing={2}
          component="ol"
          sx={{ listStyle: "none", m: 0, p: 0 }}
        >
          {group.changes.map((change, changeIndex) => (
            <li key={changeIndex}>
              <ReportItemCard title={change.title} testId="walkthrough-change">
                <ReportLabeledText
                  label="Context"
                  value={change.context}
                  renderMentions
                />
                {change.walkthrough.map((step, stepIndex) => (
                  <Stack
                    key={stepIndex}
                    spacing={0.5}
                    data-testid="walkthrough-step"
                  >
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
                    <SyntaxHighlightedCodeBlock
                      code={step.excerpt.code}
                      language={step.excerpt.language}
                      testId="walkthrough-code"
                    />
                    <ReportLabeledText
                      label="Explanation"
                      value={step.explanation}
                      renderMentions
                    />
                  </Stack>
                ))}
                <ReportLabeledText
                  label="Behavioral consequence"
                  value={change.behavioralConsequence}
                  renderMentions
                />
              </ReportItemCard>
            </li>
          ))}
        </Stack>
      </ReportPanel>
    ))}
  </Stack>
);
