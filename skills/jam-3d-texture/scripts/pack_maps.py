"""Pack grey maps into the channels of one texture, or change a normal map's green-channel convention.

python pack_maps.py pack <out.png> --packing ORM
    [--occlusion <png|0-1>] [--roughness <png|0-1>] [--metallic <png|0-1>] [--height <png|0-1>]
    [--gltf <png>] [--size N]
python pack_maps.py normal <in.png> <out.png> --from up|down --to up|down

`pack`: --packing names what each channel of the output holds, in R G B (A) order, one letter each:
O or A occlusion, R roughness, M metallic, S smoothness (1 - roughness), H height, 0 black, 1 white.
ORM, the default, is glTF's own layout (occlusion R, roughness G, metallic B); the packing an engine wants is the
`textures.packed` fact of `jam engine facts`. A source is a grey image or a number for a constant; --gltf takes a
glTF occlusion-roughness-metallic texture and supplies all three from its channels. Occlusion defaults to 1 and
metallic to 0; roughness has no default. Sources of different sizes are resized to the largest, or to --size.

`normal`: glTF normal maps have green up. An engine whose `textures.normalGreen` fact is `down` wants the green
channel inverted; the same call converts back.

Prints one JSON line saying what each channel came from. Exits 2 on wrong input. Needs Pillow.
"""
import argparse
import json
import os
import sys

LETTERS = {"O": "occlusion", "A": "occlusion", "R": "roughness", "M": "metallic", "S": "smoothness", "H": "height", "0": "black", "1": "white"}
DEFAULTS = {"occlusion": 1.0, "metallic": 0.0}


def parse_packing(text):
    """Channel sources for a packing word such as ORM, RMA or M00S."""
    letters = (text or "").strip().upper()
    if len(letters) not in (3, 4) or any(letter not in LETTERS for letter in letters):
        raise ValueError(f"a packing is 3 or 4 letters from {''.join(LETTERS)} (R G B A order), such as ORM; got {text!r}")
    return [LETTERS[letter] for letter in letters]


def plan(packing, given):
    """For each output channel: ('image', key, invert) or ('value', number). `given` maps source names to a path or a number."""
    steps, notes = [], []
    for name in parse_packing(packing):
        if name in ("black", "white"):
            steps.append(("value", 1.0 if name == "white" else 0.0))
            continue
        key, invert = ("roughness", True) if name == "smoothness" else (name, False)
        if key not in given:
            if key not in DEFAULTS:
                raise ValueError(f"the packing needs {key}: pass --{key} <png or number>" + (" or --gltf <png>" if key == "roughness" else ""))
            notes.append(f"{key} not given: constant {DEFAULTS[key]}")
            steps.append(("value", 1.0 - DEFAULTS[key] if invert else DEFAULTS[key]))
        elif isinstance(given[key], (int, float)):
            steps.append(("value", 1.0 - given[key] if invert else float(given[key])))
        else:
            steps.append(("image", key, invert))
    return steps, notes


def source(value):
    try:
        number = float(value)
    except ValueError:
        return value
    if not 0.0 <= number <= 1.0:
        raise ValueError(f"a constant must be between 0 and 1; got {value}")
    return number


def pack(args):
    from PIL import Image, ImageChops
    given = {}
    channels = {}
    if args.gltf:
        r, g, b = Image.open(args.gltf).convert("RGB").split()
        channels.update(occlusion=r, roughness=g, metallic=b)
        given.update(occlusion=args.gltf, roughness=args.gltf, metallic=args.gltf)
    for key in ("occlusion", "roughness", "metallic", "height"):
        value = getattr(args, key)
        if value is not None:
            given[key] = source(value)
            if isinstance(given[key], str):
                channels[key] = Image.open(given[key]).convert("L")
            else:
                channels.pop(key, None)
    steps, notes = plan(args.packing, given)
    sizes = [channels[s[1]].size for s in steps if s[0] == "image"]
    size = (args.size, args.size) if args.size else (max(sizes, key=lambda s: s[0] * s[1]) if sizes else None)
    if size is None:
        raise ValueError("every channel is a constant: pass --size N for the output's size")
    bands = []
    for step in steps:
        if step[0] == "value":
            bands.append(Image.new("L", size, round(step[1] * 255)))
        else:
            band = channels[step[1]]
            band = band if band.size == size else band.resize(size, Image.LANCZOS)
            bands.append(ImageChops.invert(band) if step[2] else band)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    Image.merge("RGB" if len(bands) == 3 else "RGBA", bands).save(args.out)
    described = [f"constant {s[1]}" if s[0] == "value" else ("1 - " if s[2] else "") + f"{s[1]} from {os.path.basename(str(given[s[1]]))}" for s in steps]
    return {"written": args.out, "packing": args.packing.upper(), "size": list(size), "channels": dict(zip("RGBA", described)), "notes": notes}


def normal(args):
    from PIL import Image, ImageChops
    image = Image.open(args.source)
    bands = list(image.convert("RGBA" if "A" in image.getbands() else "RGB").split())
    flipped = args.from_ != args.to
    if flipped:
        bands[1] = ImageChops.invert(bands[1])
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    Image.merge("RGBA" if len(bands) == 4 else "RGB", bands).save(args.out)
    return {"written": args.out, "greenFrom": args.from_, "greenTo": args.to, "greenInverted": flipped}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Pack grey maps into one texture, or convert a normal map's green convention.")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("pack")
    p.add_argument("out")
    p.add_argument("--packing", default="ORM")
    for key in ("occlusion", "roughness", "metallic", "height"):
        p.add_argument(f"--{key}", metavar="PNG|0-1")
    p.add_argument("--gltf", metavar="PNG", help="a glTF occlusion-roughness-metallic texture supplying all three")
    p.add_argument("--size", type=int)
    n = commands.add_parser("normal")
    n.add_argument("source")
    n.add_argument("out")
    n.add_argument("--from", dest="from_", choices=["up", "down"], required=True)
    n.add_argument("--to", choices=["up", "down"], required=True)
    args = parser.parse_args(argv)
    try:
        result = pack(args) if args.command == "pack" else normal(args)
    except (ValueError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except ImportError:
        print("error: this script needs Pillow (pip install Pillow)", file=sys.stderr)
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
