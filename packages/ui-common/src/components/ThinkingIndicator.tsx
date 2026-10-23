import { Box, LinearProgress, Typography, useTheme } from "@mui/material";
import React from "react";
import { Bubble } from "./LoadingBubble";
import TetrisGame from "./LoadingGames/TetrisGame";

interface ThinkingIndicatorProps {
  animationType?: "fun" | "minimal";
  animationColor?: string;
  textOnly?: boolean;
  text?: string;
  size?: "small" | "medium" | "large";
  useGames?: boolean;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  animationColor,
  animationType = "minimal",
  useGames = false,
  textOnly = false,
  text,
}) => {
  const theme = useTheme();
  const animationColorActual = animationColor || theme.palette.primary.main;
  const containerHeight = useGames ? 200 : 40;

  if (animationType === "minimal") {
    return (
      <Box
        data-id="thinking-indicator"
        sx={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {!textOnly && <LinearProgress />}
        {text ? (
          <Typography
            variant="body2"
            sx={{
              color: theme.palette.grey[100],
              opacity: 0.72,
            }}
          >
            {text}
          </Typography>
        ) : null}
      </Box>
    );
  }

  const renderGame = (): React.ReactNode => {
    return (
      <TetrisGame
        color={animationColorActual}
        blockSize={8}
        width={12}
        height={16}
      />
    );
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        minHeight: containerHeight,
        backgroundColor: "transparent",
        color: "inherit",
        borderRadius: 2,
        mb: 2,
      }}
    >
      {useGames ? renderGame() : <Bubble />}
    </Box>
  );
};
