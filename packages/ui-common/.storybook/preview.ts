import React from "react";
import type { Preview } from "@storybook/react";
import {
  StoryProviders,
  readQueryDataFromStoryContext,
} from "./StoryProviders";

// HeyThemeProvider falls back to `prefers-color-scheme` when no `themeMode` is
// stored, which would render stories in dark mode against Storybook's white
// chrome on dark-mode OS users. Pin Storybook to light for a deterministic
// preview that matches the chrome.
if (typeof window !== "undefined") {
  window.localStorage.setItem("themeMode", "light");
}

const preview: Preview = {
  decorators: [
    (Story, context) =>
      React.createElement(
        StoryProviders,
        { queryData: readQueryDataFromStoryContext(context) },
        React.createElement(Story)
      ),
  ],
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#1a1a1a" },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
