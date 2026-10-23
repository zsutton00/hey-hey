import type { Meta, StoryObj } from "@storybook/react";
import { Box } from "@mui/material";
import type {
  JourneyMap,
  JourneyStep,
  ServiceNote,
} from "../../api";
import { JourneyView } from "./JourneyView";

const note = (overrides: Partial<ServiceNote> = {}): ServiceNote => ({
  text: "Implementation note",
  serviceId: "service-1",
  serviceName: "API Service",
  ...overrides,
});

const step = (
  overrides: Partial<JourneyStep> & { id: string; title: string }
): JourneyStep => ({
  description: "Step description.",
  isUserInteractive: false,
  implementationNotes: [],
  ...overrides,
});

const journey = (steps: JourneyStep[]): JourneyMap => ({ steps });

const singleStepMap = journey([
  step({
    id: "draft",
    title: "Draft the spec",
    description:
      "Author the OpenAPI contract and align the public and local agent specs.",
    implementationNotes: [
      note({
        text: "Extend ExtendedUIFieldType enum.",
        serviceName: "OpenAPI",
      }),
    ],
  }),
]);

const typicalJourneyMap = journey([
  step({
    id: "intake",
    title: "Capture intent",
    description:
      "Collect the user's goal and shape it into a structured plan request.",
    implementationNotes: [
      note({
        text: "Use the existing plan intake form on the conversation surface.",
        serviceName: "UI Common",
      }),
      note({
        text: "Persist the captured intent to FlowContext.intent.",
        serviceName: "Local Agent",
      }),
    ],
  }),
  step({
    id: "review-journey",
    title: "Review the journey",
    description:
      "Render the journey map as horizontal cards and confirm coverage with the user.",
    isUserInteractive: true,
    implementationNotes: [
      note({
        text: "Render the journey-review field via the form registry.",
        serviceName: "UI Common",
      }),
      note({
        text: "Approval fires the journey-map APPROVED action.",
        serviceName: "Local Agent",
      }),
    ],
  }),
  step({
    id: "phase-breakdown",
    title: "Phase breakdown",
    description:
      "Expand each interactive step into a phase of executable tasks.",
    implementationNotes: [
      note({
        text: "Loop over journeySteps and emit phase-breakdown proposals.",
        serviceName: "Local Agent",
      }),
      note({
        text: "Cross-cutting: emit progress events on the run channel.",
        serviceId: null,
        serviceName: null,
      }),
    ],
  }),
  step({
    id: "ship",
    title: "Ship",
    description: "Commit the plan and hand off to the executing agent.",
    isUserInteractive: true,
    implementationNotes: [],
  }),
]);

const longJourneyMap = journey([
  step({
    id: "ingest",
    title: "Ingest source material",
    description: "Read existing tasks, design docs, and recent reports.",
    implementationNotes: [
      note({ text: "Use unified_search batched calls.", serviceName: "MCP" }),
    ],
  }),
  step({
    id: "draft",
    title: "Draft the journey",
    description: "Synthesize a candidate journey map from the source set.",
    implementationNotes: [
      note({
        text: "Single LLM call with the journey-map prompt.",
        serviceName: "Local Agent",
      }),
    ],
  }),
  step({
    id: "review",
    title: "Review with user",
    description: "Present the journey map for user approval.",
    isUserInteractive: true,
    implementationNotes: [
      note({ text: "Render JourneyView.", serviceName: "UI Common" }),
    ],
  }),
  step({
    id: "expand",
    title: "Expand phases",
    description: "Break each phase into tasks.",
    implementationNotes: [
      note({
        text: "Phase-breakdown loop runs per-step.",
        serviceName: "Local Agent",
      }),
    ],
  }),
  step({
    id: "validate",
    title: "Validate plan",
    description: "Run lint and shape checks on the emitted plan.",
    isUserInteractive: true,
    implementationNotes: [],
  }),
  step({
    id: "publish",
    title: "Publish",
    description: "Commit the plan and notify the run channel.",
    implementationNotes: [
      note({ text: "Emit plan.created event.", serviceName: "Local Agent" }),
    ],
  }),
]);

const meta: Meta<typeof JourneyView> = {
  title: "Components/Plans/JourneyView",
  component: JourneyView,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 1100 }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof JourneyView>;

export const SingleStep: Story = {
  args: {
    journeyMap: singleStepMap,
  },
};

export const TypicalJourney: Story = {
  args: {
    journeyMap: typicalJourneyMap,
  },
};

export const LongJourneyHorizontalScroll: Story = {
  args: {
    journeyMap: longJourneyMap,
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 720 }}>
        <Story />
      </Box>
    ),
  ],
};

export const AllInteractive: Story = {
  args: {
    journeyMap: journey(
      typicalJourneyMap.steps.map((s) => ({ ...s, isUserInteractive: true }))
    ),
  },
};

export const NoImplementationNotes: Story = {
  args: {
    journeyMap: journey(
      typicalJourneyMap.steps.map((s) => ({ ...s, implementationNotes: [] }))
    ),
  },
};
