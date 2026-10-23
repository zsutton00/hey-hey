import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  HtmlCssSectionRenderer,
  validateHtmlCssRevisionLaunch,
} from "../HtmlCssSectionRenderer";

const usersMock = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: usersMock.data }),
}));

const definition = {
  key: "preview",
  label: "Preview",
  kind: "html/css" as const,
  defaultSizeKey: "panel",
  sizeProfiles: [
    {
      key: "panel",
      label: "Panel",
      breakpoints: [
        {
          minContainerWidth: 0,
          inline: { width: 320, height: 200 },
          page: { width: 800, height: 600 },
        },
      ],
    },
  ],
};

const revisionElementMetadata = {
  nodeId: "save",
  tag: "button",
  textExcerpt: "Save",
  x: 0.5,
  y: 0.5,
  outerHtmlExcerpt: '<button data-hh-id="save">Save</button>',
  bounds: { x: 10, y: 20, width: 80, height: 32 },
};

describe("HtmlCssSectionRenderer", () => {
  it("exposes deterministic revision launch validation", () => {
    const annotation = {
      id: "10000000-0000-4000-8000-000000000001",
      note: "Increase contrast.",
      author: {
        type: "human" as const,
        userId: "10000000-0000-4000-8000-000000000002",
      },
      category: "suggestion" as const,
      lifecycle: "open" as const,
      authoredProposalId: "20000000-0000-4000-8000-000000000001",
      authoredSizeKey: "panel",
      target: { type: "element" as const, nodeId: "save" },
    };
    const base = {
      materializedProposalId: "20000000-0000-4000-8000-000000000001",
      renderedSize: { width: 800, height: 600 },
      annotations: [annotation],
      elementsByNodeId: new Map(),
    };

    expect(validateHtmlCssRevisionLaunch(base)).toEqual({
      canLaunch: false,
      blocker: "missing-element-context",
      missingNodeIds: ["save"],
    });
    expect(
      validateHtmlCssRevisionLaunch({
        ...base,
        elementsByNodeId: new Map([["save", revisionElementMetadata]]),
      })
    ).toEqual({ canLaunch: true, blocker: null, missingNodeIds: [] });
    expect(
      validateHtmlCssRevisionLaunch({
        ...base,
        annotations: [
          {
            ...annotation,
            target: {
              type: "position",
              x: 0.5,
              y: 0.5,
              sizeKey: "panel",
            },
          },
        ],
      })
    ).toEqual({ canLaunch: true, blocker: null, missingNodeIds: [] });
    expect(
      validateHtmlCssRevisionLaunch({
        ...base,
        materializedProposalId: undefined,
      }).blocker
    ).toBe("missing-provenance");
    expect(
      validateHtmlCssRevisionLaunch({ ...base, renderedSize: null }).blocker
    ).toBe("missing-resolved-size");
    expect(
      validateHtmlCssRevisionLaunch({ ...base, annotations: [] }).blocker
    ).toBe("no-selected-annotations");
  });
  it("defaults to a modern style and switches to the shared sketch theme", async () => {
    const user = userEvent.setup();
    render(
      <HtmlCssSectionRenderer
        definition={definition}
        context="inline"
        content={{
          html: '<script>window.top.__escaped=true</script><meta http-equiv="refresh" content="0;url=https://example.com/refresh"><main class="workspace"><h1>Sketch</h1><div class="panel"><a href="https://example.com/link" target="_top">Leave</a><label class="drop-zone"><span class="button">Browse</span></label><button formaction="https://example.com/button">Go</button><input value="Idea"><div class="tabs"><div class="tab" aria-selected="true">Notes</div></div><hr></div></main><img src="https://example.com/x.png" srcset="https://example.com/2x.png 2x"><form action="https://example.com"></form><iframe srcdoc="<a href=https://example.com>nested</a>"></iframe>',
          css: ":root { font-family: Inter, sans-serif; } body { color: rebeccapurple; background: white; } .workspace, .panel, .drop-zone, .button, textarea { border: 1px solid blue; border-radius: 20px; background: white; box-shadow: 0 24px 70px black; }</style><script>window.top.__styleEscaped=true</script>",
        }}
      />
    );

    const frame = screen.getByTitle("HTML/CSS mockup preview");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    const modernDocument = frame.getAttribute("srcdoc") ?? "";
    expect(screen.getByTestId("html-css-section-style-modern")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(modernDocument).toContain('data-host-theme="modern"');
    expect(modernDocument).toContain("Inter, ui-sans-serif, system-ui");
    expect(modernDocument).not.toContain("text-decoration-style: wavy");
    expect(modernDocument.indexOf("data-host-theme")).toBeLessThan(
      modernDocument.indexOf("data-authored-css")
    );

    await user.click(screen.getByTestId("html-css-section-style-sketch"));

    expect(frame).toHaveAttribute(
      "srcdoc",
      expect.stringContaining('data-host-theme="sketch"')
    );
    expect(screen.getByTestId("html-css-section-style-sketch")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const document = frame.getAttribute("srcdoc") ?? "";
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("script-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document.indexOf("data-host-theme")).toBeLessThan(
      document.indexOf("data-authored-css")
    );
    expect(document).toContain("@font-face");
    expect(document).toContain("text-decoration-style: wavy");
    expect(document).toContain("cursive !important");
    expect(document).toContain(".button, button, input, textarea, select");
    expect(document).toContain(".card, .panel, .drop-zone, [data-sketch-card]");
    expect(document).toContain(".workspace {");
    expect(document).toContain("border: 1.5px solid #46423a !important");
    expect(document).toContain(
      "border-radius: 130px 13px 116px 12px / 12px 116px 13px 130px"
    );
    expect(document).toContain(
      "border-radius: 65px 13px 58px 14px / 12px 57px 15px 61px"
    );
    expect(document).toContain("border-radius: 46px 12px 0 0 / 11px 41px 0 0");
    expect(document).toContain("box-shadow: 1px 2px 0 #777064");
    expect(document).toContain(".card, .panel, .drop-zone, [data-sketch-card]");
    expect(document).toContain(".tabs, [data-sketch-tabs]");
    expect(document).toContain('.tab[aria-selected="true"]');
    expect(document).toContain("hr, .separator, [data-sketch-separator]");
    expect(document).toContain("background: #f3efe4");
    expect(document).toContain(
      "body { color: rebeccapurple; background: white; }"
    );
    expect(document).toContain(
      "<\\/style><script>window.top.__styleEscaped=true</script>"
    );
    expect(
      document.indexOf("body { color: rebeccapurple; background: white; }")
    ).toBeGreaterThan(document.indexOf("data-host-theme"));
    expect(document.match(/<style/g)).toHaveLength(2);
    expect(document).toContain(">Leave</a>");
    expect(document).not.toContain("window.top.__escaped");
    expect(document).not.toContain('http-equiv="refresh"');
    expect(document).not.toContain("https://example.com");
    expect(document).not.toContain("href=");
    expect(document).not.toContain("src=");
    expect(document).not.toContain("srcset=");
    expect(document).not.toContain("action=");
    expect(document).not.toContain("formaction=");
    expect(document).not.toContain("target=");
    expect(document).not.toContain("<iframe");
  });

  it("fails closed for malformed content", () => {
    render(
      <HtmlCssSectionRenderer
        definition={definition}
        context="inline"
        content={{ html: "<p>missing css</p>" }}
      />
    );
    expect(
      screen.queryByTitle("HTML/CSS mockup preview")
    ).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be rendered/i)).toBeInTheDocument();
  });

  it("renders review chrome outside srcdoc without serializing annotations", () => {
    usersMock.data = [
      {
        userId: "10000000-0000-4000-8000-000000000002",
        user: { name: "Zac" },
      },
    ];
    render(
      <HtmlCssSectionRenderer
        definition={definition}
        context="inline"
        organizationId="organization-1"
        materializedProposalId="20000000-0000-4000-8000-000000000001"
        onCreateAnnotation={vi.fn()}
        onAnnotationLifecycleChange={vi.fn()}
        content={{
          html: "<main>Preview</main>",
          css: "",
          sizeKey: "panel",
          annotations: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              note: "Move this up.",
              author: {
                type: "human",
                userId: "10000000-0000-4000-8000-000000000002",
              },
              category: "suggestion",
              lifecycle: "open",
              authoredProposalId: "20000000-0000-4000-8000-000000000001",
              authoredSizeKey: "panel",
              target: {
                type: "position",
                x: 0.4,
                y: 0.6,
                sizeKey: "panel",
              },
            },
          ],
        }}
      />
    );

    expect(screen.getByTestId("html-css-annotation-pin")).toBeInTheDocument();
    expect(screen.getByTestId("html-css-annotation-layer")).toBeInTheDocument();
    const controls = screen.getByTestId("html-css-section-controls");
    expect(
      within(controls).getByTestId("html-css-annotation-toolbar")
    ).toBeInTheDocument();
    expect(
      within(controls).getByTestId("html-css-section-style-controls")
    ).toBeInTheDocument();
    fireEvent.click(within(controls).getByRole("button", { name: "Expanded" }));
    expect(screen.getByText("Zac")).toBeInTheDocument();
    const srcDoc =
      screen.getByTitle("HTML/CSS mockup preview").getAttribute("srcdoc") ?? "";
    expect(srcDoc).not.toContain("Move this up.");
    expect(srcDoc).not.toContain("html-css-annotation");
  });

  it("accepts authenticated iframe review messages and forwards exact element identity", () => {
    const onCreateAnnotation = vi.fn();
    render(
      <HtmlCssSectionRenderer
        definition={definition}
        context="inline"
        materializedProposalId="20000000-0000-4000-8000-000000000001"
        onCreateAnnotation={onCreateAnnotation}
        content={{
          html: '<main data-hh-id="hero"><script>window.top.bad=true</script>Welcome <span>home</span></main><p>Ordinary</p>',
          css: "main { color: navy; }",
          sizeKey: "panel",
        }}
      />
    );

    const frame = screen.getByTitle("HTML/CSS mockup preview");
    const ordinaryDocument = frame.getAttribute("srcdoc");
    expect(frame).toHaveAttribute("sandbox", "");

    fireEvent.click(screen.getByRole("button", { name: "Add element note" }));

    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    const reviewDocument = frame.getAttribute("srcdoc") ?? "";
    expect(reviewDocument).toContain("script-src 'nonce-");
    expect(reviewDocument).toContain("data-host-review");
    expect(reviewDocument).not.toContain("window.top.bad");
    expect(reviewDocument).not.toContain("allow-same-origin");
    const channelToken =
      reviewDocument.match(/var channelToken = &quot;([^&]+)&quot;/)?.[1] ??
      reviewDocument.match(/var channelToken = "([^"]+)"/)?.[1];
    expect(channelToken).toBeTruthy();
    const validMessage = {
      type: "hey-hey:html-css-review-bridge",
      channelToken,
      interaction: "select",
      element: {
        nodeId: "hero",
        tag: "main",
        textExcerpt: "Welcome home",
        x: 0.4,
        y: 0.3,
        outerHtmlExcerpt:
          '<main data-hh-id="hero">Welcome <span>home</span></main>',
        bounds: { x: 10, y: 20, width: 100, height: 40 },
      },
    };

    fireEvent(
      window,
      new MessageEvent("message", {
        source: window,
        data: validMessage,
      })
    );
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: { ...validMessage, channelToken: "wrong" },
      })
    );
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: { ...validMessage, element: { ...validMessage.element, x: 2 } },
      })
    );
    expect(onCreateAnnotation).not.toHaveBeenCalled();

    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: validMessage,
      })
    );

    expect(onCreateAnnotation).toHaveBeenCalledWith({
      type: "element",
      nodeId: "hero",
    });
    expect(
      screen.getByTestId("html-css-review-element-summary")
    ).toHaveTextContent("Selected <main> — Welcome home");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toBe(ordinaryDocument);
  });

  it("reports validated hover metadata outside the opaque iframe", () => {
    render(
      <HtmlCssSectionRenderer
        definition={definition}
        context="inline"
        materializedProposalId="20000000-0000-4000-8000-000000000001"
        onCreateAnnotation={vi.fn()}
        content={{ html: '<button data-hh-id="save">Save</button>', css: "" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add element note" }));
    const frame = screen.getByTitle("HTML/CSS mockup preview");
    const reviewDocument = frame.getAttribute("srcdoc") ?? "";
    const channelToken = reviewDocument.match(
      /var channelToken = "([^"]+)"/
    )?.[1];
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          type: "hey-hey:html-css-review-bridge",
          channelToken,
          interaction: "hover",
          element: {
            nodeId: "save",
            tag: "button",
            textExcerpt: "Save",
            x: 0.5,
            y: 0.5,
            outerHtmlExcerpt: '<button data-hh-id="save">Save</button>',
            bounds: { x: 10, y: 20, width: 80, height: 32 },
          },
        },
      })
    );
    expect(
      screen.getByTestId("html-css-review-element-summary")
    ).toHaveTextContent("Hovered <button> — Save");
  });

  it("sends only selected current notes with rendered element context", () => {
    const onRequestRevision = vi.fn();
    render(
      <HtmlCssSectionRenderer
        definition={definition}
        context="inline"
        materializedProposalId="20000000-0000-4000-8000-000000000001"
        onCreateAnnotation={vi.fn()}
        onAnnotationLifecycleChange={vi.fn()}
        onRequestRevision={onRequestRevision}
        content={{
          html: '<button data-hh-id="save">Save</button>',
          css: "button { color: navy; }",
          sizeKey: "panel",
          annotations: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              note: "Increase contrast.",
              author: {
                type: "human",
                userId: "10000000-0000-4000-8000-000000000002",
              },
              category: "suggestion",
              lifecycle: "open",
              authoredProposalId: "20000000-0000-4000-8000-000000000001",
              authoredSizeKey: "panel",
              target: { type: "element", nodeId: "save" },
            },
          ],
        }}
      />
    );
    const frame = screen.getByTitle("HTML/CSS mockup preview");
    const reviewDocument = frame.getAttribute("srcdoc") ?? "";
    const channelToken = reviewDocument.match(
      /var channelToken = "([^"]+)"/
    )?.[1];
    fireEvent.click(screen.getByRole("button", { name: "Expanded" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select annotation 1" })
    );

    expect(screen.getByTestId("html-css-request-revision")).toBeDisabled();
    expect(
      screen.getByTestId("html-css-revision-validation")
    ).toHaveTextContent("Waiting for rendered context for: save");

    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          type: "hey-hey:html-css-review-bridge",
          channelToken,
          interaction: "snapshot",
          elements: [revisionElementMetadata],
        },
      })
    );

    expect(screen.getByTestId("html-css-request-revision")).toBeEnabled();
    expect(
      screen.queryByTestId("html-css-revision-validation")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("html-css-request-revision"));

    expect(onRequestRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "preview",
        sizeKey: "panel",
        materializedProposalId: "20000000-0000-4000-8000-000000000001",
        annotations: [expect.objectContaining({ note: "Increase contrast." })],
        elementsByNodeId: expect.any(Map),
      })
    );
  });

  it.each(["inline", "page"] as const)(
    "keeps element annotations aligned before and after iframe scrolling in %s previews",
    (context) => {
      render(
        <HtmlCssSectionRenderer
          definition={definition}
          context={context}
          materializedProposalId="20000000-0000-4000-8000-000000000001"
          onCreateAnnotation={vi.fn()}
          content={{
            html: '<section data-hh-id="hero">Hero</section>',
            css: "",
            sizeKey: "panel",
            annotations: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                note: "Keep this aligned.",
                author: {
                  type: "human",
                  userId: "10000000-0000-4000-8000-000000000002",
                },
                category: "suggestion",
                lifecycle: "open",
                authoredProposalId: "20000000-0000-4000-8000-000000000001",
                authoredSizeKey: "panel",
                target: { type: "element", nodeId: "hero" },
              },
            ],
          }}
        />
      );

      const frame = screen.getByTitle("HTML/CSS mockup preview");
      const reviewDocument = frame.getAttribute("srcdoc") ?? "";
      const channelToken =
        reviewDocument.match(/var channelToken = &quot;([^&]+)&quot;/)?.[1] ??
        reviewDocument.match(/var channelToken = "([^"]+)"/)?.[1];
      const viewport =
        context === "inline"
          ? {
              scrollX: 0,
              scrollY: 0,
              viewportWidth: 320,
              viewportHeight: 200,
              documentWidth: 320,
              documentHeight: 1000,
            }
          : {
              scrollX: 0,
              scrollY: 0,
              viewportWidth: 800,
              viewportHeight: 600,
              documentWidth: 800,
              documentHeight: 1400,
            };
      const element = {
        nodeId: "hero",
        tag: "section",
        textExcerpt: "Hero",
        x: 0.5,
        y: 0.7,
        outerHtmlExcerpt: '<section data-hh-id="hero">Hero</section>',
        bounds: {
          x: viewport.viewportWidth * 0.25,
          y: viewport.viewportHeight * 0.6,
          width: 80,
          height: 40,
        },
      };

      fireEvent(
        window,
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: "hey-hey:html-css-review-bridge",
            channelToken,
            interaction: "viewport",
            viewport,
          },
        })
      );
      fireEvent(
        window,
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: "hey-hey:html-css-review-bridge",
            channelToken,
            interaction: "snapshot",
            elements: [element],
          },
        })
      );

      const pin = screen.getByTestId("html-css-annotation-pin");
      expect(pin).toHaveStyle({
        left: `${
          ((viewport.viewportWidth * 0.25 + 40) / viewport.viewportWidth) * 100
        }%`,
        top: `${
          ((viewport.viewportHeight * 0.6 + 20) / viewport.viewportHeight) * 100
        }%`,
      });

      fireEvent(
        window,
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: "hey-hey:html-css-review-bridge",
            channelToken,
            interaction: "viewport",
            viewport: { ...viewport, scrollY: viewport.viewportHeight * 0.4 },
          },
        })
      );

      expect(pin).toHaveStyle({
        left: `${
          ((viewport.viewportWidth * 0.25 + 40) / viewport.viewportWidth) * 100
        }%`,
        top: `${
          ((viewport.viewportHeight * 0.2 + 20) / viewport.viewportHeight) * 100
        }%`,
      });

      fireEvent(
        window,
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: "hey-hey:html-css-review-bridge",
            channelToken,
            interaction: "hover",
            element: {
              nodeId: "other",
              tag: "aside",
              textExcerpt: "Other",
              x: 0.5,
              y: 0.2,
              outerHtmlExcerpt: '<aside data-hh-id="other">Other</aside>',
              bounds: { x: 20, y: 40, width: 40, height: 20 },
            },
          },
        })
      );

      expect(pin).toHaveStyle({
        top: `${
          ((viewport.viewportHeight * 0.2 + 20) / viewport.viewportHeight) *
          100
        }%`,
      });
    }
  );
});
