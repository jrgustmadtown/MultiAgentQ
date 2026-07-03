import { qValues } from "../qnetwork.js";
import { NUM_ACTIONS } from "./environment.js";

/** Reshape 289 Q-values into Q[a1][a2] (17×17). */
export function qMatrix17(qFlat) {
  const q = Array.from({ length: NUM_ACTIONS }, () => Array(NUM_ACTIONS).fill(0));
  for (let a1 = 0; a1 < NUM_ACTIONS; a1++) {
    for (let a2 = 0; a2 < NUM_ACTIONS; a2++) {
      q[a1][a2] = qFlat[a1 * NUM_ACTIONS + a2];
    }
  }
  return q;
}

/** Iterated best-response Nash approximation (matches doggame/policy.py). */
export function nashActionsIBRR(q1Flat, q2Flat) {
  const q1 = qMatrix17(q1Flat);
  const q2 = qMatrix17(q2Flat);

  let a1 = 0;
  let best = -Infinity;
  for (let i = 0; i < NUM_ACTIONS; i++) {
    let rowMax = -Infinity;
    for (let j = 0; j < NUM_ACTIONS; j++) {
      rowMax = Math.max(rowMax, q1[i][j]);
    }
    if (rowMax > best) {
      best = rowMax;
      a1 = i;
    }
  }

  let a2 = 0;
  best = -Infinity;
  for (let j = 0; j < NUM_ACTIONS; j++) {
    let colMax = -Infinity;
    for (let i = 0; i < NUM_ACTIONS; i++) {
      colMax = Math.max(colMax, q2[i][j]);
    }
    if (colMax > best) {
      best = colMax;
      a2 = j;
    }
  }

  for (let round = 0; round < 5; round++) {
    let a1New = 0;
    best = -Infinity;
    for (let i = 0; i < NUM_ACTIONS; i++) {
      if (q1[i][a2] > best) {
        best = q1[i][a2];
        a1New = i;
      }
    }

    let a2New = 0;
    best = -Infinity;
    for (let j = 0; j < NUM_ACTIONS; j++) {
      if (q2[a1][j] > best) {
        best = q2[a1][j];
        a2New = j;
      }
    }

    if (a1New === a1 && a2New === a2) {
      break;
    }
    a1 = a1New;
    a2 = a2New;
  }

  return [a1, a2];
}

export function actionsForState(model1, model2, state) {
  const q1 = qValues(model1, state);
  const q2 = qValues(model2, state);
  return nashActionsIBRR(q1, q2);
}

export function rollout(env, model1, model2, startState, horizon = 30) {
  return rolloutDetailed(env, model1, model2, startState, horizon).traj;
}

export function rolloutDetailed(env, model1, model2, startState, horizon = 30) {
  const traj = [startState.slice()];
  const steps = [];
  let state = startState.slice();
  let cumulativeR1 = 0;
  let cumulativeR2 = 0;

  for (let step = 0; step < horizon; step++) {
    const [a1, a2] = actionsForState(model1, model2, state);
    const next = env.transition(state, a1, a2);
    const { r1, r2 } = env.reward(state, a1, a2);
    cumulativeR1 += r1;
    cumulativeR2 += r2;

    steps.push({
      from: state.slice(),
      a1,
      a2,
      to: next.slice(),
      r1,
      r2,
      cumulativeR1,
      cumulativeR2,
    });

    state = next;
    traj.push(state.slice());
  }

  return { traj, steps };
}
