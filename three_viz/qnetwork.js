/**
 * Run exported Q-network weights in the browser.
 * Weight JSON lives next to each game (e.g. ../cargame_zerosum/weights_player1.json).
 */

export async function loadWeights(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load weights: ${url} (${res.status})`);
  }
  return res.json();
}

/** Car game: grid cell indices -> normalized [0, 1] coordinates. */
export function encodeCarState(state, gridSize = 5) {
  const step = 1 / gridSize;
  return state.map((v) => v * step);
}

/** Dog game: state is already (x1, y1, x2, y2) in [0, 1]. */
export function encodeDogState(state) {
  return [...state];
}

function relu(values) {
  return values.map((v) => (v > 0 ? v : 0));
}

/** Car-game weights: row i = connections from input i to all outputs. */
function linearCargame(input, layer) {
  const { weights, bias, out_features: outSize } = layer;
  const output = new Array(outSize);

  for (let j = 0; j < outSize; j++) {
    let sum = bias[j];
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * weights[i][j];
    }
    output[j] = sum;
  }

  return output;
}

/** Dog-game weights: row j = connections into output j. */
function linearDoggame(input, layer) {
  const { weights, bias, out_features: outSize } = layer;
  const output = new Array(outSize);

  for (let j = 0; j < outSize; j++) {
    let sum = bias[j];
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * weights[j][i];
    }
    output[j] = sum;
  }

  return output;
}

export function forward(model, input) {
  const linear = model.format === "cargame" ? linearCargame : linearDoggame;
  let x = input;

  for (let i = 0; i < model.layers.length; i++) {
    x = linear(x, model.layers[i]);
    if (i < model.layers.length - 1) {
      x = relu(x);
    }
  }

  return x;
}

export function qValues(model, state, options = {}) {
  const input =
    model.format === "cargame"
      ? encodeCarState(state, options.gridSize ?? 5)
      : encodeDogState(state);
  return forward(model, input);
}
