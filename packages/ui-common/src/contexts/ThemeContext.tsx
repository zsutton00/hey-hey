import React, { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  createTheme,
  ThemeProvider as MuiThemeProvider,
} from "@mui/material/styles";
import type { ThemeOptions } from "@mui/material/styles";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  DIAGRAM_GROUP_THEME_COLORS,
  type DiagramGroupColorPalette,
} from "../types/theme";

// Extend the palette interface to include custom colors
declare module "@mui/material/styles" {
  interface Palette {
    diagramGroups: DiagramGroupColorPalette;
    attention: Palette["primary"];
    actionable: Palette["primary"];
    interactive: Palette["primary"];
    heyhey: Palette["primary"];
    task: Palette["primary"];
    feature: Palette["primary"];
    coding: Palette["primary"];
    capsulePage: Palette["primary"];
    service: Palette["primary"];
    plan: Palette["primary"];
    message: Palette["primary"];
    report: Palette["primary"];
    ready: Palette["primary"];
    warning: Palette["primary"];
    active: Palette["primary"];
  }

  interface PaletteOptions {
    diagramGroups?: DiagramGroupColorPalette;
    attention?: PaletteOptions["primary"];
    actionable?: PaletteOptions["primary"];
    interactive?: PaletteOptions["primary"];
    heyhey?: PaletteOptions["primary"];
    task?: PaletteOptions["primary"];
    feature?: PaletteOptions["primary"];
    coding?: PaletteOptions["primary"];
    capsulePage?: PaletteOptions["primary"];
    service?: PaletteOptions["primary"];
    plan?: PaletteOptions["primary"];
    message?: PaletteOptions["primary"];
    report?: PaletteOptions["primary"];
    ready?: PaletteOptions["primary"];
    warning?: PaletteOptions["primary"];
    active?: PaletteOptions["primary"];
  }
}

declare module "@mui/material/Paper" {
  interface PaperPropsVariantOverrides {
    banner: true;
  }
}

// Extend Button color options
declare module "@mui/material/Button" {
  interface ButtonPropsColorOverrides {
    attention: true;
    actionable: true;
    interactive: true;
    heyhey: true;
    task: true;
    feature: true;
    coding: true;
    service: true;
    plan: true;
    message: true;
  }
}

// Extend Chip color options
declare module "@mui/material/Chip" {
  interface ChipPropsColorOverrides {
    attention: true;
    actionable: true;
    interactive: true;
    heyhey: true;
    task: true;
    feature: true;
    coding: true;
    service: true;
    plan: true;
    message: true;
    ready: true;
    active: true;
  }
}

type ThemeMode = "light" | "dark";

interface ThemeContextType {
  mode: ThemeMode;
  toggleMode: () => void;
}

/**
 * Good colors?
 *
 * 5E807F
 * 9B8816
 * 140D4F
 * FF9770 !!!!!
 * 124E78
 */

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a HeyThemeProvider");
  }
  return context;
};

