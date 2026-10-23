import onePlaceV4Mp4 from "../../assets/landing/one-place-v4.mp4";
import onePlaceV4Poster from "../../assets/landing/one-place-v4-poster.png";
import onePlaceV4Webm from "../../assets/landing/one-place-v4.webm";
import directionToResultMp4 from "../../assets/landing/bring-back/direction-to-result.mp4";
import directionToResultPoster from "../../assets/landing/bring-back/direction-to-result-poster.png";
import directionToResultWebm from "../../assets/landing/bring-back/direction-to-result.webm";
import researchFindingReviewMp4 from "../../assets/landing/work items/research-finding-instance-preview.mp4";
import researchFindingReviewPoster from "../../assets/landing/work items/research-finding-review-preview-poster.png";
import workflowPoster from "../../assets/landing/workflow-poster.png";
import proposalReviewPoster from "../../assets/landing/proposal/proposal-review-poster.png";
import modelSelectMp4 from "../../assets/landing/model-select/model-select.mp4";
import modelSelectMobileMp4 from "../../assets/landing/model-select/model-select-mobile.mp4";
import modelSelectMobilePoster from "../../assets/landing/model-select/model-select-mobile-poster.png";
import modelSelectMobileWebm from "../../assets/landing/model-select/model-select-mobile.webm";
import modelSelectPoster from "../../assets/landing/model-select/model-select-poster.png";
import modelSelectWebm from "../../assets/landing/model-select/model-select.webm";

export interface LandingCapability {
  id: string;
  title: string;
  description: string;
}

interface LandingProofImage {
  type: "image";
  posterSrc: string;
  alt: string;
  aspectRatio?: string;
  mobile?: LandingProofImage;
}

export interface LandingProofVideo {
  type: "video";
  webmSrc?: string;
  mp4Src: string;
  posterSrc: string;
  alt: string;
  aspectRatio?: string;
  mobile?: LandingProofVideo;
}

interface LandingProofSectionCopy {
  mobileBody?: readonly string[];
}

export interface LandingProofSection extends LandingProofSectionCopy {
  id: string;
  title: string;
  body: readonly string[];
  visual?: LandingProofImage | LandingProofVideo;
}

export interface LandingHeroView extends LandingProofSectionCopy {
  id: string;
  title: string;
  body: readonly string[];
  visual: LandingProofVideo;
}

