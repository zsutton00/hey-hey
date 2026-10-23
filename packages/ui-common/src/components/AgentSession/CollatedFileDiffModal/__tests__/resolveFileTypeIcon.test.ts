import { describe, expect, it } from "vitest";
import {
  DiCss3,
  DiGo,
  DiHtml5,
  DiJava,
  DiJavascript1,
  DiMarkdown,
  DiPython,
  DiRuby,
  DiRust,
  DiSass,
} from "react-icons/di";
import { SiGnubash, SiJson, SiTypescript, SiYaml } from "react-icons/si";
import { FaFileAlt, FaLock } from "react-icons/fa";
import { resolveFileTypeIcon } from "../resolveFileTypeIcon";

describe("resolveFileTypeIcon", () => {
  it("returns the TypeScript icon for TypeScript files", () => {
    expect(resolveFileTypeIcon("src/index.ts").Icon).toBe(SiTypescript);
    expect(resolveFileTypeIcon("src/Component.tsx").Icon).toBe(SiTypescript);
  });

  it("returns the JavaScript icon for JavaScript files", () => {
    expect(resolveFileTypeIcon("scripts/build.js").Icon).toBe(DiJavascript1);
    expect(resolveFileTypeIcon("scripts/Component.jsx").Icon).toBe(
      DiJavascript1,
    );
  });

  it("returns the Python icon for Python files", () => {
    expect(resolveFileTypeIcon("scripts/run.py").Icon).toBe(DiPython);
  });

  it("returns the Rust icon for Rust files", () => {
    expect(resolveFileTypeIcon("src/main.rs").Icon).toBe(DiRust);
  });

  it("returns the Go icon for Go files", () => {
    expect(resolveFileTypeIcon("cmd/server/main.go").Icon).toBe(DiGo);
  });

  it("returns the Ruby icon for Ruby files", () => {
    expect(resolveFileTypeIcon("app/models/user.rb").Icon).toBe(DiRuby);
  });

  it("returns the Java icon for Java files", () => {
    expect(resolveFileTypeIcon("src/Main.java").Icon).toBe(DiJava);
  });

  it("returns the HTML icon for HTML files", () => {
    expect(resolveFileTypeIcon("public/index.html").Icon).toBe(DiHtml5);
  });

  it("returns the Shell icon for shell scripts", () => {
    expect(resolveFileTypeIcon("scripts/run.sh").Icon).toBe(SiGnubash);
  });

  it("returns the Markdown icon for Markdown documents", () => {
    expect(resolveFileTypeIcon("docs/README.md").Icon).toBe(DiMarkdown);
  });

  it("returns the JSON icon for JSON files", () => {
    expect(resolveFileTypeIcon("config/data.json").Icon).toBe(SiJson);
  });

  it("returns the YAML icon for YAML files", () => {
    expect(resolveFileTypeIcon("config/app.yaml").Icon).toBe(SiYaml);
    expect(resolveFileTypeIcon("config/app.yml").Icon).toBe(SiYaml);
  });

  it("returns CSS/SCSS icons for stylesheets", () => {
    expect(resolveFileTypeIcon("ui/styles.css").Icon).toBe(DiCss3);
    expect(resolveFileTypeIcon("ui/styles.scss").Icon).toBe(DiSass);
  });

  it("returns the Lock icon for known lockfiles", () => {
    expect(resolveFileTypeIcon("pnpm-lock.yaml").Icon).toBe(FaLock);
    expect(resolveFileTypeIcon("repo/pnpm-lock.yaml").Icon).toBe(FaLock);
    expect(resolveFileTypeIcon("repo/package-lock.json").Icon).toBe(FaLock);
    expect(resolveFileTypeIcon("repo/yarn.lock").Icon).toBe(FaLock);
  });

  it("falls back to the generic file icon for unknown extensions and extensionless files", () => {
    expect(resolveFileTypeIcon("Dockerfile").Icon).toBe(FaFileAlt);
    expect(resolveFileTypeIcon("assets/banner.png").Icon).toBe(FaFileAlt);
  });

  describe("test files keep their file-type icon and drop the highlight color", () => {
    it("renders *.test.ts with the TypeScript icon and no color override", () => {
      const resolved = resolveFileTypeIcon("src/foo.test.ts");
      expect(resolved.Icon).toBe(SiTypescript);
      expect(resolved.color).toBeUndefined();
    });

    it("renders *.test.tsx with the TypeScript icon and no color override", () => {
      const resolved = resolveFileTypeIcon("src/Component.test.tsx");
      expect(resolved.Icon).toBe(SiTypescript);
      expect(resolved.color).toBeUndefined();
    });

    it("renders *.spec.tsx with the TypeScript icon and no color override", () => {
      const resolved = resolveFileTypeIcon("src/foo.spec.tsx");
      expect(resolved.Icon).toBe(SiTypescript);
      expect(resolved.color).toBeUndefined();
    });

    it("keeps the underlying file-type icon for files under __tests__/ and drops the color override", () => {
      const ts = resolveFileTypeIcon("src/__tests__/helpers.ts");
      expect(ts.Icon).toBe(SiTypescript);
      expect(ts.color).toBeUndefined();

      const json = resolveFileTypeIcon("src/__tests__/fixture.json");
      expect(json.Icon).toBe(SiJson);
      expect(json.color).toBeUndefined();
    });

    it("keeps the underlying file-type icon for files under test/ and drops the color override", () => {
      const ts = resolveFileTypeIcon("test/integration.ts");
      expect(ts.Icon).toBe(SiTypescript);
      expect(ts.color).toBeUndefined();

      const json = resolveFileTypeIcon("packages/api/test/fixture.json");
      expect(json.Icon).toBe(SiJson);
      expect(json.color).toBeUndefined();
    });

    it("uses the default file icon with no color override when the extension is unknown", () => {
      const resolved = resolveFileTypeIcon("src/__tests__/Dockerfile");
      expect(resolved.Icon).toBe(FaFileAlt);
      expect(resolved.color).toBeUndefined();
    });
  });

  it("returns an aria-label suitable for assistive technology", () => {
    expect(resolveFileTypeIcon("src/index.ts").ariaLabel).toBe(
      "TypeScript file",
    );
    expect(resolveFileTypeIcon("src/foo.test.ts").ariaLabel).toBe(
      "TypeScript file",
    );
    expect(resolveFileTypeIcon("pnpm-lock.yaml").ariaLabel).toBe("Lockfile");
    expect(resolveFileTypeIcon("Dockerfile").ariaLabel).toBe("File");
  });

  describe("color field", () => {
    it("applies the blue color to non-test files", () => {
      expect(resolveFileTypeIcon("src/index.ts").color).toBe("heyhey.main");
      expect(resolveFileTypeIcon("docs/README.md").color).toBe("heyhey.main");
      expect(resolveFileTypeIcon("pnpm-lock.yaml").color).toBe("heyhey.main");
      expect(resolveFileTypeIcon("Dockerfile").color).toBe("heyhey.main");
    });
  });
});