// Base theme configuration that works for both light and dark modes
export const createHeyTheme = (mode: ThemeMode) => {
  const isDark = mode === "dark";

  // Derive the responsive breakpoint query once from the default breakpoints so
  // the responsive typography can live in a single createTheme() call. Merging
  // into an already-built theme via createTheme(theme, ...) is dramatically more
  // expensive to type-check, so we avoid that two-call pattern.
  const mdDown = createTheme().breakpoints.down("md");

  const themeOptions: ThemeOptions = {
    cssVariables: true,
    palette: {
      diagramGroups: DIAGRAM_GROUP_THEME_COLORS[mode],
      mode,
      primary: {
        main: isDark ? "rgb(86, 150, 200)" : "rgb(60, 114, 160)",
        light: isDark ? "rgb(126, 182, 224)" : "rgb(100, 154, 200)",
        dark: isDark ? "rgb(60, 122, 172)" : "rgb(60, 114, 160)",
        contrastText: "#ffffff",
      },
      secondary: {
        main: isDark ? "#8488B8" : "#434666",
        light: isDark ? "#9C9FC8" : "#5A5D88",
        dark: isDark ? "#6B6FA0" : "#2C2E4A",
        contrastText: "#ffffff",
      },
      background: {
        default: isDark ? "#121212" : "#fafafa",
        paper: isDark ? "#1e1e1e" : "#ffffff",
      },
      text: {
        primary: isDark ? "#ffffff" : "#212121",
        secondary: isDark ? "#b0b0b0" : "#616161",
        disabled: isDark ? "#666666" : "#9e9e9e",
      },
      divider: isDark ? "#666" : "#eee",
      // Custom interactive colors
      attention: {
        main: isDark ? "#6B6FA0" : "#434666ff",
        light: isDark ? "#8488B8" : "#3F3F52",
        dark: isDark ? "#404040" : "#1A1A24",
        contrastText: "#ffffff",
      },
      actionable: {
        main: "rgb(60, 114, 160)",
        light: "rgb(100, 154, 200)",
        dark: "rgb(60, 114, 160)",
        contrastText: "#ffffff",
      },
      interactive: {
        main: "#EEF0F2",
        light: "#F5F7F9",
        dark: "#E7E9EB",
        contrastText: "rgb(80, 134, 180)",
      },
      heyhey: {
        main: "rgb(8, 126, 139)",
        light: "rgb(28, 146, 159)",
        dark: "rgb(0, 106, 119)",
        contrastText: "#ffffff",
      },
      task: {
        main: "#616168",
        light: "#616168",
        dark: "#616168",
        contrastText: "#ffffff",
      },
      feature: {
        main: "#5B7F83",
        light: "#7A9EA2",
        dark: "#476366",
        contrastText: "#ffffff",
      },
      coding: {
        main: "#A2D6F9",
        light: "#A2D6F9",
        dark: "#A2D6F9",
        contrastText: "#333",
      },
      capsulePage: {
        main: "#2563EB",
        light: "#2f64d8",
        dark: "#0c53ec",
        contrastText: "#ffffff",
      },
      service: {
        main: "rgb(80, 193, 244)",
        light: "rgb(80, 193, 244)",
        dark: "rgb(32, 79, 101)",
        contrastText: "#333",
      },
      plan: {
        main: "rgb(129, 113, 173)",
        light: "rgb(159, 139, 206)",
        dark: "rgb(104, 92, 138)",
        contrastText: "#ffffff",
      },
      message: {
        main: "#757575",
        light: "#9B9B9B",
        dark: "#5E5E5E",
        contrastText: "#ffffff",
      },
      report: {
        main: "#7A6E8A",
        light: "#958BA3",
        dark: "#5F5570",
        contrastText: "#ffffff",
      },
      ready: {
        main: "rgb(193, 236, 237)",
        light: "rgb(210, 243, 245)",
        dark: "rgb(150, 210, 215)",
        contrastText: "#1a1a1a",
      },
      warning: {
        main: "#E4A93A",
        light: "#FFF5D9",
        dark: "#C18A1F",
        contrastText: "#000000",
      },
      active: {
        main: "#FFB74D",
        light: "#FFCC80",
        dark: "#F57C00",
        contrastText: "#000000",
      },
      info: {
        main: "#6D7B85",
        light: "#EEF1F4",
        dark: "#4A545C",
        contrastText: "#ffffff",
      },
      success: {
        main: "#2F8F6A",
        light: "#b8cec7",
        dark: "#1F6047",
        contrastText: "#ffffff",
      },
      action: {
        hover: isDark
          ? "rgba(255, 255, 255, 0.08)"
          : "rgba(158, 158, 158, 0.04)",
        selected: isDark
          ? "rgba(255, 255, 255, 0.16)"
          : "rgba(158, 158, 158, 0.08)",
        disabled: isDark
          ? "rgba(255, 255, 255, 0.3)"
          : "rgba(158, 158, 158, 0.26)",
        disabledBackground: isDark
          ? "rgba(255, 255, 255, 0.12)"
          : "rgba(158, 158, 158, 0.12)",
      },
    },

    // Shape - rounded corners
    shape: {
      borderRadius: 12,
    },

    // Custom shadows
    shadows: [
      "none",
      isDark ? "0 1px 3px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.12)",
      isDark ? "0 2px 6px rgba(0,0,0,0.4)" : "0 2px 6px rgba(0,0,0,0.12)",
      isDark ? "0 4px 12px rgba(0,0,0,0.5)" : "0 4px 12px rgba(0,0,0,0.15)",
      isDark ? "0 6px 16px rgba(0,0,0,0.5)" : "0 6px 16px rgba(0,0,0,0.15)",
      isDark ? "0 8px 24px rgba(0,0,0,0.6)" : "0 8px 24px rgba(0,0,0,0.18)",
      isDark ? "0 12px 32px rgba(0,0,0,0.6)" : "0 12px 32px rgba(0,0,0,0.18)",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
    ] as [
      "none",
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string
    ],

    // Typography adjustments
    typography: {
      fontSize: 16,
      fontFamily:
        '"Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontFamily:
          '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
        fontWeight: 600,
        letterSpacing: "0.05em",
        [mdDown]: {
          fontSize: "1.75rem",
          lineHeight: 1.15,
        },
      },
      h2: {
        fontFamily:
          '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
        fontWeight: 600,
        letterSpacing: "0.05em",
        [mdDown]: {
          fontSize: "1.5rem",
          lineHeight: 1.2,
        },
      },
      h3: {
        fontWeight: 600,
        [mdDown]: {
          fontSize: "1.25rem",
          lineHeight: 1.25,
        },
      },
      h6: {
        [mdDown]: {
          fontSize: "0.9375rem",
          lineHeight: 1.3,
        },
      },
      body1: {
        // Let MUI handle colors automatically based on palette mode
      },
      body2: {
        // Let MUI handle colors automatically based on palette mode
      },
    },

    // Component customizations
    components: {
      // Card styling
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            border: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
            boxShadow: isDark
              ? "0 2px 8px rgba(0,0,0,0.4)"
              : "0 2px 8px rgba(0,0,0,0.12)",
          },
        },
      },

      // Button styling
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            textTransform: "uppercase",
            fontSize: "0.875rem",
            fontWeight: 600,
            letterSpacing: "0.025em",
            boxShadow: "none",
            "&:hover": {
              boxShadow: isDark
                ? "0 2px 8px rgba(0,0,0,0.4)"
                : "0 2px 8px rgba(0,0,0,0.12)",
            },
          },
          contained: {
            "&:hover": {
              boxShadow: isDark
                ? "0 4px 12px rgba(0,0,0,0.5)"
                : "0 4px 12px rgba(0,0,0,0.15)",
            },
          },
        },
      },

      // Paper component
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            border: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
            backgroundImage: isDark
              ? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))"
              : "none",
          },
          elevation1: {
            boxShadow: isDark
              ? "0 1px 4px rgba(0,0,0,0.4)"
              : "0 1px 4px rgba(0,0,0,0.12)",
          },
          elevation2: {
            boxShadow: isDark
              ? "0 2px 8px rgba(0,0,0,0.4)"
              : "0 2px 8px rgba(0,0,0,0.12)",
          },
          elevation3: {
            boxShadow: isDark
              ? "0 4px 12px rgba(0,0,0,0.5)"
              : "0 4px 12px rgba(0,0,0,0.15)",
          },
        },
        variants: [
          {
            props: { variant: "banner" },
            style: {
              padding: 32,
              marginBottom: 32,
              borderRadius: "4px",
              position: "relative",
              overflow: "hidden",
              backgroundColor: "rgba(11, 39, 69, 1)",
              color: "#ffffff",
              border: "none",
              boxShadow: "0 4px 12px rgba(9, 58, 82, 0.3)",
              // Pattern 1: Hexagonal pattern - very subtle with minimal overlap (ACTIVE)
              backgroundImage: `
                conic-gradient(from 0deg at 20% 20%,
                  rgba(255,255,255,0.02) 0deg, rgba(255,255,255,0.02) 60deg,
                  transparent 60deg, transparent 120deg,
                  rgba(255,255,255,0.02) 120deg, rgba(255,255,255,0.02) 180deg,
                  transparent 180deg, transparent 240deg,
                  rgba(255,255,255,0.02) 240deg, rgba(255,255,255,0.02) 300deg,
                  transparent 300deg, transparent 360deg
                ),
                conic-gradient(from 30deg at 80% 80%,
                  rgba(100,200,255,0.025) 0deg, rgba(100,200,255,0.025) 60deg,
                  transparent 60deg, transparent 120deg,
                  rgba(100,200,255,0.025) 120deg, rgba(100,200,255,0.025) 180deg,
                  transparent 180deg, transparent 240deg,
                  rgba(100,200,255,0.025) 240deg, rgba(100,200,255,0.025) 300deg,
                  transparent 300deg, transparent 360deg
                ),
                conic-gradient(from 60deg at 80% 20%,
                  rgba(255,255,255,0.015) 0deg, rgba(255,255,255,0.015) 60deg,
                  transparent 60deg, transparent 120deg,
                  rgba(255,255,255,0.015) 120deg, rgba(255,255,255,0.015) 180deg,
                  transparent 180deg, transparent 240deg,
                  rgba(255,255,255,0.015) 240deg, rgba(255,255,255,0.015) 300deg,
                  transparent 300deg, transparent 360deg
                )
              `,
              backgroundSize: "200px 200px, 180px 180px, 220px 220px",

              // Pattern 2: Scattered dots
              // backgroundImage: `
              //   radial-gradient(circle at 15% 25%, rgba(255,255,255,0.3) 2px, transparent 2px),
              //   radial-gradient(circle at 75% 15%, rgba(100,200,255,0.25) 1.5px, transparent 1.5px),
              //   radial-gradient(circle at 85% 75%, rgba(255,255,255,0.2) 2.5px, transparent 2.5px),
              //   radial-gradient(circle at 25% 85%, rgba(100,200,255,0.2) 1px, transparent 1px),
              //   radial-gradient(circle at 45% 45%, rgba(255,255,255,0.15) 1.5px, transparent 1.5px)
              // `,
              // backgroundSize:
              //   "300px 300px, 250px 250px, 280px 280px, 320px 320px, 200px 200px",

              // Pattern 3: Diagonal waves
              // backgroundImage: `
              //   linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.015) 42%, rgba(255,255,255,0.015) 44%, transparent 46%),
              //   linear-gradient(45deg, transparent 60%, rgba(100,200,255,0.02) 62%, rgba(100,200,255,0.02) 64%, transparent 66%),
              //   linear-gradient(90deg, transparent 70%, rgba(255,255,255,0.01) 71%, rgba(255,255,255,0.01) 72%, transparent 73%)
              // `,
              // backgroundSize: "180px 180px, 220px 220px, 300px 300px",

              // Pattern 4: Triangular grid
              // backgroundImage: `
              //   conic-gradient(from 0deg at 30% 30%,
              //     rgba(255,255,255,0.02) 0deg, rgba(255,255,255,0.02) 120deg,
              //     transparent 120deg, transparent 240deg,
              //     rgba(255,255,255,0.02) 240deg, rgba(255,255,255,0.02) 360deg
              //   ),
              //   conic-gradient(from 120deg at 70% 70%,
              //     rgba(100,200,255,0.025) 0deg, rgba(100,200,255,0.025) 120deg,
              //     transparent 120deg, transparent 240deg,
              //     rgba(100,200,255,0.025) 240deg, rgba(100,200,255,0.025) 360deg
              //   )
              // `,
              // backgroundSize: "160px 160px, 140px 140px",

              // Pattern 5: Concentric circles
              // backgroundImage: `
              //   radial-gradient(circle at 25% 25%, transparent 30px, rgba(255,255,255,0.05) 32px, rgba(255,255,255,0.05) 34px, transparent 36px),
              //   radial-gradient(circle at 75% 75%, transparent 40px, rgba(100,200,255,0.04) 42px, rgba(100,200,255,0.04) 44px, transparent 46px),
              //   radial-gradient(circle at 75% 25%, transparent 25px, rgba(255,255,255,0.06) 27px, rgba(255,255,255,0.06) 28px, transparent 30px),
              //   radial-gradient(circle at 25% 75%, transparent 35px, rgba(100,200,255,0.03) 37px, rgba(100,200,255,0.03) 38px, transparent 40px),
              //   radial-gradient(circle at 50% 50%, transparent 20px, rgba(255,255,255,0.04) 22px, rgba(255,255,255,0.04) 24px, transparent 26px)
              // `,
              // backgroundSize: "200px 200px, 240px 240px, 160px 160px",

              // Pattern 6: Organic blobs
              // backgroundImage: `
              //   radial-gradient(ellipse 40px 20px at 20% 30%, rgba(255,255,255,0.02), transparent),
              //   radial-gradient(ellipse 30px 50px at 80% 20%, rgba(100,200,255,0.025), transparent),
              //   radial-gradient(ellipse 35px 25px at 70% 80%, rgba(255,255,255,0.015), transparent),
              //   radial-gradient(ellipse 25px 40px at 30% 70%, rgba(100,200,255,0.02), transparent)
              // `,
              // backgroundSize:
              //   "300px 300px, 280px 280px, 320px 320px, 260px 260px",

              // Pattern 7: Diamond lattice
              // backgroundImage: `
              //   conic-gradient(from 45deg at 25% 25%,
              //     rgba(255,255,255,0.02) 0deg, rgba(255,255,255,0.02) 90deg,
              //     transparent 90deg, transparent 180deg,
              //     rgba(255,255,255,0.02) 180deg, rgba(255,255,255,0.02) 270deg,
              //     transparent 270deg, transparent 360deg
              //   ),
              //   conic-gradient(from 135deg at 75% 75%,
              //     rgba(100,200,255,0.025) 0deg, rgba(100,200,255,0.025) 90deg,
              //     transparent 90deg, transparent 180deg,
              //     rgba(100,200,255,0.025) 180deg, rgba(100,200,255,0.025) 270deg,
              //     transparent 270deg, transparent 360deg
              //   )
              // `,
              // backgroundSize: "120px 120px, 100px 100px",

              // Pattern 8: Subtle crosshatch
              // backgroundImage: `
              //   repeating-linear-gradient(45deg, transparent, transparent 80px, rgba(255,255,255,0.01) 80px, rgba(255,255,255,0.01) 82px),
              //   repeating-linear-gradient(-45deg, transparent, transparent 100px, rgba(100,200,255,0.015) 100px, rgba(100,200,255,0.015) 102px),
              //   repeating-linear-gradient(90deg, transparent, transparent 120px, rgba(255,255,255,0.008) 120px, rgba(255,255,255,0.008) 121px)
              // `,

              // Pattern 9: Staggered rectangles
              // backgroundImage: `
              //   linear-gradient(0deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 3px, transparent 3px, transparent 60px),
              //   linear-gradient(90deg, rgba(100,200,255,0.02) 0px, rgba(100,200,255,0.02) 2px, transparent 2px, transparent 80px),
              //   linear-gradient(45deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 100px)
              // `,
              // backgroundSize: "60px 60px, 80px 80px, 100px 100px",
              // backgroundPosition: "0 0, 30px 30px, 15px 15px",

              // Pattern 10: Spiraling dots
              // backgroundImage: `
              //   radial-gradient(circle at 50% 50%, rgba(255,255,255,0.25) 3px, transparent 1px),
              //   radial-gradient(circle at 25% 75%, rgba(100,200,255,0.2) 4.5px, transparent 1.5px),
              //   radial-gradient(circle at 75% 25%, rgba(255,255,255,0.15) 2px, transparent 1px),
              //   radial-gradient(circle at 40% 20%, rgba(100,200,255,0.2) 1.8px, transparent 0.8px),
              //   radial-gradient(circle at 80% 60%, rgba(255,255,255,0.18) 5.2px, transparent 1.2px)
              // `,
              // backgroundSize:
              // "150px 150px, 200px 200px, 180px 180px, 120px 120px, 160px 160px",
              "@media (max-width:600px)": {
                padding: 16,
              },
            },
          },
        ],
      },

      // TextField styling
      MuiTextField: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: 8,
              "&:hover": {
                boxShadow: isDark
                  ? "0 2px 4px rgba(0,0,0,0.4)"
                  : "0 2px 4px rgba(0,0,0,0.12)",
              },
              "&.Mui-focused": {
                boxShadow: isDark
                  ? "0 2px 8px rgba(0,0,0,0.5)"
                  : "0 2px 8px rgba(0,0,0,0.15)",
              },
            },
          },
        },
      },

      // Chip styling
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 6,
          },
        },
      },

      // Dialog styling
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            boxShadow: isDark
              ? "0 8px 32px rgba(0,0,0,0.6)"
              : "0 8px 32px rgba(0,0,0,0.18)",
          },
        },
      },

      // Menu styling
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 8,
            boxShadow: isDark
              ? "0 4px 16px rgba(0,0,0,0.5)"
              : "0 4px 16px rgba(0,0,0,0.15)",
            border: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
          },
        },
      },

      // AppBar styling
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? "#1e1e1e" : undefined,
            borderBottom: `1px solid ${isDark ? "#333333" : "#e0e0e0"}`,
          },
        },
      },
    },
  };

  return createTheme(themeOptions);
};

