"""
Check that JS Nash policy logic matches doggame/policy.py on sample states.
Run from repo root: .venv/bin/python utilities/verify_dog_policy.py
"""

import json
import os
import sys

import torch
import torch.nn as nn

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.append(REPO_ROOT)

from doggame.policy import get_policy

NUM_ACTIONS_JS = 17


def load_pytorch_from_json(path):
    with open(path) as f:
        model = json.load(f)

    modules = []
    for layer in model["layers"]:
        linear = nn.Linear(layer["in_features"], layer["out_features"])
        linear.weight.data = torch.tensor(layer["weights"], dtype=torch.float32)
        linear.bias.data = torch.tensor(layer["bias"], dtype=torch.float32)
        modules.append(linear)

    seq = []
    for i, linear in enumerate(modules):
        if i < len(modules) - 1:
            seq.extend([linear, nn.ReLU()])
        else:
            seq.append(linear)
    return nn.Sequential(*seq)


def nash_actions_ibrr_js(q1_flat, q2_flat):
  """Mirror of three_viz/dog/policy.js."""
  n = NUM_ACTIONS_JS

  def q_matrix(q_flat):
    q = [[0.0] * n for _ in range(n)]
    for a1 in range(n):
      for a2 in range(n):
        q[a1][a2] = q_flat[a1 * n + a2]
    return q

  q1 = q_matrix(q1_flat)
  q2 = q_matrix(q2_flat)

  a1 = max(range(n), key=lambda i: max(q1[i]))
  a2 = max(range(n), key=lambda j: max(q2[i][j] for i in range(n)))

  for _ in range(5):
    a1_new = max(range(n), key=lambda i: q1[i][a2])
    a2_new = max(range(n), key=lambda j: q2[a1][j])
    if a1_new == a1 and a2_new == a2:
      break
    a1, a2 = a1_new, a2_new

  return a1, a2


def main():
  p1_path = os.path.join(REPO_ROOT, "doggame/weights_player1.json")
  p2_path = os.path.join(REPO_ROOT, "doggame/weights_player2.json")
  if not os.path.exists(p1_path) or not os.path.exists(p2_path):
    print("SKIP: missing doggame weight JSON")
    sys.exit(0)

  net1 = load_pytorch_from_json(p1_path)
  net2 = load_pytorch_from_json(p2_path)
  policy_fn = get_policy((net1, net2))

  states = [
    (0.25, 0.25, 0.75, 0.75),
    (0.1, 0.2, 0.8, 0.9),
    (0.5, 0.5, 0.5, 0.6),
  ]

  failed = False
  for state in states:
    py_a1, py_a2 = policy_fn(state)
    with torch.no_grad():
      q1 = net1(torch.tensor(state, dtype=torch.float32)).tolist()
      q2 = net2(torch.tensor(state, dtype=torch.float32)).tolist()
    js_a1, js_a2 = nash_actions_ibrr_js(q1, q2)
    ok = py_a1 == js_a1 and py_a2 == js_a2
    status = "OK" if ok else "FAIL"
    print(f"{status} state={state} py=({py_a1},{py_a2}) js=({js_a1},{js_a2})")
    if not ok:
      failed = True

  if failed:
    sys.exit(1)


if __name__ == "__main__":
  main()
