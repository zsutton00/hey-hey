import {
  createElement,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from "react";

type UrlTransform = (
  url: string,
  key: string,
  node: unknown
) => string | null | undefined;

type AnchorProps = ComponentProps<"a"> & {
  node?: unknown;
};

type ImageProps = ComponentProps<"img"> & {
  node?: unknown;
};

type MarkdownComponents = {
  p?: ComponentType<{ children?: ReactNode; node?: unknown }>;
  a?: ComponentType<AnchorProps> | "a";
  img?: ComponentType<ImageProps> | "img";
};

const SAFE_PROTOCOL_PATTERN = /^(https?|ircs?|mailto|xmpp)$/i;

export const defaultUrlTransform = (value: string): string => {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_PROTOCOL_PATTERN.test(value.slice(0, colon))
  ) {
    return value;
  }

  return "";
};

const INLINE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g;

const renderInlineMarkdown = (
  children: ReactNode,
  components: MarkdownComponents | undefined,
  urlTransform: UrlTransform
): ReactNode => {
  if (typeof children !== "string") return children;

  const rendered: ReactNode[] = [];
  let cursor = 0;
  let linkIndex = 0;

  for (const match of children.matchAll(INLINE_PATTERN)) {
    const [source, imageAlt, imageDestination, linkLabel, linkDestination] =
      match;
    const start = match.index ?? 0;
    if (start > cursor) rendered.push(children.slice(cursor, start));

    if (imageAlt !== undefined && imageDestination !== undefined) {
      rendered.push(
        createElement(components?.img ?? "img", {
          key: `markdown-image-${linkIndex}`,
          alt: imageAlt,
          src: urlTransform(imageDestination, "src", {}) ?? "",
          node: {},
        })
      );
    } else {
      rendered.push(
        createElement(
          components?.a ?? "a",
          {
            key: `markdown-link-${linkIndex}`,
            href: urlTransform(linkDestination ?? "", "href", {}) ?? "",
            node: {},
          },
          linkLabel
        )
      );
    }
    linkIndex += 1;
    cursor = start + (source?.length ?? 0);
  }

  if (cursor === 0) return children;
  if (cursor < children.length) rendered.push(children.slice(cursor));
  return rendered;
};

export default function ReactMarkdown({
  children,
  components,
  urlTransform,
}: {
  children?: ReactNode;
  components?: MarkdownComponents;
  urlTransform?: UrlTransform;
}) {
  const renderedChildren = renderInlineMarkdown(
    children,
    components,
    urlTransform ?? defaultUrlTransform
  );

  if (components?.p) {
    return createElement(components.p, { node: undefined }, renderedChildren);
  }

  return createElement("span", null, renderedChildren);
}
