import React from "react";
import whyDidYouRender from "@welldone-software/why-did-you-render";

if (import.meta.env.DEV) {
  whyDidYouRender(React, {
    // Only track components with .whyDidYouRender = true
    trackAllPureComponents: true,

    // Disable hook tracking to reduce noise
    trackHooks: false,

    // Log when components re-render with the same props
    logOnDifferentValues: false,

    // Collapse groups in console for cleaner output
    collapseGroups: true,

    // Only include components that explicitly opt-in
    // include: [/^InitiativeEditor$/, /^CollaborationPlugin$/],

    // Exclude MUI and React internals
    exclude: [
      /^Unknown$/,
      /^Insertion\d+$/,
      /^Popper\d*$/,
      /^Modal\d*$/,
      /^Backdrop\d*$/,
      /^Fade\d*$/,
      /^Portal$/,
      /^BrowserRouter/,
      /^Link/,
      /^Route/,
      /^ThemeProvider/,
      /^CssBaseline/,
      /^Box/,
      /^Stack/,
      /^Grid/,
      /^Paper/,
      /^Typography/,
      /^Button/,
      /^IconButton/,
      /^Tooltip/,
      /^Menu/,
      /^MenuItem/,
      /^Dialog/,
      /^Drawer/,
      /^Alert/,
      /^Chip/,
    ],

    // Custom notifier with better formatting
    notifier: (notifierInfo) => {
      // Skip React internals
      if (notifierInfo.displayName?.startsWith("React.")) return;

      // Skip MUI internals
      if (
        notifierInfo.displayName?.match(
          /^(Unknown|Insertion\d+|Popper\d*|Modal\d*|Backdrop\d*|Fade\d*)$/
        )
      )
        return;

      // Skip hook-only notifications
      if (notifierInfo.hookName && !notifierInfo.displayName) return;

      // Log with better formatting
      console.group(
        `%c[WDYR] ${notifierInfo.displayName} re-rendered`,
        "color: #ff6b6b; font-weight: bold;"
      );

      if (notifierInfo.reason) {
        console.log("Reason:", notifierInfo.reason);
      }

      console.log("Full info:", notifierInfo);
      console.groupEnd();
    },
  });
}
