import { createTheme } from "@mui/material/styles";

// The document canvas owns its palette in both the editor and static preview.
export const structuredMockupTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#554b83" },
    text: { primary: "#302e2a", secondary: "#6d665b" },
    background: { default: "#f3efe4", paper: "#fffdf8" },
    divider: "#c7c0b2",
  },
  typography: {
    fontFamily: '"Comic Sans MS", "Chalkboard SE", cursive',
    button: { textTransform: "none", fontWeight: 700 },
  },
  shape: { borderRadius: 10 },
});
