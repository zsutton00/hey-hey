// Animation configuration and global controls
export interface AnimationConfig {
  /** Enable animation debug mode (shows names, timing) */
  debugMode: boolean;
  /** Show animation names as overlays */
  showAnimationNames: boolean;
  /** Global speed multiplier (0.5 = half speed, 2 = double speed) */
  speedMultiplier: number;
  /** Disable all animations (accessibility) */
  disableAnimations: boolean;
}

// Global animation configuration
const config: AnimationConfig = {
  debugMode: false,
  showAnimationNames: false,
  speedMultiplier: 1,
  disableAnimations: false,
};

export const getAnimationConfig = (): AnimationConfig => config;

export const setAnimationDebug = (enabled: boolean): void => {
  config.debugMode = enabled;
  config.showAnimationNames = enabled;
};

export const setAnimationSpeed = (multiplier: number): void => {
  config.speedMultiplier = Math.max(0.1, multiplier);
};

type TransitionConfig = {
  duration?: number;
  [key: string]: unknown;
};

export const withSpeed = (transition: TransitionConfig): TransitionConfig => {
  if (config.disableAnimations) {
    return { duration: 0 };
  }

  if (typeof transition.duration === "number") {
    return {
      ...transition,
      duration: transition.duration * config.speedMultiplier,
    };
  }

  return transition;
};
