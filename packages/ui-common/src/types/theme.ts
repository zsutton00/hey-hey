export type DiagramGroupColorPalette = Record<
  import("../api").DiagramGroupColor,
  string
>;

export const DIAGRAM_GROUP_THEME_COLORS = {
  light: {
    blue: "#1565c0",
    green: "#2e7d32",
    orange: "#b45309",
    purple: "#7b1fa2",
    red: "#c62828",
    teal: "#00796b",
  },
  dark: {
    blue: "#90caf9",
    green: "#81c784",
    orange: "#ffb74d",
    purple: "#ce93d8",
    red: "#ef9a9a",
    teal: "#80cbc4",
  },
} satisfies Record<"light" | "dark", DiagramGroupColorPalette>;