export const landingPageCopy = {
  hero: {
    title: "A living workspace",
    description:
      "Connect plans, decisions, workflows, conversations, and implementation in one living graph. Agents help build and maintain your structure as the project changes.",
    primaryAction: "Sign up",
    signInAction: "Existing User Sign In",
  },
  capabilities: [
    {
      id: "harness-project-management",
      title: "Your harness’ missing project management.",
      description:
        "Keep features, plans, decisions, conversations, and implementation connected in one workspace.",
    },
    {
      id: "own-the-decisions",
      title: "You own the decisions.",
      description:
        "Agent proposals go through an auditable approval process. Configure who needs to approve and how many approvals are required.",
    },
    {
      id: "project-context",
      title: "Project context that keeps up.",
      description:
        "Agents use your project context as they work and propose updates reflecting what changed and what they learned.",
    },
    {
      id: "define-project-tracking",
      title: "Define what your project tracks.",
      description:
        "Add the types of information your project needs, including how they connect to the rest of your work.",
    },
    {
      id: "existing-plan",
      title: "Use the plan you already have.",
      description:
        "Connect Claude, Codex, or OpenCode with your existing subscription.",
    },
    {
      id: "multiple-repositories",
      title: "One project, multiple repositories.",
      description:
        "Coordinate related work across codebases within the same project context.",
    },
    {
      id: "continue-from-phone",
      title: "Continue from your phone.",
      description:
        "Access your connected coding agent through Hey Hey while away from your desk.",
    },
    {
      id: "visible-workflows",
      title: "Make workflows visible.",
      description:
        "Map steps, decisions, and handoffs, with important agreements attached where they apply.",
    },
    {
      id: "direction-to-implementation",
      title: "From direction to implementation.",
      description:
        "Start with a project objective and develop it into a reviewable plan and implementation work.",
    },
  ] satisfies readonly LandingCapability[],
  proofSections: [
    {
      id: "existing-agent-plan",
      title: "Use the plan you already have",
      body: [
        "Connect Claude, Codex, or OpenCode to Hey Hey and use anywhere. Hey Hey adds the intelligent workspace on top of your coding CLI, including on the go via mobile through our secure channel.",
      ],
      mobileBody: [
        "Connect Claude, Codex, or OpenCode to Hey Hey and use anywhere. Hey Hey adds the intelligent workspace on top of your coding CLI, including on the go via mobile through our secure channel.",
      ],
      visual: {
        type: "image",
        posterSrc: modelSelectPoster,
        alt: "Sanitized Hey Hey demo showing a dark-mode coding session with Codex selected, a light-mode Conversation Launch flow, and a portrait mobile session",
        mobile: {
          type: "image",
          posterSrc: modelSelectMobilePoster,
          alt: "Hey Hey mobile demo showing a portrait feature page, the Conversation Launch dialog, and mobile model selection",
          aspectRatio: "430 / 934",
        },
      },
    },
    {
      id: "whole-project",
      title: "One place for the whole project",
      body: [
        "Whether you’re building an app, a game, or something that does not fit neatly into tickets, Hey Hey gives the project a shape everyone can work from. Keep the direction, decisions, conversations, and implementation work connected in one place.",
      ],
      visual: {
        type: "image",
        posterSrc: onePlaceV4Poster,
        alt: "Hey Hey Features workspace showing AI Home Guide selected with its description and embedded workflow context in the Trailboard demo",
      },
    },
    {
      id: "direction-to-result",
      title: "The Living Workspace",
      body: [
        "Go from idea to implementation and back again. Use integrated agents to automate the busy work of keeping your project up to date. Any change, no matter how small, can trace its decision history, connections, and impact.",
      ],
      visual: {
        type: "image",
        posterSrc: directionToResultPoster,
        alt: "Hey Hey turns project direction into proposed work and brings implementation results back into the project",
      },
    },
    {
      id: "approve-each-step",
      title: "You approve each step",
      body: [
        "Agents can propose a sequence of project changes, but they cannot quietly make those changes true. Review each proposal, then use the update history to see what changed, why it changed, and which proposals were accepted.",
      ],
      visual: {
        type: "image",
        posterSrc: proposalReviewPoster,
        alt: "Trailboard proposal conversation reconciling a Project Timeline requirement with a new offline-editing task, followed by the grouped proposal review surface showing the pending changes",
      },
    },
    {
      id: "visible-decisions",
      title: "Some decisions are easier to see than describe",
      body: [
        "Map the steps, decisions, and handoffs in a workflow. Attach an important agreement to the step responsible for keeping it. When an agent proposes implementation work, you can see both the behavior it delivers and the Contract it must honor.",
      ],
      visual: {
        type: "image",
        posterSrc: workflowPoster,
        alt: "Trailboard workflow graph for saving an offline trip edit, showing a connection decision, a durable trip-edit acknowledgement Contract, and a proposed task fulfilling the acknowledgement step",
      },
    },
    {
      id: "custom-project-model",
      title: "Your project does not have to fit our template",
      body: [
        "Tell Hey Hey what else your project needs to track. An agent can propose the new type, where it belongs, and how it connects to the project. You review the structure before adding it.",
      ],
      visual: {
        type: "video",
        mp4Src: researchFindingReviewMp4,
        posterSrc: researchFindingReviewPoster,
        alt: "Sanitized Trailboard review showing a proposed Research Finding with Finding, Evidence, Source, and Implications content and affected-Feature relationships before approval",
      },
    },
  ] satisfies readonly LandingProofSection[],
  beta: {
    title: "Build with agents without losing the plot",
    description:
      "Hey Hey is in beta for serious solo builders and small software teams maintaining real products with coding agents. Sign up and give it a try while we are in beta.",
    action: "Sign up",
  },
} as const;

export const landingHeroViews = [
  {
    ...landingPageCopy.proofSections[1],
    visual: {
      type: "video",
      webmSrc: onePlaceV4Webm,
      mp4Src: onePlaceV4Mp4,
      posterSrc: onePlaceV4Poster,
      alt: "Hey Hey Features workspace showing AI Home Guide selected with its description and embedded workflow context in the Trailboard demo",
    },
  },
  {
    ...landingPageCopy.proofSections[0],
    visual: {
      type: "video",
      webmSrc: modelSelectWebm,
      mp4Src: modelSelectMp4,
      posterSrc: modelSelectPoster,
      alt: "Sanitized Hey Hey demo showing a dark-mode coding session with Codex selected, a light-mode Conversation Launch flow, and a portrait mobile session",
      mobile: {
        type: "video",
        webmSrc: modelSelectMobileWebm,
        mp4Src: modelSelectMobileMp4,
        posterSrc: modelSelectMobilePoster,
        alt: "Hey Hey mobile demo showing a portrait feature page, the Conversation Launch dialog, and mobile model selection",
        aspectRatio: "430 / 934",
      },
    },
  },
  {
    ...landingPageCopy.proofSections[2],
    visual: {
      type: "video",
      webmSrc: directionToResultWebm,
      mp4Src: directionToResultMp4,
      posterSrc: directionToResultPoster,
      alt: "Hey Hey turns project direction into proposed work and brings implementation results back into the project",
    },
  },
] satisfies readonly LandingHeroView[];
