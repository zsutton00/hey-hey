import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { Stack } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import { ConversationCard } from "./ConversationCard";
import { ConversationCardRelatedRows } from "./ConversationCardRelatedRows";
import { ConversationCardSection } from "./ConversationCardSection";
import { SolidAlert } from "./SolidAlert";

const meta: Meta<typeof ConversationCard> = {
  title: "Conversation/ConversationCard",
  component: ConversationCard,
};
export default meta;

type Story = StoryObj<typeof ConversationCard>;

const TONES = [
  { role: "projectSync" },
  { role: "needsAnswer" },
  { role: "agentMessage" },
  { role: "informational" },
  { severity: "high" },
  { severity: "medium" },
  { severity: "low" },
] as const;

export const AllTonesAndAlerts: Story = {
  render: () => (
    <Stack spacing={2} sx={{ maxWidth: 560 }}>
      {TONES.map((tone) => (
        <ConversationCard
          key={"role" in tone ? tone.role : tone.severity}
          tone={tone}
          icon={<InfoOutlinedIcon fontSize="small" />}
          kindLabel={"role" in tone ? tone.role : `${tone.severity} severity`}
          lead="One sentence saying what this card needs."
          footer={{
            primary: { label: "Primary", onClick: () => {} },
            secondary: [{ label: "Later", onClick: () => {} }],
          }}
        >
          <ConversationCardSection label="Related">
            <ConversationCardRelatedRows
              numbered
              rows={[
                {
                  key: "a",
                  reason: "Why this matters",
                  state: { label: "your decision", emphasis: "needsAnswer" },
                },
              ]}
            />
          </ConversationCardSection>
        </ConversationCard>
      ))}
      <SolidAlert severity="warning">A warning inside a message.</SolidAlert>
      <SolidAlert severity="error">An error inside a message.</SolidAlert>
    </Stack>
  ),
};
