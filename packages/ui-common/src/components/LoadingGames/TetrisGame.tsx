import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTheme as useMuiTheme } from "@mui/material";
import { Box, Typography, Button, Paper } from "@mui/material";

interface TetrisGameProps {
  color?: string;
  blockSize?: number;
  width?: number;
  height?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}

interface TetrisPiece {
  shape: number[][];
  color: string;
  x: number;
  y: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

const TetrisGame: React.FC<TetrisGameProps> = ({
  color,
  blockSize = 25, // Increased block size for larger game
  width = 10,
  height = 20,
  onFocus,
  onBlur,
}) => {
  const theme = useMuiTheme();
  const gameColor = color || theme.palette.primary.main;

  const [grid, setGrid] = useState<(string | number)[][]>(() => {
    return Array(height)
      .fill(null)
      .map(() => Array(width).fill(0));
  });

  const [currentPiece, setCurrentPiece] = useState<TetrisPiece | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);
  const particleTimeRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const pieces = [
    { shape: [[1, 1, 1, 1]], color: "#087E8B" }, // I-piece - heyhey color
    {
      shape: [
        [1, 1],
        [1, 1],
      ],
      color: "#F7E733", // O-piece - warning color
    },
    {
      shape: [
        [0, 1, 0],
        [1, 1, 1],
      ],
      color: "#434666", // T-piece - attention color
    },
    {
      shape: [
        [1, 0, 0],
        [1, 1, 1],
      ],
      color: "#3C72A0", // L-piece - actionable color
    },
    {
      shape: [
        [0, 0, 1],
        [1, 1, 1],
      ],
      color: theme.palette.secondary.main, // J-piece
    },
    {
      shape: [
        [0, 1, 1],
        [1, 1, 0],
      ],
      color: theme.palette.primary.main, // S-piece
    },
    {
      shape: [
        [1, 1, 0],
        [0, 1, 1],
      ],
      color: "#5086B4", // Z-piece - interactive contrast color
    },
  ];

  const rotatePiece = (piece: TetrisPiece): TetrisPiece => {
    const rotated = piece.shape[0].map((_, index) =>
      piece.shape.map((row) => row[index]).reverse()
    );
    return { ...piece, shape: rotated };
  };

  const getRandomPiece = (): TetrisPiece => {
    const piece = pieces[Math.floor(Math.random() * pieces.length)];
    const pieceWidth = piece.shape[0].length;
    return {
      shape: piece.shape,
      color: piece.color,
      x: Math.floor(Math.random() * Math.max(1, width - pieceWidth + 1)),
      y: 0,
    };
  };

  const resetGame = useCallback((): void => {
    setGrid(
      Array(height)
        .fill(null)
        .map(() => Array(width).fill(0))
    );
    setCurrentPiece(null);
    setParticles([]);
  }, [height, width]);

