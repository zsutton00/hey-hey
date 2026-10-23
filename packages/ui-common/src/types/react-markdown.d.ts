declare module "react-markdown" {
  import type { ComponentType, HTMLAttributes, ReactNode } from "react";

  export type UrlTransform = (
    url: string,
    key: string,
    node: Readonly<Element>
  ) => string | null | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Components = Record<string, ComponentType<any>>;

  export interface ReactMarkdownProps extends HTMLAttributes<HTMLDivElement> {
    children?: ReactNode;
    components?: Components;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    remarkPlugins?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rehypePlugins?: any[];
    urlTransform?: UrlTransform;
  }

  const ReactMarkdown: ComponentType<ReactMarkdownProps>;

  export const defaultUrlTransform: (value: string) => string;
  export default ReactMarkdown;
}
