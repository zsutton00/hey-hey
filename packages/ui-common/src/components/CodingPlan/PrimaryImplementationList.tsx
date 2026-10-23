import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Box, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";
import React from "react";
import {
  type CodingPromptStartupPrimaryImplementation,
  type CodingPromptStartupPrimaryImplementationConnection,
  type PlanReportPrimaryImplementation,
  type PlanReportPrimaryImplementationConnection,
} from "../../api";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import {
  ReportEntityMention,
  ReportLabeledText,
} from "../Reports/viewer/reportPrimitives";

const SyntaxHighlightedCodeBlock = React.lazy(() =>
  import("./SyntaxHighlightedCodeBlock").then((module) => ({
    default: module.SyntaxHighlightedCodeBlock,
  }))
);

type PrimaryImplementation =
  | CodingPromptStartupPrimaryImplementation
  | PlanReportPrimaryImplementation;

type PrimaryImplementationConnection =
  | CodingPromptStartupPrimaryImplementationConnection
  | PlanReportPrimaryImplementationConnection;

interface PrimaryImplementationListProps {
  implementations: readonly PrimaryImplementation[];
  testId: string;
}

const CONNECTION_RELATIONSHIP_LABELS = {
  fulfills: "Fulfills",
  authors: "Authors",
  enforces: "Enforces",
  consumes: "Consumes",
} as const satisfies Record<
  PrimaryImplementationConnection["relationship"],
  string
>;

const buildFencedCodeBlock = (content: string, language: string): string => {
  const longestFence = Math.max(
    2,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length)
  );
  const fence = "`".repeat(longestFence + 1);
  return `${fence}${language}\n${content}\n${fence}`;
};

const PrimaryImplementationConnectionRow: React.FC<{
  connection: PrimaryImplementationConnection;
  testId: string;
}> = ({ connection, testId }) => (
  <Stack
    alignItems="center"
    data-testid={testId}
    direction="row"
    flexWrap="wrap"
    spacing={0.75}
    useFlexGap
  >
    <ReportEntityMention
      entityId={connection.entityId}
      entityName={connection.entityTitle}
      entityType={connection.entityType}
    />
    <Chip
      data-testid={`${testId}-relationship`}
      label={CONNECTION_RELATIONSHIP_LABELS[connection.relationship]}
      size="small"
    />
  </Stack>
);

const PrimaryImplementationPanel: React.FC<{
  implementation: PrimaryImplementation;
  index: number;
  tabListTestId: string;
  testId: string;
}> = ({ implementation, index, tabListTestId, testId }) => {
  const content = implementation.language
    ? buildFencedCodeBlock(implementation.content, implementation.language)
    : implementation.content;
  const implementationContent = implementation.language ? (
    <React.Suspense fallback={<MarkdownRenderer>{content}</MarkdownRenderer>}>
      <SyntaxHighlightedCodeBlock
        code={implementation.content}
        language={implementation.language}
        testId={`${testId}-syntax-highlighted-code`}
      />
    </React.Suspense>
  ) : (
    <MarkdownRenderer>{content}</MarkdownRenderer>
  );

  return (
    <Stack
      aria-labelledby={`${tabListTestId}-tab-${String(index)}`}
      data-testid={`${tabListTestId}-panel-${String(index)}`}
      id={`${tabListTestId}-panel-${String(index)}`}
      role="tabpanel"
      spacing={1}
    >
      {implementation.location ? (
        <Stack data-testid={`${testId}-location`}>
          <MarkdownRenderer>{implementation.location}</MarkdownRenderer>
        </Stack>
      ) : null}
      <Stack
        data-testid={`${testId}-content`}
        sx={{ whiteSpace: "pre-wrap" }}
      >
        {implementationContent}
      </Stack>
      <ReportLabeledText
        label="Rationale"
        testId={`${testId}-rationale`}
        value={<MarkdownRenderer>{implementation.rationale}</MarkdownRenderer>}
      />
      {implementation.connections ? (
        <ReportLabeledText
          label="Connections"
          testId={`${testId}-connections`}
          value={
            <Stack data-testid={`${testId}-connections-list`} spacing={1}>
              {implementation.connections.map((connection, connectionIndex) => (
                <PrimaryImplementationConnectionRow
                  connection={connection}
                  key={`${connection.entityType}-${
                    connection.entityId
                  }-${String(connectionIndex)}`}
                  testId={`${testId}-connection-${String(connectionIndex)}`}
                />
              ))}
            </Stack>
          }
        />
      ) : null}
    </Stack>
  );
};

export const PrimaryImplementationList: React.FC<
  PrimaryImplementationListProps
> = ({ implementations, testId }) => {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const activeIndex = Math.min(
    selectedIndex,
    Math.max(implementations.length - 1, 0)
  );
  const activeImplementation = implementations[activeIndex];

  if (!activeImplementation) {
    return <Stack data-testid={testId} />;
  }

  return (
    <Stack
      data-testid={testId}
      spacing={1}
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        minWidth: 0,
        p: 1.5,
      }}
    >
      <Tabs
        aria-label="Primary implementations"
        onChange={(_event, index: number) => setSelectedIndex(index)}
        sx={{
          minHeight: 40,
          "& .MuiTabs-flexContainer, & .MuiTabs-list": { gap: 1 },
        }}
        value={activeIndex}
        variant="scrollable"
      >
        {implementations.map((implementation, index) => (
          <Tab
            aria-controls={`${testId}-panel-${String(index)}`}
            data-testid={`${testId}-item-${String(index)}-title`}
            id={`${testId}-tab-${String(index)}`}
            key={`${implementation.title}-${String(index)}`}
            label={
              <Box
                component="span"
                sx={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                }}
              >
                {implementation.title}
              </Box>
            }
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              flex: "0 0 240px",
              maxWidth: 240,
              minHeight: 40,
              minWidth: 240,
              overflow: "hidden",
              px: 1.5,
              "&.Mui-selected": { bgcolor: "action.selected" },
            }}
            title={implementation.title}
          />
        ))}
      </Tabs>
      <Stack
        alignItems="center"
        color="warning.main"
        data-testid={`${testId}-preview-warning`}
        direction="row"
        spacing={0.75}
      >
        <WarningAmberIcon fontSize="small" />
        <Typography color="text.secondary" variant="caption">
          Implementation preview — final changes may differ.
        </Typography>
      </Stack>
      <PrimaryImplementationPanel
        implementation={activeImplementation}
        index={activeIndex}
        tabListTestId={testId}
        testId={`${testId}-item-${String(activeIndex)}`}
      />
    </Stack>
  );
};
