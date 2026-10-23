import React from "react";
import type { HighlightedToken } from "../../../utils";
import type { DiffTokenColorMap } from "./diffTokenColors";

export interface HighlightedTokensProps {
  tokens: HighlightedToken[];
  colors: DiffTokenColorMap;
}

/**
 * Render a flat list of Prism tokens as bare inline `<span>`s. No block
 * wrapper or display change — the parent code cell drives wrap behavior
 * (`whiteSpace: pre-wrap`, `overflowWrap: anywhere`, `maxWidth: 80ch`), and
 * each span only contributes a color. Tokens whose type is not in the
 * palette inherit the cell's color.
 */
export const HighlightedTokens: React.FC<HighlightedTokensProps> = ({
  tokens,
  colors,
}) => (
  <>
    {tokens.map((token, idx) => {
      const color = colors[token.type];
      return (
        <span key={idx} style={color !== undefined ? { color } : undefined}>
          {token.text}
        </span>
      );
    })}
  </>
);
