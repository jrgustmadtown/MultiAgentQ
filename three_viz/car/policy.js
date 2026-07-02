import { qValues } from "../qnetwork.js";

/** Reshape 16 Q-values into a 4x4 joint action matrix Q[a1][a2]. */
export function qMatrix(qFlat) {
  const q = Array.from({ length: 4 }, () => Array(4));
  for (let a1 = 0; a1 < 4; a1++) {
    for (let a2 = 0; a2 < 4; a2++) {
      q[a1][a2] = qFlat[a1 * 4 + a2];
    }
  }
  return q;
}

/** Minimax policy: a1 = argmax_a1 min_a2 Q, a2 = argmin_a2 Q[a1]. */
export function minimaxActions(qFlat) {
  const q = qMatrix(qFlat);
  let a1 = 0;
  let bestMin = -Infinity;

  for (let i = 0; i < 4; i++) {
    let rowMin = Infinity;
    for (let j = 0; j < 4; j++) {
      rowMin = Math.min(rowMin, q[i][j]);
    }
    if (rowMin > bestMin) {
      bestMin = rowMin;
      a1 = i;
    }
  }

  let a2 = 0;
  let bestQ = Infinity;
  for (let j = 0; j < 4; j++) {
    if (q[a1][j] < bestQ) {
      bestQ = q[a1][j];
      a2 = j;
    }
  }

  return [a1, a2];
}

export function actionsForState(model, state, gridSize) {
  const q = qValues(model, state, { gridSize });
  return minimaxActions(q);
}

export function rollout(env, model, startState, horizon = 20) {
  return rolloutDetailed(env, model, startState, horizon).traj;
}

export function rolloutDetailed(env, model, startState, horizon = 20) {
  const traj = [startState.slice()];
  const steps = [];
  let state = startState.slice();
  let cumulativeReward = 0;

  for (let step = 0; step < horizon; step++) {
    if (env.isCollision(state)) {
      break;
    }

    const [a1, a2] = actionsForState(model, state, env.gridSize);
    const next = env.transition(state, a1, a2);
    const reward = env.rewardZerosum(state, a1, a2);
    cumulativeReward += reward;

    steps.push({
      from: state.slice(),
      a1,
      a2,
      to: next.slice(),
      reward,
      cumulativeReward,
    });

    state = next;
    traj.push(state.slice());

    if (env.isCollision(state)) {
      break;
    }
  }

  return { traj, steps };
}
