"""
Check that JSON weight forward pass matches PyTorch for each game format.
Run from repo root: python3 utilities/verify_js_forward.py
"""

import json
import os
import sys

import torch
import torch.nn as nn

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.append(REPO_ROOT)


def forward_json_cargame(model, x):
    for i, layer in enumerate(model["layers"]):
        weights = layer["weights"]
        bias = layer["bias"]
        out = [
            sum(x[j] * weights[j][k] for j in range(len(x))) + bias[k]
            for k in range(layer["out_features"])
        ]
        x = [max(0.0, v) for v in out] if i < len(model["layers"]) - 1 else out
    return x


def forward_json_doggame(model, x):
    for i, layer in enumerate(model["layers"]):
        weights = layer["weights"]
        bias = layer["bias"]
        out = [
            sum(x[j] * weights[k][j] for j in range(len(x))) + bias[k]
            for k in range(layer["out_features"])
        ]
        x = [max(0.0, v) for v in out] if i < len(model["layers"]) - 1 else out
    return x


def load_pytorch_from_json(model):
    modules = []
    for layer in model["layers"]:
        linear = nn.Linear(layer["in_features"], layer["out_features"])
        w = torch.tensor(layer["weights"], dtype=torch.float32)
        if model["format"] == "cargame":
            linear.weight.data = w.T.contiguous()
        else:
            linear.weight.data = w
        linear.bias.data = torch.tensor(layer["bias"], dtype=torch.float32)
        modules.append(linear)

    seq = []
    for i, linear in enumerate(modules):
        if i < len(modules) - 1:
            seq.extend([linear, nn.ReLU()])
        else:
            seq.append(linear)
    return nn.Sequential(*seq)


def verify(json_path, state, encode_fn):
    with open(json_path) as f:
        model = json.load(f)

    x = encode_fn(state)
    if model["format"] == "cargame":
        json_out = forward_json_cargame(model, x)
    else:
        json_out = forward_json_doggame(model, x)

    net = load_pytorch_from_json(model)
    with torch.no_grad():
        torch_out = net(torch.tensor(x, dtype=torch.float32)).tolist()

    max_diff = max(abs(a - b) for a, b in zip(json_out, torch_out))
    return max_diff, len(json_out)


def main():
    tests = [
        (
            "cargame_zerosum",
            os.path.join(REPO_ROOT, "cargame_zerosum/weights_player1.json"),
            [0, 0, 4, 4],
            lambda s, gs=5: [v / gs for v in s],
        ),
        (
            "cargame_gensum",
            os.path.join(REPO_ROOT, "cargame_gensum/weights_player1.json"),
            [2, 2, 3, 3],
            lambda s, gs=5: [v / gs for v in s],
        ),
        (
            "doggame",
            os.path.join(REPO_ROOT, "doggame/weights_player1.json"),
            [0.25, 0.25, 0.75, 0.75],
            lambda s: list(s),
        ),
        (
            "doggame_coop",
            os.path.join(REPO_ROOT, "doggame_coop/weights_player1.json"),
            [0.1, 0.2, 0.8, 0.9],
            lambda s: list(s),
        ),
    ]

    failed = False
    for name, path, state, encode in tests:
        if not os.path.exists(path):
            print(f"SKIP {name}: missing {path}")
            continue
        max_diff, n_out = verify(path, state, encode)
        status = "OK" if max_diff < 1e-4 else "FAIL"
        print(f"{status} {name}: {n_out} outputs, max diff = {max_diff:.2e}")
        if max_diff >= 1e-4:
            failed = True

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
