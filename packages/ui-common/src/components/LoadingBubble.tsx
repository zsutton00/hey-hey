import { Box, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useTheme as useMuiTheme } from "@mui/material/styles";
import { keyframes } from "@mui/material/styles";
import React from "react";

/** ===== Single path animation ===== */

/** ===== Theme typing ===== */
interface ExtendedTheme extends Theme {
  palette: Theme["palette"] & {
    heyhey?: {
      main: string;
      light: string;
      dark: string;
      contrastText: string;
    };
  };
}

/** ===== Keyframes (no bubble morphing) ===== */
const burstAnimation = keyframes`
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.6; }
  100% { transform: scale(1.6); opacity: 0; }
`;

/** ===== Path defs ===== */
interface ChalkPath {
  path: string | string[];
  duration: number; // ms
  strokeWidth?: number;
  staggerDelay?: number; // ms
}

const CHALK: Record<string, ChalkPath> = {
  arc: { path: "M 15 35 Q 35 15, 55 35", duration: 800, strokeWidth: 3 },
  plus: {
    path: "M 25 15 L 25 45 M 15 30 L 35 30",
    duration: 600,
    strokeWidth: 3,
    staggerDelay: 120,
  },
  loop: {
    path: "M 30 20 C 45 20, 45 40, 30 40 C 15 40, 15 20, 30 20",
    duration: 1000,
    strokeWidth: 3,
  },
  zigzag: {
    path: "M 10 35 L 20 20 L 30 35 L 40 20 L 50 35",
    duration: 900,
    strokeWidth: 3,
  },
  jhook: {
    path: "M 30 15 L 30 40 Q 30 45, 25 45",
    duration: 700,
    strokeWidth: 3,
  },
  spiral: {
    path: "M 30 30 Q 40 30, 40 35 T 30 40 Q 20 40, 20 35 T 30 30",
    duration: 1200,
    strokeWidth: 3,
  },
  check: { path: "M 15 30 L 25 40 L 45 20", duration: 650, strokeWidth: 3 },
  wave: {
    path: "M 10 30 Q 20 20, 30 30 T 50 30",
    duration: 800,
    strokeWidth: 3,
  },
  fOfX: {
    path: [
      "M 20 15 C 20 10, 25 10, 28 12 L 28 35 C 28 40, 25 42, 20 40",
      "M 32 22 C 30 22, 30 28, 32 28 M 36 24 L 40 28 M 40 24 L 36 28 M 44 22 C 46 22, 46 28, 44 28",
    ],
    duration: 1200,
    strokeWidth: 2.5,
    staggerDelay: 300,
  },
  integral: {
    path: "M 25 15 C 20 15, 20 25, 25 30 C 30 35, 30 45, 35 45",
    duration: 900,
    strokeWidth: 3,
  },
  sqrt: {
    path: "M 15 30 L 20 40 L 25 20 L 45 20",
    duration: 700,
    strokeWidth: 3,
  },
};

const SingleAnimatedPath: React.FC<{
  pathString: string;
  duration: number;
  strokeWidth?: number;
  delay: number;
  color: string;
  holdMs?: number;
}> = ({
  pathString,
  duration,
  strokeWidth = 3,
  delay,
  color,
  holdMs = 1200,
}) => {
  const ref = React.useRef<SVGPathElement>(null);
  const [len, setLen] = React.useState<number>(0);

  // Measure AFTER the path is mounted
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    try {
      const L = ref.current.getTotalLength();
      setLen(Number.isFinite(L) ? L : 120);
    } catch {
      setLen(120);
    }
  }, [pathString]);

  // Before we know length, render the path statically (no dashes/animation)
  const dash = len ? `${len}` : undefined;
  const anim = len
    ? `hh-drawStroke ${duration}ms ease-out ${delay}ms forwards, hh-fadeOut 400ms ease-out ${
        delay + duration + holdMs
      }ms forwards`
    : "none";

  return (
    <path
      ref={ref}
      d={pathString}
      stroke={color}
      strokeWidth={strokeWidth}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.95}
      style={{
        strokeDasharray: dash,
        strokeDashoffset: dash,
        animation: anim,
      }}
    />
  );
};

const AnimatedChalkPath: React.FC<{
  pathData: ChalkPath;
  delay: number;
  color: string;
  groupTransform?: string;
}> = ({ pathData, delay, color, groupTransform }) => {
  const paths = Array.isArray(pathData.path) ? pathData.path : [pathData.path];
  const stagger = pathData.staggerDelay ?? 160;
  return (
    <g transform={groupTransform}>
      {paths.map((p, i) => (
        <SingleAnimatedPath
          key={i}
          pathString={p}
          duration={pathData.duration}
          strokeWidth={pathData.strokeWidth}
          delay={delay + i * stagger}
          color={color}
        />
      ))}
    </g>
  );
};

/** ===== Public props ===== */
interface BubbleProps {
  durationMs?: number; // total scripted duration (default 10s)
  shouldPop?: boolean; // burst at the end
  onComplete?: () => void; // called after burst or final phase
  steps?: string[]; // labels shown over time
}

