import type { Meta, StoryObj } from "@storybook/react";
import { StructuredMockupSectionRenderer } from "./StructuredMockupSectionRenderer";
import { structuredMockupAcceptanceFixture } from "./structuredMockupAcceptanceFixture";

const meta = {
  title: "Mockups/Structured composition",
  component: StructuredMockupSectionRenderer,
  args: {
    content: structuredMockupAcceptanceFixture,
    context: "page",
    definition: {
      key: "mockup",
      label: "Mockup",
      kind: "structured-mockup",
      defaultSizeKey: "desktop",
      sizeProfiles: [
        {
          key: "desktop",
          label: "Desktop",
          breakpoints: [
            {
              minContainerWidth: 0,
              inline: { width: 1200, height: 760 },
              page: { width: 1200, height: 760 },
            },
          ],
        },
      ],
    },
  },
} satisfies Meta<typeof StructuredMockupSectionRenderer>;
export default meta;
export const NotesAndDocuments: StoryObj<typeof meta> = {};
