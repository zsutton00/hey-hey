import { FeatureTag } from "@hey-hey/ui-common/api";
import type {
  FeatureListProposalNode,
  SelectOption,
} from "@hey-hey/ui-common/api";

export type NewOrgLandingSectionId =
  | "project-description"
  | "followups"
  | "features";

const PROJECT_MATURITY_OPTIONS: SelectOption[] = [
  {
    value: "greenfield",
    label: "New/Greenfield - Starting from scratch",
  },
  {
    value: "early",
    label: "Early - Some work complete",
  },
  {
    value: "mature",
    label: "Existing/Mature - Already in development or production",
  },
  {
    value: "legacy",
    label: "Legacy - No longer under active development. Maintenance only.",
  },
];

const TEAM_SIZE_OPTIONS: SelectOption[] = [
  { value: "solo", label: "Solo (1 person)" },
  { value: "small", label: "Small team (2-5 people)" },
  { value: "medium", label: "Medium team (6-15 people)" },
  { value: "large", label: "Large team (16+ people)" },
];

const ORG_CONTEXT_OPTIONS: SelectOption[] = [
  { value: "new_company", label: "New company/startup" },
  { value: "existing_org", label: "Part of existing organization" },
  { value: "hobby", label: "Hobby/Personal project" },
];

export const PROJECT_DESCRIPTION_SELECT_OPTIONS = {
  project_maturity: PROJECT_MATURITY_OPTIONS,
  team_size: TEAM_SIZE_OPTIONS,
  org_context: ORG_CONTEXT_OPTIONS,
} as const;

export type ProjectDescriptionSelectKey =
  | "projectMaturity"
  | "teamSize"
  | "orgContext";

export const PROJECT_DESCRIPTION_LABELS = {
  project_concept: "Project Concept",
  project_maturity:
    "How would you describe the current state of this project?",
  team_size: "What is your team size for this project?",
  org_context: "How does this project relate to your organization?",
} as const;

export const PROJECT_CONCEPT_PLACEHOLDER = "Tell me about your project idea...";

export const WELCOME_MESSAGE_TEXT =
  "Welcome! I'm here to help you set up your project and create a roadmap. Let's start with understanding what you're building and the context around it.";

export const PROJECT_CONCEPT_REFERENCE_TEXT =
  "My project is a local AI tool that captions and tags my image and video datasets, with batch processing and a correction feedback loop.";

export const PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES: Record<
  ProjectDescriptionSelectKey,
  string
> = {
  projectMaturity: "greenfield",
  teamSize: "solo",
  orgContext: "hobby",
};

export const FOLLOWUPS_RESPONSE_TEXT =
  "Great context so far! You've given me a clear picture of the core functionality and your local setup. Let me dig into a few implementation details and priorities to help shape your roadmap.";

export const FOLLOWUPS_SKIP_HINT = "Answer N/A to skip.";

export interface FollowupsQuestion {
  id: string;
  label: string;
}

export const FOLLOWUPS_QUESTIONS: ReadonlyArray<FollowupsQuestion> = [
  {
    id: "mvp-scope",
    label:
      "What's your MVP scope? Should we start with image descriptions only, or do you want video support from day one?",
  },
  {
    id: "model-integration",
    label:
      "Which model do you want to integrate first — llama.cpp or Ollama? Or should we plan for both?",
  },
  {
    id: "model-guidance",
    label:
      "How will users provide guidance to the model — natural-language prompts, structured templates, or both?",
  },
  {
    id: "tag-strategy",
    label:
      "What's the priority for tag support — manual tagging, model-suggested tags, or both?",
  },
];

export const FEATURES_NARRATIVE_TEXT =
  "Your project breaks down into three deliverables: a captioning and tagging engine, batch processing across whole datasets, and a correction feedback loop that improves results over time.";

export const FEATURES_RESPONSE_TEXT =
  "I've proposed 3 top-level features with 10 child features underneath. Review below — approve to continue or request changes per section.";

export const FEATURES_PRIMARY_ACTION_LABEL = "Approve Features";

export const FEATURES_SECONDARY_ACTION_LABEL = "Request Changes";

export const FEATURES_TOP_LEVELS: ReadonlyArray<FeatureListProposalNode> = [
  {
    id: "top-captioning-engine",
    name: "Captioning & Tagging Engine",
    description:
      "The core local pipeline that turns images and video frames into captions and tags.",
    tag: FeatureTag.Product,
    children: [
      {
        id: "child-image-captioning",
        name: "Image captioning",
        description: "Generate a caption for any image in the dataset.",
        tag: FeatureTag.Product,
        children: [],
      },
      {
        id: "child-video-captioning",
        name: "Video captioning",
        description: "Sample video frames and produce a per-clip caption.",
        tag: FeatureTag.Product,
        children: [],
      },
      {
        id: "child-suggested-tags",
        name: "Suggested tags",
        description:
          "Surface model-suggested tags alongside each caption for review.",
        tag: FeatureTag.Product,
        children: [],
      },
      {
        id: "child-confidence-scoring",
        name: "Confidence scoring",
        description:
          "Attach a confidence score to each caption and tag so low-confidence items are easy to triage.",
        tag: FeatureTag.Product,
        children: [],
      },
    ],
  },
  {
    id: "top-batch-processing",
    name: "Batch Processing",
    description:
      "Run the engine across whole datasets without manually feeding it one file at a time.",
    tag: FeatureTag.Product,
    children: [
      {
        id: "child-dataset-import",
        name: "Dataset import",
        description: "Point the tool at a folder of images or videos to ingest.",
        tag: FeatureTag.Product,
        children: [],
      },
      {
        id: "child-job-queue",
        name: "Job queue",
        description:
          "Schedule and track captioning jobs so large datasets can run in the background.",
        tag: FeatureTag.Backend,
        children: [],
      },
      {
        id: "child-progress-tracking",
        name: "Progress tracking",
        description:
          "Show per-job progress, ETA, and a summary of items completed or failed.",
        tag: FeatureTag.Frontend,
        children: [],
      },
    ],
  },
  {
    id: "top-feedback-loop",
    name: "Correction Feedback Loop",
    description:
      "Capture user corrections so the system gets better at this dataset over time.",
    tag: FeatureTag.Product,
    children: [
      {
        id: "child-inline-correction",
        name: "Inline correction",
        description:
          "Edit captions and tags directly from the review surface.",
        tag: FeatureTag.Frontend,
        children: [],
      },
      {
        id: "child-feedback-storage",
        name: "Feedback storage",
        description:
          "Persist corrections alongside the original outputs as training signal.",
        tag: FeatureTag.Backend,
        children: [],
      },
      {
        id: "child-retraining-hook",
        name: "Retraining hook",
        description:
          "Expose the collected feedback so a fine-tune or prompt update can consume it.",
        tag: FeatureTag.Backend,
        children: [],
      },
    ],
  },
];
