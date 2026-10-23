import { useState, useEffect, useCallback } from "react";

interface PerformanceMetrics {
  fps: number;
  averageFps: number;
  isOptimized: boolean;
  frameDrops: number;
  lastFrameTime: number;
}

export const useScrollPerformance = () => {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 60,
    averageFps: 60,
    isOptimized: false,
    frameDrops: 0,
    lastFrameTime: 0,
  });

  const [isMonitoring, setIsMonitoring] = useState(false);

  const startMonitoring = useCallback(() => {
    setIsMonitoring(true);
  }, []);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
  }, []);

  useEffect(() => {
    if (!isMonitoring) return;

    let frameCount = 0;
    let lastTime = performance.now();
    let fpsHistory: number[] = [];
    let frameDropCount = 0;
    let animationFrameId: number;

    const measureFPS = (currentTime: number) => {
      frameCount++;
      const deltaTime = currentTime - lastTime;

      // Calculate FPS every second
      if (deltaTime >= 1000) {
        const currentFPS = Math.round((frameCount * 1000) / deltaTime);
        fpsHistory.push(currentFPS);

        // Keep only last 10 seconds of FPS data
        if (fpsHistory.length > 10) {
          fpsHistory = fpsHistory.slice(-10);
        }

        const averageFPS = Math.round(
          fpsHistory.reduce((sum, fps) => sum + fps, 0) / fpsHistory.length
        );

        // Count frame drops (FPS below 45)
        if (currentFPS < 45) {
          frameDropCount++;
        }

        // Trigger optimization if average FPS drops below 30
        const shouldOptimize = averageFPS < 30 && !metrics.isOptimized;

        setMetrics((prev) => ({
          ...prev,
          fps: currentFPS,
          averageFps: averageFPS,
          isOptimized: shouldOptimize || prev.isOptimized,
          frameDrops: frameDropCount,
          lastFrameTime: currentTime,
        }));

        frameCount = 0;
        lastTime = currentTime;
      }

      animationFrameId = requestAnimationFrame(measureFPS);
    };

    animationFrameId = requestAnimationFrame(measureFPS);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isMonitoring, metrics.isOptimized]);

  // Auto-start monitoring during development
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      startMonitoring();
    }
  }, [startMonitoring]);

  return {
    ...metrics,
    startMonitoring,
    stopMonitoring,
    isMonitoring,
  };
};
