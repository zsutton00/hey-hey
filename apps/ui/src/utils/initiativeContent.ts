/**
 * Initiative Content Parsing and Serialization Utilities
 *
 * Handles conversion between MultiLevelContent object and unified markdown format
 * for the unified initiative editor integration.
 */

import type { LevelType } from "../components/Initiative/InitiativeEditor";
// Simple header level type without external dependency
type HeaderLevel = 1 | 2 | 3;
import { log } from "./logger";

// Re-export the MultiLevelContent interface for external use
export interface MultiLevelContent {
  description: string;
  details: string;
  acceptanceCriteria: string;
}

interface InitiativeSection {
  header: string;
  content: string;
  level: LevelType;
  headerLevel: HeaderLevel;
  startIndex: number;
  endIndex: number;
}

// Map level types to property keys
const LEVEL_PROPERTY_MAP: Record<LevelType, keyof MultiLevelContent> = {
  description: "description",
  details: "details",
  acceptance_criteria: "acceptanceCriteria",
};

// Map level types to display names
const LEVEL_DISPLAY_MAP: Record<LevelType, string> = {
  description: "Description",
  details: "Details",
  acceptance_criteria: "Acceptance Criteria",
};

// Default section order
const SECTION_ORDER: LevelType[] = [
  "description",
  "details",
  "acceptance_criteria",
];

/**
 * Parse unified markdown content into MultiLevelContent object
 */
export function parseUnifiedContent(content: string): MultiLevelContent {
  log.contentParse("parseUnifiedContent called with", content);

  if (!content?.trim()) {
    const emptyResult = {
      description: "",
      details: "",
      acceptanceCriteria: "",
    };
    log.contentParse("parseUnifiedContent returning empty", emptyResult);
    return emptyResult;
  }

  const sections = extractSections(content);
  const result: MultiLevelContent = {
    description: "",
    details: "",
    acceptanceCriteria: "",
  };

  // Map sections to result object
  sections.forEach((section) => {
    const propertyKey = LEVEL_PROPERTY_MAP[section.level];
    if (propertyKey) {
      result[propertyKey] = section.content.trim();
    }
  });

  log.contentParse("parseUnifiedContent returning", result);
  return result;
}

/**
 * Serialize MultiLevelContent object to unified markdown format
 * Uses custom header syntax: [[ SectionName ]]
 * @param multiLevel The multi-level content to serialize
 * @param includeEmptySections Whether to include empty sections (default: true)
 */
export function serializeToUnifiedContent(
  multiLevel: MultiLevelContent,
  includeEmptySections: boolean = true,
): string {
  log.contentSerialize("serializeToUnifiedContent called with", multiLevel);
  const sections: string[] = [];

  SECTION_ORDER.forEach((level) => {
    const propertyKey = LEVEL_PROPERTY_MAP[level];
    const displayName = LEVEL_DISPLAY_MAP[level];
    const content = multiLevel[propertyKey]?.trim() || "";

    // Include header for all sections if includeEmptySections is true
    if (content || includeEmptySections) {
      sections.push(`[[ ${displayName} ]]`);

      if (content) {
        sections.push("");
        sections.push(content);
      }

      sections.push(""); // Add spacing between sections
    }
  });

  const result = sections.join("\n").trim();
  log.contentSerialize("serializeToUnifiedContent returning", result);
  return result;
}

/**
 * Extract sections from unified markdown content with position information
 * Uses custom header syntax: [[ SectionName ]]
 */
function extractSections(content: string): InitiativeSection[] {
  const sections: InitiativeSection[] = [];
  const lines = content.split("\n");

  let currentSection: Partial<InitiativeSection> | null = null;
  let currentIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match custom headers: [[ SectionName ]]
    const customHeaderMatch = line.match(/^\[\[\s*(.+?)\s*\]\]$/);

    if (customHeaderMatch) {
      const headerText = customHeaderMatch[1].trim();
      const level = mapHeaderToLevel(headerText);

      // Only create new sections for valid main section matches
      if (isMainSectionHeader(headerText)) {
        // Complete previous section if exists
        if (currentSection) {
          // Trim any trailing whitespace from content
          currentSection.content = currentSection.content?.trim() || "";
          const endIndex = currentIndex - 1;
          sections.push({
            ...currentSection,
            endIndex,
          } as InitiativeSection);
        }

        // Start new main section
        currentSection = {
          header: headerText,
          content: "",
          level,
          headerLevel: 2 as HeaderLevel,
          startIndex: currentIndex,
        };
      } else {
        // Unknown custom header - treat as content
        if (currentSection) {
          if (currentSection.content) {
            currentSection.content += "\n" + line;
          } else {
            currentSection.content = line;
          }
        }
      }
    } else if (currentSection) {
      // Add content to current section (including regular markdown headers and text)
      // Skip the first empty line after a header
      if (currentSection.content === "" && line.trim() === "") {
        // Skip empty line immediately after header
      } else {
        if (currentSection.content) {
          currentSection.content += "\n" + line;
        } else {
          currentSection.content = line;
        }
      }
    } else if (line.trim()) {
      // Content before any headers - treat as description
      if (!currentSection) {
        currentSection = {
          header: "Description",
          content: line,
          level: "description",
          headerLevel: 2 as HeaderLevel,
          startIndex: currentIndex,
        };
      }
    }

    // Update index with line length + newline character
    currentIndex += line.length + 1;
  }

  // Complete final section
  if (currentSection) {
    currentSection.content = currentSection.content?.trim() || "";
    sections.push({
      ...currentSection,
      endIndex: content.length,
    } as InitiativeSection);
  }

  // If no sections found, create default sections
  if (sections.length === 0) {
    return createDefaultSections(content);
  }

  return sections;
}

/**
 * Check if a header text represents a main section header
 */
function isMainSectionHeader(headerText: string): boolean {
  const normalized = headerText
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
  return (
    normalized === "description" ||
    normalized === "details" ||
    normalized === "acceptance criteria"
  );
}

/**
 * Map header text to level type - only exact matches for main sections
 */
function mapHeaderToLevel(headerText: string): LevelType {
  const normalized = headerText
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();

  // Exact matching for main sections only
  if (normalized === "description") {
    return "description";
  }
  if (normalized === "details") {
    return "details";
  }
  if (normalized === "acceptance criteria") {
    return "acceptance_criteria";
  }

  // Fallback - should not be reached for main sections
  return "description";
}

/**
 * Create default sections when no headers are found
 */
function createDefaultSections(content: string): InitiativeSection[] {
  return [
    {
      header: LEVEL_DISPLAY_MAP.description,
      content: content.trim(),
      level: "description",
      headerLevel: 2 as HeaderLevel,
      startIndex: 0,
      endIndex: content.length,
    },
  ];
}
