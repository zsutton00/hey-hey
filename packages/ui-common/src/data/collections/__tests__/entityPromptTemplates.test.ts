import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type {
  EntityPromptTemplateCatalogEntryDto,
  EntityPromptTemplateSelectorDto,
} from "../../../api";
import {
  promptTemplateKeys,
  refetchEntityPromptTemplateProjections,
  selectEntityPromptTemplateCanonical,
  selectEntityPromptTemplateEffective,
  selectEntityPromptTemplateProjectOverride,
  selectEntityPromptTemplateRevisionHistory,
  type EntityPromptTemplateProjectionIdentity,
} from "../entityPromptTemplates";
const selector: EntityPromptTemplateSelectorDto = {
  entityType: "WORK_ITEM",
  workItemTypeKey: "STANDARD",
};

const identity: EntityPromptTemplateProjectionIdentity = {
  organizationId: "org-1",
  projectId: "project-1",
  templateKey: "entity_context",
  selector,
};

const template: EntityPromptTemplateCatalogEntryDto = {
  templateKey: identity.templateKey,
  canonicalDefault: {
    templateKey: identity.templateKey,
    selector,
    syntaxVersion: "V1",
    revisionId: "canonical-revision",
    revisionNumber: 1,
    content: "canonical",
    ownershipScope: { scope: "CANONICAL" },
    lifecycleState: "PUBLISHED",
    validation: { status: "VALID", issues: [] },
  },
  revisionHistory: [],
  effective: {
    templateKey: identity.templateKey,
    selector,
    syntaxVersion: "V1",
    content: "canonical",
    ownershipSource: { scope: "CANONICAL" },
    revisionId: "canonical-revision",
    revisionNumber: 1,
    lifecycleState: "PUBLISHED",
    validationStatus: "VALID",
    publishedAt: "2026-08-01T00:00:00.000Z",
  },
};

describe("entity prompt template query projections", () => {
  it("isolates catalog scope and effective selector identities", () => {
    expect(promptTemplateKeys.catalog(identity)).toEqual([
      "entityPromptTemplates",
      "org-1",
      "project-1",
      "catalog",
    ]);
    for (const variant of [
      { ...identity, organizationId: "other" },
      { ...identity, projectId: "other" },
      {
        ...identity,
        selector: { entityType: "WORK_ITEM" as const, workItemTypeKey: "BUG" },
      },
    ])
      expect(promptTemplateKeys.effective(variant)).not.toEqual(
        promptTemplateKeys.effective(identity)
      );
  });
  it("invalidates only the catalog and effective projection that was approved", async () => {
    const client = new QueryClient();
    const catalog = promptTemplateKeys.catalog(identity);
    const effective = promptTemplateKeys.effective(identity);
    const other = promptTemplateKeys.effective({
      ...identity,
      selector: { entityType: "PROJECT" },
    });
    client.setQueryData(catalog, [template]);
    client.setQueryData(effective, template.effective);
    client.setQueryData(other, template.effective);
    await refetchEntityPromptTemplateProjections(client, identity);
    expect(client.getQueryState(catalog)?.isInvalidated).toBe(true);
    expect(client.getQueryState(effective)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
  it("preserves server-provided projections without applying precedence", () => {
    expect(selectEntityPromptTemplateCanonical(template)).toBe(
      template.canonicalDefault
    );
    expect(selectEntityPromptTemplateProjectOverride(template)).toBeUndefined();
    expect(selectEntityPromptTemplateRevisionHistory(template)).toBe(
      template.revisionHistory
    );
    expect(selectEntityPromptTemplateEffective(template)).toBe(
      template.effective
    );
  });
});