/** ===== Main (static bubble, 4 phases) ===== */
export const Bubble: React.FC<BubbleProps> = ({
  durationMs = 10_000,
  shouldPop = false,
  onComplete,
  steps = [
    "Analyzing your input…",
    "Refining questions…",
    "Drafting response…",
    "Polishing…",
  ],
}) => {
  const theme = useMuiTheme() as ExtendedTheme;
  const bg =
    theme.palette.heyhey?.dark ||
    theme.palette.primary.dark ||
    theme.palette.primary.main;
  const fg =
    theme.palette.heyhey?.contrastText || theme.palette.getContrastText(bg);

  const [phase, setPhase] = React.useState<0 | 1 | 2 | 3>(0);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [svgKey, setSvgKey] = React.useState(0);
  const [bursting, setBursting] = React.useState(false);

  React.useEffect(() => {
    const timers: number[] = [];
    const q = Math.max(1, Math.floor(durationMs / 4));

    const go = (p: 0 | 1 | 2 | 3, sIdx: number, at: number) =>
      timers.push(
        window.setTimeout(() => {
          setPhase(p);
          setStepIndex(Math.min(sIdx, steps.length - 1));
          setSvgKey((k) => k + 1);
          if (p === 3) {
            if (shouldPop) {
              window.setTimeout(() => setBursting(true), 1000);
            } else {
              window.setTimeout(() => onComplete?.(), 1000);
            }
          }
        }, at)
      );

    go(0, 0, 0);
    go(1, 1, q);
    go(2, 2, q * 2);
    go(3, 3, q * 3);

    return () => timers.forEach(clearTimeout);
  }, [durationMs, shouldPop, steps.length, onComplete]);

  const handleRootAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (!shouldPop) return;
    if (e.currentTarget !== e.target) return; // ignore child animations
    if (bursting) onComplete?.();
  };

  const phasePaths: ChalkPath[] = React.useMemo(() => {
    switch (phase) {
      case 0:
        return [CHALK.zigzag, CHALK.wave, CHALK.loop]; // chaos
      case 1:
        return [CHALK.arc, CHALK.integral, CHALK.fOfX]; // refine
      case 2:
        return [CHALK.sqrt, CHALK.plus, CHALK.check]; // converge
      case 3:
        return [CHALK.check]; // ready
      default:
        return [CHALK.check];
    }
  }, [phase]);

  const placements = React.useMemo(() => {
    // tuned for viewBox 0 0 60 60
    switch (phase) {
      case 0: // chaos – scattered
        return [
          "translate(-30, -10) rotate(-6) scale(0.95)",
          "translate(30, -10) rotate(4) scale(0.9)",
          "translate(64, -10) rotate(-2) scale(0.95)",
        ];
      case 1: // refine – aligned rows
        return [
          "translate(-106, -24) scale(0.9)",
          "translate(-50, -24) scale(0.9)",
          "translate(0, -24) scale(0.9)",
        ];
      case 2: // converge – centered cluster
        return [
          "translate(8, 12) scale(1.0)",
          "translate(30, 12) scale(1.0)",
          "translate(19, 30) scale(1.0)",
        ];
      case 3: // ready – single checkmark centered
      default:
        return ["translate(18, 18) scale(1.1)"];
    }
  }, [phase]);

  return (
    <Box
      role="status"
      aria-busy
      sx={{
        display: "inline-flex",
        width: 320,
        minHeight: 96,
        p: 2,
        mb: 3,
        backgroundColor: bg,
        borderRadius: 1,
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        alignItems: "center",
        justifyContent: "center",
        // no morph — only optional burst at the end
        animation: bursting
          ? `${burstAnimation} 220ms ease-out forwards`
          : "none",
      }}
      onAnimationEnd={handleRootAnimationEnd}
    >
      {/* Chalkboard SVG */}
      <Box
        sx={{
          width: "100%",
          height: 70,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <svg
          key={svgKey}
          width="100%"
          height="100%"
          viewBox="0 0 60 60"
          style={{ overflow: "visible" }}
        >
          <defs>
            <filter id="chalk-texture">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.02"
                numOctaves="5"
                result="noise"
              />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.6" />
            </filter>
          </defs>
          <g filter="url(#chalk-texture)">
            {phasePaths.map((pd, i) => (
              <AnimatedChalkPath
                key={`${svgKey}-${i}`}
                pathData={pd}
                delay={i * 600}
                color="#FFFFFF"
                groupTransform={placements[i] ?? "translate(0,0)"}
              />
            ))}
          </g>
        </svg>
      </Box>

      {/* Step label */}
      <Typography
        variant="caption"
        sx={{
          position: "absolute",
          bottom: 6,
          left: 10,
          right: 10,
          color: fg,
          opacity: 0.85,
          textAlign: "center",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          fontWeight: 500,
          letterSpacing: 0.2,
          userSelect: "none",
        }}
      >
        {steps[stepIndex] ?? ""}
      </Typography>
    </Box>
  );
};
