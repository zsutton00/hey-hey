import type { Meta, StoryObj } from "@storybook/react";
import { Box } from "@mui/material";
import type { EntityMention } from "./types";
import { MentionBadgeInner } from "./MentionBadge";

const buildMention = (
  overrides: Partial<EntityMention> &
    Pick<EntityMention, "entityId" | "entityName">
): EntityMention => ({
  entityType: "task",
  ...overrides,
});

const meta: Meta<typeof MentionBadgeInner> = {
  title: "Components/MentionBadge",
  component: MentionBadgeInner,
};

export default meta;

type Story = StoryObj<typeof MentionBadgeInner>;

export const Full: Story = {
  args: {
    mention: buildMention({
      entityId: "task-1",
      entityName: "Draft onboarding spec",
    }),
    mode: "full",
  },
};

export const Minimal: Story = {
  args: {
    mention: buildMention({
      entityId: "task-1",
      entityName: "Draft onboarding spec",
    }),
    mode: "minimal",
  },
};

export const LongName: Story = {
  args: {
    mention: buildMention({
      entityId: "task-long",
      entityName:
        "An exceptionally long mention name that should overflow the badge maxWidth and trigger the text ellipsis truncation branch in the inner span",
    }),
    mode: "full",
  },
};

const ENTITY_TYPE_VARIANTS: ReadonlyArray<{
  entityType: string;
  entityName: string;
}> = [
  { entityType: "task", entityName: "Task mention" },
  { entityType: "feature", entityName: "Feature mention" },
  { entityType: "design_doc", entityName: "Design doc mention" },
  { entityType: "initiative", entityName: "Initiative mention" },
];

export const EntityTypeVariants: Story = {
  render: () => (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        alignItems: "flex-start",
      }}
    >
      {ENTITY_TYPE_VARIANTS.map((variant) => (
        <MentionBadgeInner
          key={variant.entityType}
          mention={buildMention({
            entityId: `${variant.entityType}-1`,
            entityName: variant.entityName,
            entityType: variant.entityType,
          })}
          mode="full"
        />
      ))}
    </Box>
  ),
};
