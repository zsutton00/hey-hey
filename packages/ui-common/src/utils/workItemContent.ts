/**
 * Work Item Content Parsing and Serialization Utilities
 *
 * Handles conversion between MultiLevelContent object and unified markdown format
 * for the unified work item editor integration. Supports both initiatives and tasks.
 */

// Define LevelType locally to avoid import issues
export type LevelType = "description" | "acceptanceCriteria";
// Simple header level type without external dependency
type HeaderLevel = 1 | 2 | 3;
import { log } from "./logger";

// Re-export the MultiLevelContent interface for external use
export interface MultiLevelContent extends Record<string, string> {
  description: string;
  acceptanceCriteria: string;
  requirements: string;
}

export interface WorkItemSection {
  header: string;
  content: string;
  level: LevelType;
  headerLevel: HeaderLevel;
  startIndex: number;
  endIndex: number;
}

// Map level types to property keys
export const LEVEL_PROPERTY_MAP: Record<LevelType, keyof MultiLevelContent> = {
  description: "description",
  acceptanceCriteria: "acceptanceCriteria",
};

// Map level types to display names
export const LEVEL_DISPLAY_MAP: Record<LevelType, string> = {
  description: "Description",
  acceptanceCriteria: "Acceptance Criteria",
};

// Default section order
export const SECTION_ORDER: LevelType[] = ["description", "acceptanceCriteria"];

/**
 * Parse unified markdown content into MultiLevelContent object
 */
export function parseUnifiedContent(content: string): MultiLevelContent {
  log.contentParse("parseUnifiedContent called with", content);

  if (!content?.trim()) {
    const emptyResult: MultiLevelContent = {
      description: "",
      acceptanceCriteria: "",
      requirements: "",
    };
    log.contentParse("parseUnifiedContent returning empty", emptyResult);
    return emptyResult;
  }

  const sections = extractSections(content);
  const result: MultiLevelContent = {
    description: "",
    acceptanceCriteria: "",
    requirements: "",
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
  includeEmptySections: boolean = true
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
 * Extract current section based on cursor position in unified content
 */
export function extractCurrentSection(
  content: string,
  cursorPosition: number
): LevelType {
  if (!content?.trim() || cursorPosition < 0) {
    return "description"; // Default to first section
  }

  const sections = extractSections(content);

  // Find which section contains the cursor position
  for (const section of sections) {
    if (
      cursorPosition >= section.startIndex &&
      cursorPosition <= section.endIndex
    ) {
      return section.level;
    }
  }

  // If cursor is after all sections, return the last section
  if (sections.length > 0) {
    const lastSection = sections[sections.length - 1];
    if (cursorPosition > lastSection.endIndex) {
      return lastSection.level;
    }
  }

  return "description"; // Fallback to first section
}

/**
 * Extract sections from unified markdown content with position information
 * Uses custom header syntax: [[ SectionName ]]
 */
function extractSections(content: string): WorkItemSection[] {
  const sections: WorkItemSection[] = [];
  const lines = content.split("\n");

  let currentSection: Partial<WorkItemSection> | null = null;
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
          } as WorkItemSection);
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
    } as WorkItemSection);
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
export function isMainSectionHeader(headerText: string): boolean {
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
  if (normalized === "acceptance criteria") {
    return "acceptanceCriteria";
  }

  // Fallback - should not be reached for main sections
  return "description";
}

/**
 * Create default sections when no headers are found
 */
function createDefaultSections(content: string): WorkItemSection[] {
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

/**
 * Get section content for a specific level
 */
export function getSectionContent(content: string, level: LevelType): string {
  const multiLevel = parseUnifiedContent(content);
  const propertyKey = LEVEL_PROPERTY_MAP[level];
  return multiLevel[propertyKey] || "";
}

/**
 * Update section content for a specific level
 */
export function updateSectionContent(
  unifiedContent: string,
  level: LevelType,
  newContent: string
): string {
  const multiLevel = parseUnifiedContent(unifiedContent);
  const propertyKey = LEVEL_PROPERTY_MAP[level];

  multiLevel[propertyKey] = newContent;

  return serializeToUnifiedContent(multiLevel);
}

/**
 * Check if content has all required sections
 */
export function hasAllSections(content: string): boolean {
  const sections = extractSections(content);
  const presentLevels = new Set(sections.map((s) => s.level));

  return SECTION_ORDER.every((level) => presentLevels.has(level));
}

/**
 * Ensure content has all required sections with proper headers
 */
export function ensureAllSections(content: string): string {
  if (!content?.trim()) {
    // Create empty content with all headers
    return serializeToUnifiedContent({
      description: "",
      acceptanceCriteria: "",
      requirements: "",
    });
  }

  const multiLevel = parseUnifiedContent(content);
  return serializeToUnifiedContent(multiLevel);
}

/**
 * Migrate legacy multi-level content to unified format
 */
export function migrateLegacyContent(multiLevel: MultiLevelContent): string {
  // Validate input
  if (!multiLevel || typeof multiLevel !== "object") {
    return ensureAllSections("");
  }

  // Ensure all properties exist
  const normalizedContent: MultiLevelContent = {
    description: multiLevel.description || "",
    acceptanceCriteria: multiLevel.acceptanceCriteria || "",
    requirements: multiLevel.requirements || "",
  };

  return serializeToUnifiedContent(normalizedContent);
}

/**
 * Preserve AI suggestions metadata during content conversion
 */
export function preserveAISuggestions(content: string): string {
  // For now, return content as-is since AI suggestions are handled at the node level
  // Future enhancement: could add metadata preservation logic here
  return content;
}

/**
 * Get level from property key
 */
export function getLevelFromPropertyKey(
  key: keyof MultiLevelContent
): LevelType {
  const entry = Object.entries(LEVEL_PROPERTY_MAP).find(
    ([_, propKey]) => propKey === key
  );
  return entry ? (entry[0] as LevelType) : "description";
}

/**
 * Get property key from level
 */
export function getPropertyKeyFromLevel(
  level: LevelType
): keyof MultiLevelContent {
  return LEVEL_PROPERTY_MAP[level];
}

/**
 * Validate unified content structure
 */
export function validateUnifiedContent(content: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const sections = extractSections(content);

    if (sections.length === 0) {
      warnings.push("No sections found in content");
    }

    // Check for duplicate sections
    const levelCounts = new Map<LevelType, number>();
    sections.forEach((section) => {
      const count = levelCounts.get(section.level) || 0;
      levelCounts.set(section.level, count + 1);
    });

    levelCounts.forEach((count, level) => {
      if (count > 1) {
        warnings.push(`Duplicate ${level} section found`);
      }
    });

    // Check for unknown sections
    sections.forEach((section) => {
      if (!SECTION_ORDER.includes(section.level)) {
        warnings.push(`Unknown section type: ${section.level}`);
      }
    });
  } catch (error) {
    errors.push(
      `Content parsing failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
