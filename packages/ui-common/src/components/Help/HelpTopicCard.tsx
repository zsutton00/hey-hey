import { Alert, Button, Stack, Typography } from "@mui/material";
import React from "react";

import { useHelpNode } from "../../data/hooks";
import type { HelpFeatureRecord } from "./helpCapabilities";
import type { HelpTopicListItem } from "./helpContentSource";
import { HelpScenarioCard } from "./HelpScenarioCard";
import { getHelpTopicAnchorId } from "./HelpTableOfContents";

export interface HelpTopicCardProps {
  topic: HelpTopicListItem;
  features?: readonly HelpFeatureRecord[];
  demo?: React.ReactNode;
}

const LoadingTopicContent: React.FC = () => (
  <Typography
    data-testid="help-topic-loading-state"
    variant="body2"
    color="text.secondary"
  >
    Loading help content...
  </Typography>
);

const UnavailableTopicContent: React.FC<{
  onRetry: () => void;
}> = ({ onRetry }) => (
  <Alert
    data-testid="help-topic-unavailable-state"
    severity="warning"
    action={
      <Button
        data-testid="help-topic-retry-button"
        type="button"
        color="inherit"
        size="small"
        onClick={onRetry}
      >
        Retry
      </Button>
    }
  >
    This help topic is unavailable.
  </Alert>
);

const FailedTopicContent: React.FC<{
  onRetry: () => void;
}> = ({ onRetry }) => (
  <Alert
    data-testid="help-topic-error-state"
    severity="error"
    action={
      <Button
        data-testid="help-topic-retry-button"
        type="button"
        color="inherit"
        size="small"
        onClick={onRetry}
      >
        Retry
      </Button>
    }
  >
    Help content could not be loaded.
  </Alert>
);

export const HelpTopicCard: React.FC<HelpTopicCardProps> = ({
  topic,
  features,
  demo,
}) => {
  const { data, isFetched, isLoading, isFetching, error, refetch } =
    useHelpNode(topic.readKey);
  const hasNodeData = data !== null;
  const hasPersistedData = hasNodeData && !error;
  const isReading = !hasNodeData && (!isFetched || isLoading || isFetching);
  const persistedNode = error ? null : data;
  const displayScenario = persistedNode
    ? {
        ...topic.scenario,
        id: persistedNode.id,
        title: persistedNode.title,
        deepContent: persistedNode.body,
      }
    : topic.scenario;

  const retry = (): void => {
    void refetch();
  };

  return (
    <Stack
      id={getHelpTopicAnchorId(topic)}
      data-testid="help-topic-card"
      data-topic-id={topic.id}
      spacing={1.5}
      sx={{ scrollMarginTop: 16 }}
    >
      <HelpScenarioCard
        scenario={displayScenario}
        number={topic.number}
        features={features}
        demo={demo}
        showDeepContent={hasPersistedData}
        titleVariant="h6"
        titleComponent="h3"
      />
      {error ? (
        <FailedTopicContent onRetry={retry} />
      ) : isReading ? (
        <LoadingTopicContent />
      ) : !hasNodeData ? (
        <UnavailableTopicContent onRetry={retry} />
      ) : null}
    </Stack>
  );
};
