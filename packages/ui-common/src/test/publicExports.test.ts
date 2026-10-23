import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const readExports = (path: string) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
  );
  const names = new Set<string>();
  const modules = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      modules.add(statement.moduleSpecifier.text);
    }
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements)
        names.add(element.name.text);
    }
  }
  return { names, modules };
};

describe("public exports preserved by the plan migration", () => {
  it("keeps existing component APIs alongside canonical alias routing", () => {
    const { names, modules } = readExports("src/components/index.ts");
    for (const name of [
      "RichTextEditor",
      "SmarterTextAreaEditor",
      "SubmitButton",
    ]) {
      expect(names.has(name), name).toBe(true);
    }
    expect(modules.has("./Auth")).toBe(true);
    expect(modules.has("./EntityPromptTemplateEditor")).toBe(true);
    expect(modules.has("./CodePrompt")).toBe(false);
    expect(modules.has("./SessionMessage")).toBe(false);
  });

  it("keeps reference, authorization, and template APIs alongside canonical plans", () => {
    const { names, modules } = readExports("src/data/index.ts");
    for (const name of [
      "fetchAllWorkItemReferences",
      "workItemReferenceKeys",
      "workItemReferencesQueryOptions",
      "WorkItemReferenceScope",
      "dataLayerQueryRoots",
      "invalidateAllDataLayerQueries",
      "invalidateProjectWorkItemQueries",
      "entityStarKeys",
      "entityStarsQueryOptions",
      "filterEntityStars",
      "privateBetaDisclosureKeys",
      "privateBetaDisclosureQueryOptions",
      "ControllerAuthorizationPromptHost",
      "entityPromptTemplateCatalogQueryOptions",
      "getEntityPromptTemplateCompositionMetadata",
      "composeCanonicalPlanAggregate",
    ]) {
      expect(names.has(name), name).toBe(true);
    }
    expect(modules.has("./featureReferenceIndex")).toBe(true);
    expect(modules.has("./controllerAuthorization/webauthnAssertion")).toBe(
      true,
    );
    expect(
      modules.has(
        "./controllerAuthorization/controllerAuthorizationPreference",
      ),
    ).toBe(true);
  });
});