interface HeyThemeProviderProps {
  children: ReactNode;
}

export const HeyThemeProvider: React.FC<HeyThemeProviderProps> = ({
  children,
}) => {
  const isBrowser = typeof window !== "undefined";

  const [mode, setMode] = useState<ThemeMode>(() => {
    if (isBrowser) {
      // Check localStorage for saved theme preference
      const savedMode = localStorage.getItem("themeMode") as ThemeMode;
      if (savedMode && (savedMode === "light" || savedMode === "dark")) {
        return savedMode;
      }

      // Check system preference
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        return "dark";
      }
    }

    return "light";
  });

  const toggleMode = () => {
    const newMode = mode === "light" ? "dark" : "light";
    setMode(newMode);
    if (isBrowser) {
      localStorage.setItem("themeMode", newMode);
    }
  };

  // Listen for system theme changes
  useEffect(() => {
    if (!isBrowser || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-switch if no manual preference is set
      const savedMode = localStorage.getItem("themeMode");
      if (!savedMode) {
        setMode(e.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [isBrowser]);

  const theme = createHeyTheme(mode);

  return (
    <ThemeContext.Provider value={{ mode, toggleMode }}>
      <MuiThemeProvider theme={theme}>
        {children}
        <ToastContainer
          position="bottom-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme={mode}
        />
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
