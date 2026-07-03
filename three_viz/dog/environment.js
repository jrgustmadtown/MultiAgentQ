/** Continuous dog game environment (matches doggame/environment.py). */

const ANGLES_DEG = [
  0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5,
  180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
];

export const NUM_ACTIONS = 17;
export const STEP_SIZE = 0.1;
export const DEFAULT_HORIZON = 30;
export const DEFAULT_HOUSE1 = [0.25, 0.25];
export const DEFAULT_HOUSE2 = [0.75, 0.75];
/** Capsule radius in state coords — matches 3D pill on the 1×1 arena. */
export const PLAYER_RADIUS = 0.022;

export const ACTION_NAMES = [
  "Stay", "E", "ENE", "NE", "NNE", "N", "NNW", "NW", "WNW",
  "W", "WSW", "SW", "SSW", "S", "SSE", "SE", "ESE",
];

function buildActionDirs() {
  const dirs = { 0: [0, 0] };
  for (let i = 0; i < ANGLES_DEG.length; i++) {
    const rad = (ANGLES_DEG[i] * Math.PI) / 180;
    dirs[i + 1] = [Math.cos(rad), Math.sin(rad)];
  }
  return dirs;
}

const ACTION_DIRS = buildActionDirs();

export function dogPosition(state) {
  return [(state[0] + state[2]) / 2, (state[1] + state[3]) / 2];
}

function distance(p1, p2) {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function clampPosition(x, y) {
  const lo = PLAYER_RADIUS;
  const hi = 1 - PLAYER_RADIUS;
  return [
    Math.max(lo, Math.min(hi, x)),
    Math.max(lo, Math.min(hi, y)),
  ];
}

export function createDogEnv(options = {}) {
  const stepSize = options.stepSize ?? STEP_SIZE;
  const house1 = options.house1 ?? DEFAULT_HOUSE1;
  const house2 = options.house2 ?? DEFAULT_HOUSE2;

  function move(x, y, action) {
    const [dx, dy] = ACTION_DIRS[action];
    return clampPosition(x + dx * stepSize, y + dy * stepSize);
  }

  return {
    stepSize,
    house1,
    house2,
    numActions: NUM_ACTIONS,

    transition(state, a1, a2) {
      const [x1, y1] = move(state[0], state[1], a1);
      const [x2, y2] = move(state[2], state[3], a2);
      return [x1, y1, x2, y2];
    },

    /** Returns separate rewards (r1, r2) after the step. */
    reward(state, a1, a2) {
      const next = this.transition(state, a1, a2);
      const dog = dogPosition(next);
      return {
        r1: -distance(dog, house1),
        r2: -distance(dog, house2),
      };
    },

    sampleState() {
      const lo = PLAYER_RADIUS;
      const span = 1 - 2 * PLAYER_RADIUS;
      return [
        lo + Math.random() * span,
        lo + Math.random() * span,
        lo + Math.random() * span,
        lo + Math.random() * span,
      ];
    },
  };
}
