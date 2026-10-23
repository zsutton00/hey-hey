import { useMemo } from "react";

import type {
  HelpDataCapability,
  HelpFeatureNextStep,
  HelpFeatureRecord,
} from "@hey-hey/ui-common/components";
import {
  useFeatureDocumentContent,
  useFeatureHierarchy,
  useProject,
} from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";
import { getWorkItemSectionContent } from "@hey-hey/ui-common/utils";

const OVERVIEW_MAX_LENGTH = 160;

/**
 * Shortens a Feature description to a plain-text overview: mentions collapse
 * to their titles, markdown markers drop out, and the text is cut at the first
 * sentence or about 160 characters, whichever comes first.
 */
function toOverview(description: string): string | undefined {
  const plain = description
    .replace(/@\[[a-z_]+:[^|\]]+\|([^\]]+)\]/gi, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return undefined;
  const sentence = plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain;
  if (sentence.length <= OVERVIEW_MAX_LENGTH) return sentence;
  const cut = sentence.slice(0, OVERVIEW_MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Web-platform implementation of the help data-access capability.
 *
 * Resolves the project's top-level features from the cached feature
 * hierarchy and maps each into a
 * `HelpFeatureRecord` whose `href` deep-links into the feature's Discuss
 * Tasks tab. The intro help view interpolates this list into scenario copy
 * (e.g. "features-ready").
 *
 * Each record carries a short overview taken from the Feature's existing
 * description. The next-step suggestions saved on the project config by feature-discovery
 * onboarding are joined to the same records, so a suggestion whose Feature no
 * longer exists as a top-level is dropped rather than shown as a dead link.
 */
export function useHelpDataCapability(
  organizationId: string,
  projectId: string,
): HelpDataCapability {
  const { roots } = useFeatureHierarchy(organizationId, projectId);
  const { data: project } = useProject(organizationId, projectId, {
    preferStale: true,
  });
  const savedNextSteps = project?.config?.featureNextSteps;
  const rootIds = useMemo(
    () => roots.map(({ feature }) => feature.id),
    [roots],
  );
  const { entries } = useFeatureDocumentContent(
    organizationId,
    projectId,
    rootIds,
  );

  return useMemo<HelpDataCapability>(() => {
    const features: HelpFeatureRecord[] = roots.map(({ feature }) => {
      const overview = toOverview(
        getWorkItemSectionContent(
          entries.get(feature.id)?.data?.sections,
          "description",
        ),
      );
      return {
        id: feature.id,
        name: feature.name,
        href: `${WebPathService.feature({ projectId, featureId: feature.id })}?discuss=tasks`,
        ...(overview ? { overview } : {}),
      };
    });
    const featuresById = new Map(features.map((record) => [record.id, record]));
    const featureNextSteps = (savedNextSteps ?? []).flatMap(
      (step): HelpFeatureNextStep[] => {
        const feature = featuresById.get(step.featureId);
        return feature
          ? [
              {
                feature,
                kind: step.kind,
                rationale: step.rationale,
                starterPrompt: step.starterPrompt,
              },
            ]
          : [];
      },
    );
    return { features, featureNextSteps };
  }, [roots, entries, projectId, savedNextSteps]);
}
