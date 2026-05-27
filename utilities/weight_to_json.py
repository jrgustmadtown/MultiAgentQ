import json

def weight_to_json(weight_file, json_file):
    layers = []
    curr_lay = None
    reading_bias = False

    with open(weight_file, "r") as f:
        for line in f:
            line = line.strip()

            if not line:
                continue

            if line.startswith("-----"):
                if curr_lay:
                    layers.append(curr_lay)
                curr_lay = None
                reading_bias = False
                continue

            if line.startswith("# Layer"):
                curr_lay = {
                    "weights": [],
                    "bias": [],
                }
                continue

            if line.startswith("# Bias"):
                reading_bias = True
                continue

            if line.startswith("#"):
                continue

            nums = []
            for x in line.split(","):
                nums.append(float(x))

            if reading_bias:
                curr_lay["bias"] = nums
            else:
                curr_lay["weights"].append(nums)

        if current_layer:
            layers.append(current_layer)

        return layers

p1 = weight_to_json("weights_player1.txt", "weights_player1.json")
p2 = weight_to_json("weights_player2.txt", "weights_player2.json")
            