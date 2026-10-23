import { Box, Typography } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { DiffRenderer, type DiffOperationDecision } from "./DiffRenderer";

const MENTION =
  "@[design_doc:87528c1d-88bb-4a70-9a67-89076b1ed97f|Goal V2: the standing PM conversation]";

// Old/new content that exercises every diff path that renders inline tokens:
// - an unchanged paragraph containing an inline code span (equal segments)
// - a modified paragraph that inserts a sentence with an inline code span and
//   **bold** text (word-level "inline-changed" / insert operations)
// - a modified sentence that replaces *italic* / ~~struck~~ text and ends in a
//   mention (replace operations + an @-mention)
const OLD_CONTENT = [
  "## Compaction",
  "",
  "The trigger policy is uniform. Provider compaction is command-based, not API-based.",
  "",
  "Coverage for all edge types is *partial* and ~~unverified~~ pending review.",
].join("\n");

const NEW_CONTENT = [
  "## Compaction",
  "",
  "The trigger policy is uniform. Each runner **fulfills `compact_run`** via a runner-specific adapter. Provider compaction is command-based, not API-based.",
  "",
  `Coverage for all edge types is *complete* and ~~verified~~ delivered by ${MENTION}.`,
].join("\n");

const meta: Meta<typeof DiffRenderer> = {
  title: "Components/DiffRenderer",
  component: DiffRenderer,
  parameters: { layout: "padded" },
  args: {
    oldContent: OLD_CONTENT,
    newContent: NEW_CONTENT,
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 720 }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof DiffRenderer>;

/**
 * Inline view. The inserted code span (`compact_run`) and the appended
 * `@[design_doc:...]` mention render as styled nodes inside the changed text,
 * not as raw markdown/tokens.
 */
export const Inline: Story = {
  args: {
    defaultViewMode: "inline",
    showViewModeToggle: true,
  },
};

/**
 * Split view. The modified lines go through the word-level "inline-changed"
 * path, which previously rendered raw text — mentions and inline code now render
 * as styled nodes in both panes.
 */
export const Split: Story = {
  args: {
    defaultViewMode: "split",
    showViewModeToggle: true,
  },
};

const InteractiveReviewDemo = ({
  oldContent,
  newContent,
}: {
  oldContent: string;
  newContent: string;
}) => {
  const [decisions, setDecisions] = useState<
    Record<number, DiffOperationDecision>
  >({});

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Hover an added/removed segment to accept or reject it.
      </Typography>
      <DiffRenderer
        oldContent={oldContent}
        newContent={newContent}
        enableInteractiveReview
        showViewModeToggle
        operationDecisions={decisions}
        onOperationDecisionChange={(operationIndex, decision) =>
          setDecisions((previous) => ({
            ...previous,
            [operationIndex]: decision,
          }))
        }
        operationTestIdPrefix="diff-story-operation"
      />
    </Box>
  );
};

/**
 * Interactive review. Each insert/delete operation gets hover accept/reject
 * controls; the operation text still renders mentions and inline code as styled
 * nodes. Hover a changed segment to reveal the controls.
 */
export const InteractiveReview: Story = {
  render: (args) => (
    <InteractiveReviewDemo
      oldContent={args.oldContent}
      newContent={args.newContent}
    />
  ),
};
