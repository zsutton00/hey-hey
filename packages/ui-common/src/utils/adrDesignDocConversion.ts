/**
 * Utility functions to convert between DesignDoc sections format and AdrContent format
 *
 * DesignDoc format: sections[] array with { key, content, order }
 * AdrContent format: flat object with { context, decision, consequences }
 */

import type {
  DesignDocDraftSection,
  DesignDocResponseDto,
  MaterializedDesignDocSection,
} from "../api";
import type { AdrContent } from "../types/adr";

/**
 * Convert DesignDoc sections to AdrContent flat structure
 */
export function designDocToAdrContent(
  designDoc: DesignDocResponseDto,
): AdrContent {
  const adrContent: AdrContent = {
    context: "",
    decision: "",
    consequences: "",
  };

  const sections = designDoc.sections ?? [];

  sections.forEach((section: MaterializedDesignDocSection) => {
    const key = section.key.toLowerCase();
    const canonicalMarkdown = section.materializedMarkdown ?? "";

    switch (key) {
      case "context":
        adrContent.context = canonicalMarkdown;
        break;
      case "decision":
        adrContent.decision = canonicalMarkdown;
        break;
      case "consequences":
        adrContent.consequences = canonicalMarkdown;
        break;
      default:
        break;
    }
  });

  return adrContent;
}

/**
 * Convert AdrContent flat structure to DesignDoc sections array
 */
export function adrContentToDesignDocSections(
  adrContent: AdrContent,
): DesignDocDraftSection[] {
  const sections: DesignDocDraftSection[] = [
    {
      id: "", // Will be assigned by server
      key: "context",
      content: adrContent.context || "",
      order: 0,
    },
    {
      id: "", // Will be assigned by server
      key: "decision",
      content: adrContent.decision || "",
      order: 1,
    },
    {
      id: "", // Will be assigned by server
      key: "consequences",
      content: adrContent.consequences || "",
      order: 2,
    },
  ];

  return sections;
}

/**
 * Extract ADR metadata from DesignDoc
 */
export interface AdrMetadata {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  projectId?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  summary?: string | null;
  metadata?: { [key: string]: unknown } | null;
}

export function extractAdrMetadata(
  designDoc: DesignDocResponseDto,
): AdrMetadata {
  return {
    id: designDoc.id,
    name: designDoc.name,
    status: designDoc.status,
    organizationId: designDoc.organizationId,
    projectId: designDoc.projectId,
    tags: designDoc.tags,
    createdAt: designDoc.createdAt,
    updatedAt: designDoc.updatedAt,
    summary: designDoc.summary,
  };
}
