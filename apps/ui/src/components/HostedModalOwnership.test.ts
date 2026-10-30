import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
function imports(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return source.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(target)
      : /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
        ? [target]
        : [];
  });
}
describe("retained modal ownership direction", () => {
  it("keeps independently owned business state out of routed-page modules", () => {
    const owners = [
      "apps/ui/src/components/HostedModalInstance.tsx",
      "apps/ui/src/components/Explorer/HostedTriageOwner.tsx",
      "apps/ui/src/components/Explorer/OpenItemsTriageContent.tsx",
      "apps/ui/src/components/Explorer/useTriageLaunchOutcome.ts",
      "apps/ui/src/components/Explorer/useTriagePromotionConfirmation.ts",
      "packages/ui-common/src/components/InteractionComponent/HostedDiscussOwner.tsx",
    ];
    const visited = new Set<string>();
    const compositions = new Set([
      "CanonicalEntityPreview.tsx",
      "CanonicalCollectionPreview.tsx",
    ]);
    function inspect(file: string) {
      if (visited.has(file) || compositions.has(path.basename(file))) return;
      visited.add(file);
      for (const dependency of imports(file)) {
        if (!dependency.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), dependency);
        const relative = path.relative(root, target);
        if (
          relative.includes("/pages/") &&
          !target.endsWith("/agentSessionPresentation")
        ) {
          expect.fail(
            `${path.relative(root, file)} imports routed-page state: ${dependency}`,
          );
        }
        if (target.endsWith("/agentSessionPresentation")) continue;
        const source = [
          target,
          `${target}.tsx`,
          `${target}.ts`,
          path.join(target, "index.ts"),
        ].find(
          (candidate) => existsSync(candidate) && /\.tsx?$/.test(candidate),
        );
        if (source) inspect(source);
      }
    }
    owners.forEach((owner) => inspect(path.join(root, owner)));
  });
  it("mounts the shared host outside route-derived project keys", () => {
    const file = path.join(root, "apps/ui/src/App.tsx");
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let hosts = 0;
    function visit(node: ts.Node, keyed: boolean) {
      if (ts.isJsxElement(node))
        keyed ||= node.openingElement.attributes.properties.some(
          (property) =>
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === "key",
        );
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(source) === "HeyHeyModal"
      ) {
        hosts++;
        expect(keyed).toBe(false);
      }
      ts.forEachChild(node, (child) => visit(child, keyed));
    }
    visit(source, false);
    expect(hosts).toBe(1);
  });
  it("allows only the application renderer to construct eligible boundaries in production", () => {
    const sources = [
      ...files(path.join(root, "apps/ui/src")),
      ...files(path.join(root, "packages/ui-common/src")),
    ];
    const allowed = new Set([
      "apps/ui/src/components/HeyHeyModal.tsx",
      "packages/ui-common/src/components/Modals/FunctionalDialog.tsx",
      "packages/ui-common/src/components/Modals/useModalPresentation.ts",
    ]);
    for (const file of sources) {
      if (file.includes("/test/")) continue;
      const content = readFileSync(file, "utf8");
      if (
        content.includes("<HostedModalBoundary") ||
        imports(file).some((value) => value.endsWith("/HostedModalBoundary"))
      ) {
        expect(
          allowed.has(path.relative(root, file)),
          path.relative(root, file),
        ).toBe(true);
      }
    }
  });
});
