import json
import re


def _parse_linear_header(line):
    """Extract in/out sizes from a line like '# Layer 0: Linear(4 -> 64)'."""
    match = re.search(r"Linear\((\d+)\s*->\s*(\d+)\)", line)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _new_layer(in_features=None, out_features=None):
    layer = {"weights": [], "bias": []}
    if in_features is not None:
        layer["in_features"] = in_features
    if out_features is not None:
        layer["out_features"] = out_features
    return layer


def _finalize_doggame_layer(layer):
    """
    Dog-game rows bundle bias as the last number in each row.
    Split that out and infer layer dimensions from the result.
    """
    rows = layer["weights"]
    if not rows:
        return layer

    layer["weights"] = [row[:-1] for row in rows]
    layer["bias"] = [row[-1] for row in rows]
    layer["in_features"] = len(layer["weights"][0])
    layer["out_features"] = len(layer["weights"])
    return layer


def weight_to_json(weight_file, json_file):
    with open(weight_file, "r") as f:
        lines = [line.strip() for line in f if line.strip()]

    # Car-game files start with "# Layer ..."; dog-game files start with numbers.
    format_name = "doggame" if lines and not lines[0].startswith("#") else "cargame"

    layers = []
    metadata = []
    curr_lay = _new_layer()
    reading_bias = False

    for line in lines:
        if line == "=====":
            # Dog-game metadata block starts here; finish the last layer first.
            if curr_lay["weights"]:
                layers.append(_finalize_doggame_layer(curr_lay))
                curr_lay = _new_layer()
            continue

        if line.startswith("-----"):
            if curr_lay["weights"]:
                if format_name == "doggame":
                    layers.append(_finalize_doggame_layer(curr_lay))
                else:
                    if "in_features" not in curr_lay:
                        curr_lay["in_features"] = len(curr_lay["weights"])
                        curr_lay["out_features"] = len(curr_lay["weights"][0])
                    layers.append(curr_lay)
                curr_lay = _new_layer()
            reading_bias = False
            continue

        if line.startswith("# Layer"):
            dims = _parse_linear_header(line)
            if dims and format_name == "cargame":
                curr_lay = _new_layer(*dims)
            else:
                metadata.append(line.lstrip("# ").strip())
            reading_bias = False
            continue

        if line.startswith("# Weight matrix"):
            reading_bias = False
            continue

        if line.startswith("# Bias"):
            reading_bias = True
            continue

        if line.startswith("#"):
            metadata.append(line.lstrip("# ").strip())
            continue

        values = [float(x) for x in line.split(",")]

        if format_name == "doggame":
            curr_lay["weights"].append(values)
        elif reading_bias:
            curr_lay["bias"] = values
        else:
            curr_lay["weights"].append(values)

    if curr_lay["weights"]:
        if format_name == "doggame":
            layers.append(_finalize_doggame_layer(curr_lay))
        else:
            if "in_features" not in curr_lay:
                curr_lay["in_features"] = len(curr_lay["weights"])
                curr_lay["out_features"] = len(curr_lay["weights"][0])
            layers.append(curr_lay)

    output = {"format": format_name, "layers": layers}
    if metadata:
        output["metadata"] = metadata

    with open(json_file, "w") as f:
        json.dump(output, f, indent=2)

    return output


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Convert exported weight file to JSON")
    parser.add_argument("weight_file", help="Path to weights .txt file")
    parser.add_argument(
        "json_file",
        nargs="?",
        help="Output JSON path (default: same name with .json)",
    )
    args = parser.parse_args()

    json_path = args.json_file
    if json_path is None:
        json_path = args.weight_file.rsplit(".", 1)[0] + ".json"

    weight_to_json(args.weight_file, json_path)
    print(f"Wrote {json_path}")
