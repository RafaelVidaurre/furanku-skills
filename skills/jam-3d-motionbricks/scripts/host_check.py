"""Check whether this machine can generate with NVIDIA MotionBricks, against its documented requirements. Pure Python
standard library (3.8 or newer), no Blender, no MotionBricks needed: run it on the machine that would generate.

    python3 host_check.py [--motionbricks <clone dir>] [--precision fp32|fp16] [--disk-path <dir>] [--import-check]
                          [--out <host-check.json>]

Prints one JSON object: `host` (what was found), `requirements` (one entry per requirement with `status` pass, fail,
warn or unknown, what was `found`, and the `source` of the requirement), `qualifies` (the OS, GPU and driver
requirements pass, so MotionBricks can be installed here), `ready` (no requirement failed or unknown, so it can
generate now), and `missing` (what to fix, in words). Exit status 0 when ready, 1 when not, 2 on bad arguments.

--motionbricks   an existing clone, to check the install, the model files and the TensorRT plans.
--precision      which plan to look for (default fp32).
--import-check   also start MotionBricks' own interpreter and ask TensorRT and Warp whether a CUDA device works. Takes
                 tens of seconds; the definitive check that the install runs on this GPU.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys

MIN_COMPUTE = (7, 5)
MIN_DRIVER = 525
MIN_CUDA = (12, 0)
MIN_PYTHON = (3, 12)
MIN_GLIBC = (2, 28)
CLONE_BYTES = 4.7e9
LFS_POINTER = b"version https://git-lfs"
HARDWARE = ("os", "glibc", "nvidia-gpu", "compute-capability", "driver", "driver-cuda")
ONNX = {"fp32": "mmm_v6_soma_fp32.onnx", "fp16": "mmm_v6_soma_fp16.onnx"}

SRC = {
    "os": "MotionBricks README (Setup): tested on Windows and Linux x86-64; TensorRT 10.8 (pinned) ships wheels for "
          "Windows x86-64 and Linux only; Warp's macOS wheels run on the CPU only",
    "gpu": "MotionBricks README (Setup): the runtime uses TensorRT, which requires an NVIDIA GPU",
    "compute": "TensorRT 10.x support matrix: compute capability 7.5 or higher (TensorRT 10.8 is pinned)",
    "driver": "Warp 1.17 installation guide (Warp 1.17.0 is pinned): packages built with CUDA 12 need driver 525 or newer",
    "cuda": "tensorrt-cu12 and Warp's CUDA 12 build need a driver that supports CUDA 12",
    "glibc": "TensorRT 10.8.0 release notes: glibc 2.28 or newer on Linux x86-64",
    "tools": "MotionBricks README (Setup): install Git LFS and uv, clone, `git lfs pull`, `uv sync`",
    "python": "MotionBricks pyproject.toml: requires-python >= 3.12 (uv installs it when missing)",
    "disk": "Measured: a full clone with its Git LFS objects takes about 4.7 GB",
    "install": "MotionBricks README (Setup): the ONNX models arrive through Git LFS",
    "plan": "MotionBricks README (Setup): the first launch of each model and precision builds a TensorRT plan (a few "
            "minutes) and caches it in .trt-cache/; a plan only fits the GPU, TensorRT version and OS that built it",
    "import": "MotionBricks runtime API (Engines): engines need a CUDA device",
}


def run(cmd, timeout=30):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout if out.returncode == 0 else None


def parse_version(text, parts=2):
    m = re.search(r"(\d+)" + r"\.(\d+)" * (parts - 1), text or "")
    return tuple(int(g) for g in m.groups()) if m else None


def parse_gpus(csv_text):
    """Rows of `nvidia-smi --query-gpu=name,compute_cap,driver_version,memory.total,memory.free --format=csv,noheader,nounits`."""
    gpus = []
    for line in (csv_text or "").splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 5 or not cells[0]:
            continue
        mem = [int(c) if c.isdigit() else None for c in cells[3:5]]
        gpus.append({"name": cells[0], "computeCapability": parse_version(cells[1]) and ".".join(map(str, parse_version(cells[1]))),
                     "driver": cells[2], "memoryTotalMiB": mem[0], "memoryFreeMiB": mem[1]})
    return gpus


def parse_cuda_version(smi_text):
    """The CUDA version the driver supports, from the header of plain `nvidia-smi` ("CUDA Version: 12.4" in older
    drivers, "CUDA UMD Version: 13.5" in newer ones)."""
    m = re.search(r"CUDA (?:UMD )?Version\s*:\s*(\d+)\.(\d+)", smi_text or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def plan_entries(cache_dir):
    """Metadata of every cached TensorRT plan (the JSON MotionBricks writes beside each .plan)."""
    entries = []
    try:
        names = sorted(os.listdir(cache_dir))
    except OSError:
        return entries
    for name in names:
        if not name.endswith(".json"):
            continue
        plan = os.path.join(cache_dir, name[:-5] + ".plan")
        try:
            with open(os.path.join(cache_dir, name), encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(meta, dict) and os.path.isfile(plan) and os.path.getsize(plan) > 0:
            entries.append(meta)
    return entries


def plan_matches(meta, precision, gpus, system):
    """Whether a cached plan was built for this precision on this OS and one of these GPUs."""
    if meta.get("onnx_filename") != ONNX[precision]:
        return False
    if (meta.get("platform") or {}).get("system") != system:
        return False
    device = meta.get("device") or {}
    for gpu in gpus:
        cc = gpu.get("computeCapability")
        arch = int(cc.replace(".", "")) if cc else None
        if device.get("name") == gpu["name"] and (arch is None or device.get("architecture") == arch):
            return True
    return False


def is_lfs_pointer(path):
    try:
        with open(path, "rb") as f:
            return f.read(len(LFS_POINTER)) == LFS_POINTER
    except OSError:
        return True


def venv_python(clone):
    for rel in (("Scripts", "python.exe"), ("bin", "python")):
        path = os.path.join(clone, ".venv", *rel)
        if os.path.isfile(path):
            return path
    return None


def gather(args):
    """Every fact the requirements are judged on. Kept apart from evaluate() so the judgement is testable."""
    system = platform.system()
    facts = {"os": system, "osRelease": platform.release(), "machine": platform.machine(),
             "python": platform.python_version(), "glibc": None}
    if system == "Linux":
        lib, ver = platform.libc_ver()
        facts["glibc"] = ver if lib == "glibc" else None
    smi = shutil.which("nvidia-smi")
    facts["nvidiaSmi"] = bool(smi)
    facts["gpus"] = parse_gpus(run([smi, "--query-gpu=name,compute_cap,driver_version,memory.total,memory.free",
                                     "--format=csv,noheader,nounits"])) if smi else []
    cuda = parse_cuda_version(run([smi])) if smi else None
    facts["driverCuda"] = ".".join(map(str, cuda)) if cuda else None
    facts["uv"] = (run(["uv", "--version"]) or "").strip() or None
    facts["gitLfs"] = (run(["git", "lfs", "version"]) or "").strip() or None
    disk_path = args.disk_path or args.motionbricks or os.getcwd()
    try:
        facts["diskFreeBytes"] = shutil.disk_usage(disk_path).free
    except OSError:
        facts["diskFreeBytes"] = None
    facts["diskPath"] = os.path.abspath(disk_path)
    facts["precision"] = args.precision
    mb = None
    if args.motionbricks:
        clone = os.path.abspath(args.motionbricks)
        mb = {"path": clone, "exists": os.path.isdir(os.path.join(clone, "motionbricks"))}
        version_file = os.path.join(clone, "motionbricks", "_version.py")
        try:
            with open(version_file, encoding="utf-8") as f:
                m = re.search(r"__version__\s*=\s*['\"]([^'\"]+)", f.read())
            mb["version"] = m.group(1) if m else None
        except OSError:
            mb["version"] = None
        onnx = os.path.join(clone, "motionbricks", "assets", "onnx", "soma", ONNX[args.precision])
        mb["onnx"] = {"file": ONNX[args.precision], "present": os.path.isfile(onnx),
                      "lfsPointer": os.path.isfile(onnx) and is_lfs_pointer(onnx),
                      "bytes": os.path.getsize(onnx) if os.path.isfile(onnx) else None}
        py = venv_python(clone)
        mb["venvPython"] = py
        mb["venvPythonVersion"] = (run([py, "-c", "import platform; print(platform.python_version())"]) or "").strip() or None if py else None
        cache = os.path.join(clone, ".trt-cache")
        mb["planCache"] = cache
        mb["plans"] = [{"onnx": e.get("onnx_filename"), "gpu": (e.get("device") or {}).get("name"),
                        "architecture": (e.get("device") or {}).get("architecture"), "tensorrt": e.get("tensorrt_version"),
                        "os": (e.get("platform") or {}).get("system"), "buildOptions": e.get("build_options"),
                        "fitsThisHost": plan_matches(e, args.precision, facts["gpus"], system)} for e in plan_entries(cache)]
        if args.import_check and py:
            code = ("import json, tensorrt, warp as wp; wp.init(); d = wp.get_device('cuda:0') if wp.get_cuda_device_count() else None; "
                    "import motionbricks._version as v; "
                    "print(json.dumps({'tensorrt': tensorrt.__version__, 'warp': wp.config.version, 'cuda': bool(d), "
                    "'device': d.name if d else None, 'motionbricks': v.__version__}))")
            out = run([py, "-c", code], timeout=600)
            try:
                mb["imports"] = json.loads(out.strip().splitlines()[-1]) if out else {"error": "the interpreter failed to import tensorrt, warp or motionbricks"}
            except ValueError:
                mb["imports"] = {"error": "unreadable output"}
    facts["motionbricks"] = mb
    return facts


def _req(rid, requirement, status, found, source_key):
    return {"id": rid, "requirement": requirement, "status": status, "found": found, "source": SRC[source_key]}


def evaluate(facts):
    """Judge each documented requirement on the facts. Returns the requirement list."""
    reqs = []
    system, machine = facts["os"], (facts.get("machine") or "").lower()
    if system in ("Windows", "Linux"):
        arch_ok = machine in ("x86_64", "amd64")
        reqs.append(_req("os", "Windows or Linux on x86-64", "pass" if arch_ok else "warn",
                         f"{system} {facts.get('machine')}" + ("" if arch_ok else ": not the tested architecture"), "os"))
    else:
        reqs.append(_req("os", "Windows or Linux on x86-64", "fail", f"{system} {facts.get('machine')}", "os"))
    if system == "Linux":
        g = parse_version(facts.get("glibc"))
        reqs.append(_req("glibc", "glibc 2.28 or newer", "unknown" if g is None else ("pass" if g >= MIN_GLIBC else "fail"),
                         facts.get("glibc"), "glibc"))
    gpus = facts.get("gpus") or []
    if not facts.get("nvidiaSmi"):
        reqs.append(_req("nvidia-gpu", "an NVIDIA GPU with its driver", "fail", "nvidia-smi not found", "gpu"))
    elif not gpus:
        reqs.append(_req("nvidia-gpu", "an NVIDIA GPU with its driver", "fail", "nvidia-smi lists no GPU", "gpu"))
    else:
        reqs.append(_req("nvidia-gpu", "an NVIDIA GPU with its driver", "pass", ", ".join(g["name"] for g in gpus), "gpu"))
        best = max(gpus, key=lambda g: parse_version(g.get("computeCapability")) or (0, 0))
        cc = parse_version(best.get("computeCapability"))
        reqs.append(_req("compute-capability", "compute capability 7.5 or higher",
                         "unknown" if cc is None else ("pass" if cc >= MIN_COMPUTE else "fail"),
                         f"{best['name']}: {best.get('computeCapability') or 'not reported'}", "compute"))
        drv = parse_version(best.get("driver"), 1)
        reqs.append(_req("driver", f"NVIDIA driver {MIN_DRIVER} or newer",
                         "unknown" if drv is None else ("pass" if drv[0] >= MIN_DRIVER else "fail"), best.get("driver"), "driver"))
        cuda = parse_version(facts.get("driverCuda"))
        reqs.append(_req("driver-cuda", "a driver that supports CUDA 12",
                         "unknown" if cuda is None else ("pass" if cuda >= MIN_CUDA else "fail"), facts.get("driverCuda"), "cuda"))
    mb = facts.get("motionbricks")
    installed = bool(mb and mb.get("exists") and mb.get("onnx", {}).get("present") and not mb["onnx"].get("lfsPointer"))
    if not installed:
        tools = [n for n, k in (("uv", "uv"), ("Git LFS", "gitLfs")) if not facts.get(k)]
        reqs.append(_req("install-tools", "Git LFS and uv installed", "fail" if tools else "pass",
                         "missing: " + ", ".join(tools) if tools else f"{facts.get('uv')}; {facts.get('gitLfs')}", "tools"))
        free = facts.get("diskFreeBytes")
        reqs.append(_req("disk", "about 4.7 GB free for the clone", "unknown" if free is None else ("pass" if free >= CLONE_BYTES else "fail"),
                         None if free is None else f"{free / 1e9:.1f} GB free at {facts.get('diskPath')}", "disk"))
    if mb is None:
        reqs.append(_req("motionbricks", "MotionBricks cloned with its LFS files and synced", "unknown",
                         "not checked: pass --motionbricks <clone dir>", "install"))
        return reqs
    if not mb.get("exists"):
        reqs.append(_req("motionbricks", "MotionBricks cloned with its LFS files and synced", "fail", f"no clone at {mb['path']}", "install"))
        return reqs
    onnx = mb["onnx"]
    status = "pass" if installed and mb.get("venvPython") else "fail"
    found = f"version {mb.get('version')}; {onnx['file']} " + (
        "missing" if not onnx["present"] else "is a Git LFS pointer: run `git lfs pull`" if onnx["lfsPointer"] else f"{onnx['bytes'] / 1e6:.0f} MB")
    found += "; environment " + ("present" if mb.get("venvPython") else "missing: run `uv sync`")
    reqs.append(_req("motionbricks", "MotionBricks cloned with its LFS files and synced", status, found, "install"))
    pyv = parse_version(mb.get("venvPythonVersion"))
    if mb.get("venvPython"):
        reqs.append(_req("python", "Python 3.12 or newer in MotionBricks' environment",
                         "unknown" if pyv is None else ("pass" if pyv >= MIN_PYTHON else "fail"), mb.get("venvPythonVersion"), "python"))
    fitting = [p for p in mb.get("plans", []) if p["fitsThisHost"]]
    reqs.append(_req("plan", f"a TensorRT plan for {facts['precision']} built on this host",
                     "pass" if fitting else "warn",
                     f"{len(fitting)} fitting plan(s) of {len(mb.get('plans', []))} cached" if fitting else
                     "none yet: `generate.py plan` (or the first generation) builds it, which takes minutes", "plan"))
    if "imports" in mb:
        imp = mb["imports"]
        ok = imp.get("cuda") is True
        reqs.append(_req("cuda-runtime", "TensorRT and Warp start on a CUDA device", "pass" if ok else "fail",
                         imp.get("error") or f"TensorRT {imp.get('tensorrt')}, Warp {imp.get('warp')}, device {imp.get('device')}", "import"))
    return reqs


def summarize(facts, reqs):
    blocking = [r for r in reqs if r["status"] in ("fail", "unknown")]
    return {"host": facts, "requirements": reqs,
            "qualifies": not [r for r in blocking if r["id"] in HARDWARE],
            "ready": not blocking,
            "missing": [f"{r['requirement']}: {r['found']}" for r in blocking],
            "notes": ["VRAM, CPU-only speed and a minimum GPU model are not documented by MotionBricks; they are reported, not judged.",
                      "A warn is not blocking: say it to the person."]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--motionbricks")
    parser.add_argument("--precision", choices=sorted(ONNX), default="fp32")
    parser.add_argument("--disk-path")
    parser.add_argument("--import-check", action="store_true")
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    facts = gather(args)
    report = summarize(facts, evaluate(facts))
    text = json.dumps(report, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    print(text)
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
