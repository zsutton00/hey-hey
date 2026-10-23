import { Global, css } from "@emotion/react";
import type { FC } from "react";

/**
 * Global styles that apply shared typography and resets used by Hey UI.
 *
 * Consumers can render this component at the root of their application
 * when they want Hey's recommended base styles without relying on global CSS files.
 */
export const GlobalStyles: FC = () => (
  <Global
    styles={css`
      @import url("https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap");

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      html,
      body,
      #root {
        min-height: 100%;
      }

      body {
        margin: 0;
        font-family: "Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, "Segoe UI",
          "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans",
          "Helvetica Neue", sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        background-color: #f9fafb;
        color: #1f2937;
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      button,
      input,
      textarea,
      select {
        font-family: inherit;
      }
    `}
  />
);
