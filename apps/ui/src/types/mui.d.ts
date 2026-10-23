// Extend MUI theme to include custom palette colors
// This must be declared in the consuming app, not just in ui-common
// See: https://github.com/mui/material-ui/issues/33440

declare module "@mui/material/styles" {
  interface Palette {
    attention: Palette["primary"];
    actionable: Palette["primary"];
    interactive: Palette["primary"];
    heyhey: Palette["primary"];
    warning: Palette["primary"];
  }

  interface PaletteOptions {
    attention?: PaletteOptions["primary"];
    actionable?: PaletteOptions["primary"];
    interactive?: PaletteOptions["primary"];
    heyhey?: PaletteOptions["primary"];
    warning?: PaletteOptions["primary"];
  }
}

declare module "@mui/material/Paper" {
  interface PaperPropsVariantOverrides {
    banner: true;
  }
}

declare module "@mui/material/Button" {
  interface ButtonPropsColorOverrides {
    attention: true;
    actionable: true;
    interactive: true;
    heyhey: true;
  }
}

export {};
