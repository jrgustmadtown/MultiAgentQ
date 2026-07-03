/** Discrete car grid environment (matches cargame_zerosum/environment.py). */

export const ACTION_NAMES = ["U", "D", "L", "R"];

// Normalized reward constants (cargame_zerosum/config.py).
const CRASH_PENALTY = -10 / 9;
const STAY_PENALTY = -5 / 9;
const LIVING_COST = 1 / 9;
const GRID_REWARD_MAX = 5 / 9;

function buildGridReward(gridSize) {
  const c = (gridSize - 1) / 2;
  const grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      const dist = Math.abs(x - c) + Math.abs(y - c);
      grid[x][y] = GRID_REWARD_MAX * (1 - dist / (2 * c));
    }
  }
  return grid;
}

export function createCarEnv(gridSize = 5) {
  const gridReward = buildGridReward(gridSize);

  function move(x, y, action) {
    if (action === 0) {
      return [x, Math.min(gridSize - 1, y + 1)];
    }
    if (action === 1) {
      return [x, Math.max(0, y - 1)];
    }
    if (action === 2) {
      return [Math.max(0, x - 1), y];
    }
    return [Math.min(gridSize - 1, x + 1), y];
  }

  return {
    gridSize,
    gridReward,

    /** Manhattan distance from (x, y) to grid center. */
    manhattanToCenter(x, y) {
      const c = (gridSize - 1) / 2;
      return Math.abs(x - c) + Math.abs(y - c);
    },

    /** Grid reward at a cell (higher toward center; used in training). */
    cellGridReward(x, y) {
      return gridReward[x][y];
    },

    transition(state, a1, a2) {
      const [x1n, y1n] = move(state[0], state[1], a1);
      const [x2n, y2n] = move(state[2], state[3], a2);
      return [x1n, y1n, x2n, y2n];
    },

    /** Zero-sum scalar reward (P1 maximizes, P2 minimizes). */
    rewardZerosum(state, a1, a2) {
      return this.rewardBreakdown(state, a1, a2).total;
    },

    /** Terms that sum to rewardZerosum (for display). */
    rewardBreakdown(state, a1, a2) {
      const [x1, y1, x2, y2] = state;
      const sn = this.transition(state, a1, a2);
      if (sn[0] === sn[2] && sn[1] === sn[3]) {
        return {
          total: CRASH_PENALTY,
          p1LandingGrid: 0,
          livingCost: 0,
          p1Stay: 0,
          p2Stay: 0,
          crashed: true,
        };
      }
      const p1LandingGrid = gridReward[sn[0]][sn[1]];
      const livingCost = -LIVING_COST;
      const p1Stay = sn[0] === x1 && sn[1] === y1 ? STAY_PENALTY : 0;
      const p2Stay = sn[2] === x2 && sn[3] === y2 ? -STAY_PENALTY : 0;
      return {
        total: p1LandingGrid + livingCost + p1Stay + p2Stay,
        p1LandingGrid,
        livingCost,
        p1Stay,
        p2Stay,
        crashed: false,
      };
    },

    isCollision(state) {
      return state[0] === state[2] && state[1] === state[3];
    },

    allValidStartStates() {
      const states = [];
      for (let x1 = 0; x1 < gridSize; x1++) {
        for (let y1 = 0; y1 < gridSize; y1++) {
          for (let x2 = 0; x2 < gridSize; x2++) {
            for (let y2 = 0; y2 < gridSize; y2++) {
              if (x1 !== x2 || y1 !== y2) {
                states.push([x1, y1, x2, y2]);
              }
            }
          }
        }
      }
      return states;
    },
  };
}