  const checkCollision = (
    piece: TetrisPiece,
    grid: (string | number)[][],
    offsetX = 0,
    offsetY = 0
  ): boolean => {
    for (let y = 0; y < piece.shape.length; y++) {
      for (let x = 0; x < piece.shape[y].length; x++) {
        if (piece.shape[y][x]) {
          const newY = piece.y + y + offsetY;
          const newX = piece.x + x + offsetX;

          if (
            newY >= height ||
            newX < 0 ||
            newX >= width ||
            (newY >= 0 && grid[newY][newX])
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const mergePiece = (
    piece: TetrisPiece,
    grid: (string | number)[][]
  ): (string | number)[][] => {
    const newGrid = grid.map((row) => [...row]);
    for (let y = 0; y < piece.shape.length; y++) {
      for (let x = 0; x < piece.shape[y].length; x++) {
        if (piece.shape[y][x]) {
          const gridY = piece.y + y;
          const gridX = piece.x + x;
          if (gridY >= 0) {
            newGrid[gridY][gridX] = piece.color;
          }
        }
      }
    }
    return newGrid;
  };

  const createLineParticles = (lineY: number): Particle[] => {
    const newParticles: Particle[] = [];
    for (let x = 0; x < width; x++) {
      for (let i = 0; i < 2; i++) {
        newParticles.push({
          id: Math.random(),
          x: x * blockSize + blockSize / 2,
          y: lineY * blockSize + blockSize / 2,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3 - 1,
          life: 1,
          size: blockSize / 3,
        });
      }
    }
    return newParticles;
  };

  const clearLines = (
    grid: (string | number)[][]
  ): { grid: (string | number)[][]; cleared: number } => {
    const clearedLines: number[] = [];
    const newGrid = grid.filter((row, index) => {
      const isFull = row.every((cell) => cell !== 0);
      if (isFull) {
        clearedLines.push(index);
      }
      return !isFull;
    });

    if (clearedLines.length > 0) {
      const newParticles = clearedLines.flatMap((lineY) =>
        createLineParticles(lineY)
      );
      setParticles((prev) => [...prev, ...newParticles]);
    }

    while (newGrid.length < height) {
      newGrid.unshift(Array(width).fill(0));
    }

    return { grid: newGrid, cleared: clearedLines.length };
  };

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent): void => {
      // Global keyboard controls - no focus requirement
      if (!currentPiece) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.key === "ArrowLeft") {
        setCurrentPiece((prev) => {
          if (!prev || checkCollision(prev, grid, -1, 0)) return prev;
          return { ...prev, x: prev.x - 1 };
        });
      } else if (e.key === "ArrowRight") {
        setCurrentPiece((prev) => {
          if (!prev || checkCollision(prev, grid, 1, 0)) return prev;
          return { ...prev, x: prev.x + 1 };
        });
      } else if (e.key === "ArrowDown") {
        setCurrentPiece((prev) => {
          if (!prev || checkCollision(prev, grid, 0, 1)) return prev;
          return { ...prev, y: prev.y + 1 };
        });
      } else if (e.key === "ArrowUp" || e.key === " ") {
        setCurrentPiece((prev) => {
          if (!prev) return prev;
          const rotated = rotatePiece(prev);

          let adjustedPiece = rotated;

          if (checkCollision(adjustedPiece, grid)) {
            if (
              !checkCollision(
                { ...adjustedPiece, x: adjustedPiece.x - 1 },
                grid
              )
            ) {
              adjustedPiece = { ...adjustedPiece, x: adjustedPiece.x - 1 };
            } else if (
              !checkCollision(
                { ...adjustedPiece, x: adjustedPiece.x + 1 },
                grid
              )
            ) {
              adjustedPiece = { ...adjustedPiece, x: adjustedPiece.x + 1 };
            } else if (
              !checkCollision(
                { ...adjustedPiece, x: adjustedPiece.x - 2 },
                grid
              )
            ) {
              adjustedPiece = { ...adjustedPiece, x: adjustedPiece.x - 2 };
            } else {
              return prev;
            }
          }

          return adjustedPiece;
        });
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [currentPiece, grid]);

  const animate = useCallback(
    (timestamp?: number): void => {
      if (!timestamp) return;
      if (!timeRef.current) timeRef.current = timestamp;
      if (!particleTimeRef.current) particleTimeRef.current = timestamp;

      const deltaTime = timestamp - timeRef.current;
      const particleDelta = timestamp - particleTimeRef.current;

      if (particleDelta > 16) {
        particleTimeRef.current = timestamp;
        setParticles((prev) =>
          prev
            .map((p) => ({
              ...p,
              x: p.x + p.vx,
              y: p.y + p.vy,
              vy: p.vy + 0.2,
              life: p.life - 0.025,
              size: p.size * 0.97,
            }))
            .filter((p) => p.life > 0)
        );
      }

      if (deltaTime > 250) {
        timeRef.current = timestamp;

        setCurrentPiece((prev) => {
          if (!prev) {
            const newPiece = getRandomPiece();
            // Check if new piece collides immediately (game over)
            if (checkCollision(newPiece, grid)) {
              // Reset the grid
              setGrid(
                Array(height)
                  .fill(null)
                  .map(() => Array(width).fill(0))
              );
              // Create explosion effect for game over
              const explosionParticles: Particle[] = [];
              for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                  if (grid[y][x] !== 0) {
                    explosionParticles.push({
                      id: Math.random(),
                      x: x * blockSize + blockSize / 2,
                      y: y * blockSize + blockSize / 2,
                      vx: (Math.random() - 0.5) * 4,
                      vy: (Math.random() - 0.5) * 4,
                      life: 1,
                      size: blockSize / 2,
                    });
                  }
                }
              }
              setParticles((prev) => [...prev, ...explosionParticles]);
            }
            return newPiece;
          }

          if (!checkCollision(prev, grid, 0, 1)) {
            return { ...prev, y: prev.y + 1 };
          } else {
            const newGrid = mergePiece(prev, grid);
            const { grid: clearedGrid } = clearLines(newGrid);
            setGrid(clearedGrid);

            return getRandomPiece();
          }
        });
      }

      animationRef.current = requestAnimationFrame(animate);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [grid, blockSize, height, width]
  );

  useEffect(() => {
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [grid, animate]);

  const renderGrid = (): (string | number)[][] => {
    const displayGrid = grid.map((row) => [...row]);

    if (currentPiece) {
      for (let y = 0; y < currentPiece.shape.length; y++) {
        for (let x = 0; x < currentPiece.shape[y].length; x++) {
          if (currentPiece.shape[y][x]) {
            const gridY = currentPiece.y + y;
            const gridX = currentPiece.x + x;
            if (gridY >= 0 && gridY < height && gridX >= 0 && gridX < width) {
              displayGrid[gridY][gridX] = currentPiece.color;
            }
          }
        }
      }
    }

    return displayGrid;
  };

  const displayGrid = renderGrid();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      {/* Thinking message */}
      <Paper
        sx={{ p: 2, mb: 2, textAlign: "center", backgroundColor: "#EEF0F2" }}
      >
        <Typography
          variant="body1"
          sx={{ color: "#5086B4", fontStyle: "italic" }}
        >
          🤔 Hold on for a minute, we're thinking...
        </Typography>
      </Paper>

      {/* Game instructions */}
      <Paper sx={{ p: 2, mb: 2, maxWidth: 400 }}>
        <Typography variant="h6" gutterBottom>
          Tetris Controls
        </Typography>
        <Typography variant="body2" component="div">
          <strong>← →</strong> Move left/right
          <br />
          <strong>↓</strong> Move down faster
          <br />
          <strong>↑ / Space</strong> Rotate piece
          <br />
          Game resets automatically when you reach the top!
        </Typography>
      </Paper>

      {/* Game container */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <div
          ref={containerRef}
          tabIndex={0}
          onFocus={onFocus}
          onBlur={onBlur}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: `${Math.max(blockSize, 16)}px`,
            padding: `${Math.max(blockSize, 16)}px`,
            backgroundColor: theme.palette.mode === "dark" ? "#111" : "#f5f5f5",
            borderRadius: `${blockSize}px`,
            boxShadow: theme.shadows[2],
            outline: "none",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${width}, ${blockSize}px)`,
              gridTemplateRows: `repeat(${height}, ${blockSize}px)`,
              gap: "0px", // Remove gap to fit exact dimensions
              backgroundColor:
                theme.palette.mode === "dark" ? "#222" : "#e0e0e0",
              padding: "0px", // Remove padding to fit exact dimensions
              position: "relative",
              width: `${width * blockSize}px`,
              height: `${height * blockSize}px`,
            }}
          >
            {displayGrid.map((row, y) =>
              row.map((cell, x) => (
                <div
                  key={`${x}-${y}`}
                  style={{
                    width: `${blockSize}px`,
                    height: `${blockSize}px`,
                    backgroundColor:
                      typeof cell === "string"
                        ? cell
                        : cell !== 0
                        ? gameColor
                        : theme.palette.mode === "dark"
                        ? "#333"
                        : "#f9f9f9",
                    opacity: cell !== 0 ? 0.8 : 0.1,
                    transition: "all 0.1s ease",
                    boxShadow:
                      cell !== 0
                        ? `inset 0 0 ${blockSize / 2}px rgba(255,255,255,0.3)`
                        : "none",
                  }}
                />
              ))
            )}

            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              {particles.map((p) => (
                <div
                  key={p.id}
                  style={{
                    position: "absolute",
                    left: `${p.x}px`,
                    top: `${p.y}px`,
                    width: `${p.size}px`,
                    height: `${p.size}px`,
                    backgroundColor: gameColor,
                    borderRadius: "50%",
                    opacity: p.life,
                    transform: "translate(-50%, -50%)",
                    boxShadow: `0 0 ${p.size}px ${gameColor}`,
                    pointerEvents: "none",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Reset button */}
        <Button
          variant="contained"
          color="primary"
          onClick={resetGame}
          sx={{ ml: 2, minWidth: 100 }}
        >
          Reset Game
        </Button>
      </Box>
    </Box>
  );
};

export default TetrisGame;
