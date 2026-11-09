import type {
  CodingResearchReportPayload,
  CodingResearchUncertainty,
  EntityType,
} from "../../../api";

export interface CodingResearchSubagentParentAnalysis {
  analysis: string;
  uncertainties: CodingResearchUncertainty[];
}

const UNCERTAINTY_HEADING = /^(#{2,6})\s+Uncertainties\s*$/iu;
const ENTRY =
  /^\s*-\s+\*\*(lack_of_evidence|conflict|ambiguity|not_implemented)\s+·\s+(low|medium|high)\*\*\s+—\s+(.+?)\s+—\s+References:\s*(.*)$/iu;
const MENTION = /@\[([a-z_]+):([0-9a-f-]{36})\|([^\]]+)\]/giu;

const ENTITY_TYPES: Record<string, EntityType> = {
  artifact: "ARTIFACT",
  initiative: "INITIATIVE",
  project: "PROJECT",
  task: "TASK",
  feature: "TASK",
  standard: "TASK",
  bug: "TASK",
  contract: "TASK",
  diagram: "TASK",
  message: "MESSAGE",
  conversation: "CONVERSATION",
  design_doc: "DESIGN_DOC",
  agent_session: "AGENT_SESSION",
  service: "SERVICE",
  report: "REPORT",
  proposal: "PROPOSAL",
  implementation_hint: "IMPLEMENTATION_HINT",
  user: "USER",
};

const CATEGORIES: Record<string, CodingResearchUncertainty["category"]> = {
  lack_of_evidence: "lack_of_evidence",
  conflict: "conflict",
  ambiguity: "ambiguity",
  not_implemented: "not_implemented",
};

const SEVERITIES: Record<string, CodingResearchUncertainty["severity"]> = {
  low: "low",
  medium: "medium",
  high: "high",
};

const parseEntry = (line: string): CodingResearchUncertainty | null => {
  const match = ENTRY.exec(line);
  if (!match) {
    return null;
  }

  const references: CodingResearchUncertainty["references"] = [];
  const rawReferences = match[4].trim();
  if (rawReferences && rawReferences.toLowerCase() !== "none") {
    let consumed = "";
    for (const mention of rawReferences.matchAll(MENTION)) {
      const entityType = ENTITY_TYPES[mention[1].toLowerCase()];
      if (!entityType) {
        return null;
      }
      references.push({
        entityType,
        entityId: mention[2],
        title: mention[3],
      });
      consumed += mention[0];
    }
    if (
      references.length === 0 ||
      rawReferences.replace(/,\s*/gu, "") !== consumed
    ) {
      return null;
    }
  }

  return {
    category: CATEGORIES[match[1].toLowerCase()],
    severity: SEVERITIES[match[2].toLowerCase()],
    statement: match[3].trim(),
    references,
  };
};

export const parseCodingResearchSubagentParentAnalysis = (
  analysis: string,
): CodingResearchSubagentParentAnalysis => {
  const lines = analysis.split("\n");
  const uncertainties: CodingResearchUncertainty[] = [];
  const retainedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = UNCERTAINTY_HEADING.exec(lines[index]);
    if (!heading) {
      retainedLines.push(lines[index]);
      continue;
    }

    const sectionLines = [lines[index]];
    const recognizedLines = new Set<number>();
    const start = index;
    let next = index + 1;
    for (; next < lines.length; next += 1) {
      const nextHeading = /^(#{1,6})\s+/u.exec(lines[next]);
      if (nextHeading && nextHeading[1].length <= heading[1].length) {
        break;
      }
      sectionLines.push(lines[next]);
      const parsed = parseEntry(lines[next]);
      if (parsed) {
        uncertainties.push(parsed);
        recognizedLines.add(next - start);
      }
    }

    const unrecognizedContent = sectionLines
      .slice(1)
      .filter(
        (line, offset) =>
          !recognizedLines.has(offset + 1) && line.trim().length > 0,
      );
    if (unrecognizedContent.length > 0) {
      retainedLines.push(
        ...sectionLines.filter(
          (_, offset) => offset === 0 || !recognizedLines.has(offset),
        ),
      );
    }
    index = next - 1;
  }

  return {
    analysis: retainedLines
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    uncertainties,
  };
};

export const getCodingResearchUncertainties = (
  payload: CodingResearchReportPayload,
): CodingResearchUncertainty[] => {
  if (payload.format === "SUBAGENT_PARENT") {
    return parseCodingResearchSubagentParentAnalysis(payload.analysis)
      .uncertainties;
  }

  return payload.uncertainties ?? [];
};
